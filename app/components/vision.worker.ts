// Vision worker: image-in, text-out on WebGPU using a Gemma/Liquid VLM
// (LFM2.5-VL or Gemma 4 E2B). Captioning, visual Q&A and OCR, fully on-device.
//
// transformers.js 4.2.0 does NOT expose these models through a pipeline; they
// load via their dedicated ConditionalGeneration class + AutoProcessor. The
// class name travels with the engine config so this worker stays generic.

type VisionEngine = { id: string; modelId: string; modelClass: string; dtype: string; maxNewTokens: number }

type VisionRequest =
    | { type: 'warm'; engine: VisionEngine }
    | { type: 'describe'; id: string; engine: VisionEngine; image: string; prompt: string }

type VisionResponse =
    | { type: 'progress'; progress: string }
    | { type: 'ready' }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'done'; id: string; text: string }
    | { type: 'error'; id?: string; message: string }

const workerSelf = self as unknown as {
    postMessage(message: VisionResponse): void
    addEventListener(type: 'message', listener: (event: MessageEvent<VisionRequest>) => void): void
}

let processor: any = null
let model: any = null
let loadedId: string | null = null
let loading: Promise<void> | null = null

function post(m: VisionResponse) {
    workerSelf.postMessage(m)
}

async function load(engine: VisionEngine): Promise<void> {
    if (model && loadedId === engine.id) return
    if (loading) return loading
    loading = (async () => {
        const transformers: any = await import('@huggingface/transformers')
        const { env, AutoProcessor } = transformers
        // Free a previously-loaded vision model before swapping in another.
        if (model) {
            try {
                await model.dispose?.()
            } catch {
                /* best-effort */
            }
            model = null
            processor = null
        }
        env.allowLocalModels = false
        env.useBrowserCache = true
        const ModelClass = transformers[engine.modelClass]
        if (!ModelClass) throw new Error(`Unknown model class: ${engine.modelClass}`)

        post({ type: 'progress', progress: 'Loading vision model…' })
        processor = await AutoProcessor.from_pretrained(engine.modelId)
        model = await ModelClass.from_pretrained(engine.modelId, {
            dtype: engine.dtype,
            device: 'webgpu',
            progress_callback: (p: any) => {
                if (p?.status === 'progress' && typeof p.progress === 'number')
                    post({ type: 'progress', progress: `Downloading vision model… ${Math.round(p.progress)}%` })
            },
        })
        loadedId = engine.id
        post({ type: 'ready' })
    })()
    try {
        await loading
    } finally {
        loading = null
    }
}

async function describe(request: Extract<VisionRequest, { type: 'describe' }>) {
    try {
        await load(request.engine)
        const transformers: any = await import('@huggingface/transformers')
        const { TextStreamer, load_image } = transformers

        const image = await load_image(request.image)
        const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: request.prompt }] }]
        const text = processor.apply_chat_template(messages, { add_generation_prompt: true, tokenize: false })
        const inputs = await processor(text, image)

        let full = ''
        const streamer = new TextStreamer(processor.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (chunk: string) => {
                full += chunk
                post({ type: 'chunk', id: request.id, chunk })
            },
        })
        await model.generate({
            ...inputs,
            max_new_tokens: request.engine.maxNewTokens,
            do_sample: false,
            streamer,
        })
        post({ type: 'done', id: request.id, text: full })
    } catch (error) {
        post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) })
    }
}

workerSelf.addEventListener('message', event => {
    const request = event.data
    if (request.type === 'warm') {
        void load(request.engine).catch(() => undefined)
        return
    }
    if (request.type === 'describe') void describe(request)
})

export {}
