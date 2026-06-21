// Pixel-vision worker: the "vision lab" toys that transform an image rather than
// chat about it — background removal, depth estimation and object detection. All
// run on WebGPU via transformers.js pipelines, fully on-device. Image results are
// returned as raw RGBA so the main thread can paint them to a canvas; detection
// returns normalized boxes.

type Task = 'background-removal' | 'depth-estimation' | 'object-detection'

type Req =
    | { type: 'warm'; task: Task; modelId: string }
    | { type: 'run'; id: string; task: Task; modelId: string; image: string }

type Box = { label: string; score: number; xmin: number; ymin: number; xmax: number; ymax: number }
type Res =
    | { type: 'progress'; progress: string }
    | { type: 'image'; id: string; width: number; height: number; data: Uint8ClampedArray }
    | { type: 'boxes'; id: string; boxes: Box[] }
    | { type: 'error'; id?: string; message: string }

const workerSelf = self as unknown as {
    postMessage(message: Res, transfer?: Transferable[]): void
    addEventListener(type: 'message', listener: (event: MessageEvent<Req>) => void): void
}
function post(m: Res, transfer?: Transferable[]) {
    workerSelf.postMessage(m, transfer)
}

const pipes = new Map<string, any>()
const loading = new Map<string, Promise<any>>()

async function getPipe(task: Task, modelId: string) {
    const key = `${task}:${modelId}`
    if (pipes.has(key)) return pipes.get(key)
    if (loading.has(key)) return loading.get(key)
    const p = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers')
        env.allowLocalModels = false
        env.useBrowserCache = true
        const pipe = await pipeline(task, modelId, {
            device: 'webgpu',
            progress_callback: (pr: any) => {
                if (pr?.status === 'progress' && typeof pr.progress === 'number')
                    post({ type: 'progress', progress: `Downloading model… ${Math.round(pr.progress)}%` })
            },
        } as any)
        pipes.set(key, pipe)
        return pipe
    })()
    loading.set(key, p)
    try {
        return await p
    } finally {
        loading.delete(key)
    }
}

function rgbaOf(img: any): { width: number; height: number; data: Uint8ClampedArray } {
    const r = img.rgba()
    const data = r.data instanceof Uint8ClampedArray ? r.data : new Uint8ClampedArray(r.data)
    return { width: r.width, height: r.height, data }
}

async function run(req: Extract<Req, { type: 'run' }>) {
    try {
        const pipe = await getPipe(req.task, req.modelId)

        if (req.task === 'object-detection') {
            const result: any = await pipe(req.image, { threshold: 0.5, percentage: true })
            const boxes: Box[] = (Array.isArray(result) ? result : []).map((d: any) => ({
                label: d.label,
                score: d.score,
                xmin: d.box.xmin,
                ymin: d.box.ymin,
                xmax: d.box.xmax,
                ymax: d.box.ymax,
            }))
            post({ type: 'boxes', id: req.id, boxes })
            return
        }

        const result: any = await pipe(req.image)
        // background-removal → RawImage[]; depth-estimation → { depth: RawImage }.
        const img = req.task === 'background-removal' ? (Array.isArray(result) ? result[0] : result) : result.depth
        const { width, height, data } = rgbaOf(img)
        post({ type: 'image', id: req.id, width, height, data }, [data.buffer])
    } catch (error) {
        post({ type: 'error', id: req.id, message: error instanceof Error ? error.message : String(error) })
    }
}

workerSelf.addEventListener('message', event => {
    const req = event.data
    if (req.type === 'warm') void getPipe(req.task, req.modelId).catch(() => undefined)
    else if (req.type === 'run') void run(req)
})

export {}
