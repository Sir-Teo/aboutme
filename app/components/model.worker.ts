// The playground's generation worker: a single WebGPU path (no WASM/instant
// fallback) driving the Gemma 4 / Liquid AI engines from app/chat/engines.ts.
//
// Kept separate from AskAI.worker.ts on purpose — that worker powers the
// homepage pill and must degrade gracefully on any device; this one is the
// frontier showcase and assumes WebGPU. Streaming, graceful stop and an idle
// watchdog mirror the proven AskAI.worker.ts design.

// The chat/voice-answer worker only loads plain text models (multimodal models
// have their own worker), so the task is always text-generation.
type EngineConfig = {
    id: string
    modelId: string
    dtype: 'q4' | 'q4f16' | 'fp16' | 'q8'
    maxNewTokens: number
}

type WorkerChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }

// A tool definition passed to the chat template for native function-calling.
type ToolSpec = {
    name: string
    description: string
    parameters: Record<string, unknown>
}

type ModelWorkerRequest =
    | { type: 'warm'; engine: EngineConfig }
    | {
          type: 'generate'
          id: string
          engine: EngineConfig
          messages: WorkerChatMessage[]
          tools?: ToolSpec[]
          // Optional per-call override of the engine's default token budget.
          maxNewTokens?: number
      }
    | { type: 'stop'; id: string }
    // Free the resident model (GPU buffers) without tearing down the worker.
    | { type: 'dispose' }

type ModelWorkerResponse =
    | { type: 'progress'; engineId: string; progress: string }
    | { type: 'ready'; engineId: string }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'done'; id: string; text: string }
    | { type: 'error'; id?: string; message: string }

// If decoding stalls (no new token) this long, interrupt and report an error so
// a wedged GPU/driver turn can't hang the UI forever.
const GENERATION_IDLE_TIMEOUT_MS = 20000

const workerSelf = self as unknown as {
    postMessage(message: ModelWorkerResponse): void
    addEventListener(type: 'message', listener: (event: MessageEvent<ModelWorkerRequest>) => void): void
}

let current: { engineId: string; generator: any } | null = null
let loading: Promise<any> | null = null
let activeStopper: { interrupt: () => void } | null = null
let activeId: string | null = null
let lastProgressPost = 0
let lastProgressText = ''

function post(message: ModelWorkerResponse) {
    workerSelf.postMessage(message)
}

function postProgress(engineId: string, progress: string, force = false) {
    const now = performance.now()
    if (!force && progress === lastProgressText && now - lastProgressPost < 200) return
    lastProgressPost = now
    lastProgressText = progress
    post({ type: 'progress', engineId, progress })
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function fileLabel(file: unknown): string {
    if (typeof file !== 'string' || !file) return 'files'
    return file.split('/').pop() || file
}

function progressText(engine: EngineConfig, p: any): string | null {
    const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
    if (p?.status === 'progress' && typeof p.progress === 'number')
        return `Downloading ${fileLabel(p.file)}… ${pct(p.progress)}%`
    if (p?.status === 'download') return `Fetching ${fileLabel(p.file)}…`
    if (p?.status === 'initiate') return `Preparing ${fileLabel(p.file)}…`
    if (p?.status === 'ready' || p?.status === 'done') return 'Warming up…'
    return null
}

async function loadGenerator(engine: EngineConfig) {
    if (current?.engineId === engine.id) return current.generator
    if (loading) return loading

    loading = (async () => {
        const { env, pipeline } = await import('@huggingface/transformers')
        // Free the previously-loaded model's GPU buffers before loading another —
        // otherwise switching engines leaves both resident (a big VRAM leak).
        if (current) {
            try {
                await current.generator?.dispose?.()
            } catch {
                /* best-effort */
            }
            current = null
        }
        // Models stream from the HF CDN and cache in the browser; nothing local.
        env.allowLocalModels = false
        env.useBrowserCache = true

        postProgress(engine.id, 'Loading runtime…', true)
        const generator = await pipeline('text-generation', engine.modelId, {
            dtype: engine.dtype,
            device: 'webgpu',
            progress_callback: (p: any) => {
                const text = progressText(engine, p)
                if (text) postProgress(engine.id, text)
            },
        })

        current = { engineId: engine.id, generator }
        post({ type: 'ready', engineId: engine.id })
        return generator
    })()

    try {
        return await loading
    } finally {
        loading = null
    }
}

async function runGenerate(request: Extract<ModelWorkerRequest, { type: 'generate' }>) {
    const { id, engine, messages, tools, maxNewTokens } = request
    try {
        const generator = await loadGenerator(engine)
        const { TextStreamer, InterruptableStoppingCriteria } = await import('@huggingface/transformers')
        const stopper = new InterruptableStoppingCriteria()
        activeStopper = stopper
        activeId = id

        let full = ''
        let watchdog: ReturnType<typeof setTimeout> | null = null
        let stalled = false
        const arm = () => {
            if (watchdog) clearTimeout(watchdog)
            watchdog = setTimeout(() => {
                stalled = true
                stopper.interrupt()
            }, GENERATION_IDLE_TIMEOUT_MS)
        }
        const disarm = () => {
            if (watchdog) clearTimeout(watchdog)
            watchdog = null
        }

        const streamer = new TextStreamer(generator.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (chunk: string) => {
                arm()
                full += chunk
                post({ type: 'chunk', id, chunk })
            },
        })

        // Tools, when present, are passed through the chat template so the model
        // can emit native JSON function calls (Gemma 4 / LFM2.5 support this).
        const generateOptions: Record<string, unknown> = {
            max_new_tokens: maxNewTokens ?? engine.maxNewTokens,
            do_sample: false,
            repetition_penalty: 1.1,
            return_full_text: false,
            streamer,
            stopping_criteria: stopper,
        }
        if (tools && tools.length) generateOptions.tools = tools

        arm()
        try {
            await generator(messages, generateOptions)
        } finally {
            disarm()
        }

        if (stalled) post({ type: 'error', id, message: 'Generation timed out.' })
        else post({ type: 'done', id, text: full })
    } catch (error) {
        post({ type: 'error', id, message: errorMessage(error) })
    } finally {
        if (activeId === id) {
            activeStopper = null
            activeId = null
        }
    }
}

workerSelf.addEventListener('message', event => {
    const request = event.data

    if (request.type === 'stop') {
        if (request.id === activeId) activeStopper?.interrupt()
        return
    }
    if (request.type === 'dispose') {
        activeStopper?.interrupt()
        const toFree = current
        current = null
        void toFree?.generator?.dispose?.()?.catch?.(() => undefined)
        return
    }
    if (request.type === 'warm') {
        void loadGenerator(request.engine).catch(() => undefined)
        return
    }
    if (request.type === 'generate') {
        void runGenerate(request)
    }
})

export {}
