type RuntimeDevice = 'webgpu' | 'wasm'
type RuntimeMode = {
    device: RuntimeDevice
    modelId: string
    dtype: 'q4'
    label: string
    maxNewTokens: number
}

type WorkerChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type AskAIWorkerRequest = {
    type: 'generate'
    id: string
    mode: RuntimeMode
    messages: WorkerChatMessage[]
}

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

const workerSelf = self as unknown as {
    postMessage(message: AskAIWorkerResponse): void
    addEventListener(type: 'message', listener: (event: MessageEvent<AskAIWorkerRequest>) => void): void
}

let current: { mode: RuntimeMode; generator: any } | null = null
let loading: Promise<any> | null = null

function post(message: AskAIWorkerResponse) {
    workerSelf.postMessage(message)
}

function wasmAvailable(): boolean {
    return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function configureWasmThreads(env: any) {
    const wasm = env?.backends?.onnx?.wasm
    if (!wasm) return

    const isolated = (self as any).crossOriginIsolated === true
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1
    wasm.numThreads = isolated ? Math.max(1, Math.min(4, cores)) : 1
}

async function loadGenerator(mode: RuntimeMode) {
    if (current?.mode.modelId === mode.modelId && current.mode.device === mode.device) {
        return current.generator
    }
    if (loading) return loading

    loading = (async () => {
        const { env, pipeline } = await import('@huggingface/transformers')
        if (mode.device === 'wasm') configureWasmThreads(env)

        post({ type: 'progress', progress: `${mode.label}: loading runtime...` })
        const generator = await pipeline('text-generation', mode.modelId, {
            dtype: mode.dtype,
            device: mode.device,
            progress_callback: (p: any) => {
                if (p.status === 'progress' && typeof p.progress === 'number') {
                    post({
                        type: 'progress',
                        progress: `${mode.label}: downloading model... ${Math.round(p.progress)}%`,
                    })
                } else if (p.status === 'ready' || p.status === 'done') {
                    post({ type: 'progress', progress: `${mode.label}: preparing...` })
                }
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
            current = null
            post({
                type: 'fallback',
                mode: WASM_MODE,
                progress: 'WebGPU failed; switching to compatible mode...',
            })
            return await loadGenerator(WASM_MODE)
        }
        throw error
    }
}

workerSelf.addEventListener('message', event => {
    const request = event.data
    if (request.type !== 'generate') return

    void (async () => {
        try {
            const generator = await ensureGenerator(request.mode)
            const loadedMode = current?.mode ?? request.mode
            const { TextStreamer } = await import('@huggingface/transformers')
            const streamer = new TextStreamer(generator.tokenizer, {
                skip_prompt: true,
                skip_special_tokens: false,
                callback_function: (chunk: string) => {
                    post({ type: 'chunk', id: request.id, chunk })
                },
            })

            await generator(request.messages, {
                max_new_tokens: loadedMode.maxNewTokens,
                do_sample: false,
                streamer,
            })
            post({ type: 'done', id: request.id })
        } catch (error) {
            post({ type: 'error', id: request.id, message: errorMessage(error) })
        }
    })()
})

export {}
