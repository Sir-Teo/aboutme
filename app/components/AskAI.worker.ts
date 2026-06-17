type RuntimeDevice = 'webgpu' | 'wasm'
type RuntimeMode = {
    device: RuntimeDevice
    modelId: string
    // q4f16 (f16 activations) on WebGPU; plain q4 on the WASM/CPU path.
    dtype: 'q4' | 'q4f16'
    label: string
    maxNewTokens: number
}

// Idle watchdog: if decoding stalls (no new token) for this long, interrupt and
// report an error so the client degrades to the instant answer instead of
// hanging on "Thinking…". A GPU/driver stall can wedge a turn with no recovery
// path otherwise.
const GENERATION_IDLE_TIMEOUT_MS = 15000

type WorkerChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type AskAIWorkerRequest =
    | { type: 'generate'; id: string; mode: RuntimeMode; messages: WorkerChatMessage[] }
    // Warm the runtime + weights ahead of the first question (no generation).
    | { type: 'warm'; mode: RuntimeMode }
    // Interrupt the in-flight generation without tearing down the loaded model.
    | { type: 'stop'; id: string }

type AskAIWorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'fallback'; mode: RuntimeMode; progress: string }
    | { type: 'ready'; mode: RuntimeMode }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'done'; id: string }
    | { type: 'error'; id?: string; message: string }

const WASM_MODE: RuntimeMode = {
    device: 'wasm',
    modelId: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    dtype: 'q4',
    label: 'WASM',
    maxNewTokens: 80,
}

const MOBILE_WASM_MODE: RuntimeMode = {
    ...WASM_MODE,
    label: 'WASM Mobile',
    maxNewTokens: 48,
}

const LOW_POWER_WASM_MODE: RuntimeMode = {
    ...WASM_MODE,
    label: 'WASM Lite',
    maxNewTokens: 32,
}

const WEBGPU_MIN_MEMORY_GB = 4

const workerSelf = self as unknown as {
    postMessage(message: AskAIWorkerResponse): void
    addEventListener(type: 'message', listener: (event: MessageEvent<AskAIWorkerRequest>) => void): void
}

let current: { mode: RuntimeMode; generator: any } | null = null
let loading: Promise<any> | null = null
// The active generation's stopping criteria, so a `stop` message can interrupt
// decoding gracefully while keeping the (expensive) loaded model resident.
let activeStopper: { interrupt: () => void; reset: () => void } | null = null
let activeId: string | null = null
let lastProgressPost = 0
let lastProgressText = ''
let transformersFetch: typeof fetch | null = null

function post(message: AskAIWorkerResponse) {
    workerSelf.postMessage(message)
}

function postProgress(progress: string, force = false) {
    const now = performance.now()
    if (!force && progress === lastProgressText && now - lastProgressPost < 250) return
    lastProgressPost = now
    lastProgressText = progress
    post({ type: 'progress', progress })
}

function wasmAvailable(): boolean {
    return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.href
    return input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
    return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
    return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
}

function isHuggingFaceMetadataRangeRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
    if (requestMethod(input, init) !== 'GET') return false
    const headers = requestHeaders(input, init)
    return headers.get('Range') === 'bytes=0-0' && /^https:\/\/huggingface\.co\/.+\/resolve\//.test(requestUrl(input))
}

async function fetchWithMetadataFallback(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const fetcher = transformersFetch ?? fetch.bind(globalThis)

    try {
        return await fetcher(input, init)
    } catch (error) {
        if (!isHuggingFaceMetadataRangeRequest(input, init) || errorMessage(error).includes('AbortError')) {
            throw error
        }

        const headers = requestHeaders(input, init)
        headers.delete('Range')
        return fetcher(requestUrl(input), {
            ...init,
            method: 'HEAD',
            headers,
            body: undefined,
            cache: init?.cache ?? 'no-store',
        })
    }
}

function likelyMobileBrowser(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || ''
    const platform = navigator.platform || ''
    const ipadDesktopMode = platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1
    return ipadDesktopMode || /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)
}

function likelySafariBrowser(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || ''
    const vendor = navigator.vendor || ''
    return /Apple/i.test(vendor) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium/i.test(ua)
}

function deviceMemoryGB(): number | null {
    if (typeof navigator === 'undefined') return null
    const memory = (navigator as any).deviceMemory
    return typeof memory === 'number' && Number.isFinite(memory) && memory > 0 ? memory : null
}

function fallbackWasmMode(): RuntimeMode {
    const memory = deviceMemoryGB()
    if (memory !== null && memory < WEBGPU_MIN_MEMORY_GB) return LOW_POWER_WASM_MODE
    if (likelyMobileBrowser()) return MOBILE_WASM_MODE
    return WASM_MODE
}

function configureTransformersEnv(env: any, mode: RuntimeMode) {
    transformersFetch ??= env.fetch ?? fetch.bind(globalThis)
    env.fetch = fetchWithMetadataFallback
    env.allowLocalModels = false
    env.useBrowserCache = true
    env.useWasmCache = true

    if (mode.device !== 'wasm') return

    const wasm = env?.backends?.onnx?.wasm
    if (!wasm) return

    const isolated = (self as any).crossOriginIsolated === true
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1
    const threadCap = likelyMobileBrowser() || likelySafariBrowser() ? 2 : 4
    wasm.numThreads = isolated ? Math.max(1, Math.min(threadCap, Math.ceil(cores / 2))) : 1
    wasm.proxy = false
}

function fileLabel(file: unknown): string {
    if (typeof file !== 'string' || !file) return 'files'
    return file.split('/').pop() || file
}

function progressText(mode: RuntimeMode, progress: any): string | null {
    if (progress?.status === 'progress_total' && typeof progress.progress === 'number') {
        return `${mode.label}: downloading model... ${Math.max(0, Math.min(100, Math.round(progress.progress)))}%`
    }

    if (progress?.status === 'progress' && typeof progress.progress === 'number') {
        return `${mode.label}: downloading ${fileLabel(progress.file)}... ${Math.max(
            0,
            Math.min(100, Math.round(progress.progress))
        )}%`
    }

    if (progress?.status === 'download') return `${mode.label}: fetching ${fileLabel(progress.file)}...`
    if (progress?.status === 'initiate') return `${mode.label}: checking ${fileLabel(progress.file)}...`
    if (progress?.status === 'ready' || progress?.status === 'done') return `${mode.label}: preparing...`
    return null
}

async function loadGenerator(mode: RuntimeMode) {
    if (current?.mode.modelId === mode.modelId && current.mode.device === mode.device) {
        current.mode = mode
        return current.generator
    }
    if (loading) return loading

    loading = (async () => {
        const { env, pipeline } = await import('@huggingface/transformers')
        configureTransformersEnv(env, mode)

        postProgress(`${mode.label}: loading runtime...`, true)
        const generator = await pipeline('text-generation', mode.modelId, {
            dtype: mode.dtype,
            device: mode.device,
            progress_callback: (p: any) => {
                const text = progressText(mode, p)
                if (text) postProgress(text)
            },
        })

        current = { mode, generator }
        post({ type: 'ready', mode })
        return generator
    })()

    try {
        return await loading
    } finally {
        loading = null
    }
}

async function ensureGenerator(mode: RuntimeMode) {
    try {
        return await loadGenerator(mode)
    } catch (error) {
        if (mode.device === 'webgpu' && wasmAvailable()) {
            const fallback = fallbackWasmMode()
            current = null
            post({
                type: 'fallback',
                mode: fallback,
                progress: 'WebGPU failed; switching to compatible mode...',
            })
            return await loadGenerator(fallback)
        }
        throw error
    }
}

workerSelf.addEventListener('message', event => {
    const request = event.data

    if (request.type === 'stop') {
        // Only interrupt the generation the client thinks is running.
        if (request.id === activeId) activeStopper?.interrupt()
        return
    }

    if (request.type === 'warm') {
        // Best-effort preload so the first answer skips cold-start. Swallow errors
        // here: warming is silent, and a real `generate` will retry and report
        // failures through the proper channel. (`fallback`/`ready` still fire.)
        void ensureGenerator(request.mode).catch(() => undefined)
        return
    }

    if (request.type !== 'generate') return

    void (async () => {
        try {
            const generator = await ensureGenerator(request.mode)
            const loadedMode = current?.mode ?? request.mode
            const { TextStreamer, InterruptableStoppingCriteria } = await import('@huggingface/transformers')
            const stopper = new InterruptableStoppingCriteria()
            activeStopper = stopper
            activeId = request.id

            // Reset the idle watchdog on every token; fire if decoding stalls.
            let watchdog: ReturnType<typeof setTimeout> | null = null
            let stalled = false
            const armWatchdog = () => {
                if (watchdog) clearTimeout(watchdog)
                watchdog = setTimeout(() => {
                    stalled = true
                    stopper.interrupt()
                }, GENERATION_IDLE_TIMEOUT_MS)
            }
            const disarmWatchdog = () => {
                if (watchdog) clearTimeout(watchdog)
                watchdog = null
            }

            const streamer = new TextStreamer(generator.tokenizer, {
                skip_prompt: true,
                skip_special_tokens: true,
                callback_function: (chunk: string) => {
                    armWatchdog()
                    post({ type: 'chunk', id: request.id, chunk })
                },
            })

            armWatchdog()
            try {
                await generator(request.messages, {
                    max_new_tokens: loadedMode.maxNewTokens,
                    do_sample: false,
                    // Small models loop/repeat under greedy decoding; these curb it
                    // at the source for cleaner, better-terminated answers.
                    repetition_penalty: 1.15,
                    // 4-grams, not 3: blocks degenerate loops while still letting
                    // legitimately repeated phrases through (e.g. "Data Science"
                    // appears in both of Teo's degrees).
                    no_repeat_ngram_size: 4,
                    return_full_text: false,
                    streamer,
                    stopping_criteria: stopper,
                })
            } finally {
                disarmWatchdog()
            }
            if (stalled) post({ type: 'error', id: request.id, message: 'Generation timed out.' })
            else post({ type: 'done', id: request.id })
        } catch (error) {
            post({ type: 'error', id: request.id, message: errorMessage(error) })
        } finally {
            if (activeId === request.id) {
                activeStopper = null
                activeId = null
            }
        }
    })()
})

export {}
