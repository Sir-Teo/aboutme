// Image-generation adapter — owns the SD-Turbo worker (onnxruntime-web, WebGPU)
// and returns a finished PNG data URL so a generated image drops straight into the
// chat thread. Mirrors the text/vision dispatchers (warm-free; generate / dispose).
//
// SD-Turbo is the heaviest model here (~2.5 GB), so callers free the other big
// models first — one large model resident at a time.

type Handlers = { onProgress?: (progress: string) => void; signal?: AbortSignal }

type WorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'image'; id: string; width: number; height: number; data: Uint8ClampedArray }
    | { type: 'error'; id?: string; message: string }

let worker: Worker | null = null
let nextId = 0
const pending = new Map<string, { resolve: (url: string) => void; reject: (e: Error) => void; handlers: Handlers }>()

// Paint raw RGBA pixels onto a canvas and read back a PNG data URL.
function toDataUrl(width: number, height: number, data: Uint8ClampedArray): string {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.putImageData(new ImageData(data, width, height), 0, 0)
    return canvas.toDataURL('image/png')
}

function ensureWorker(): Worker {
    if (worker) return worker
    const w = new Worker(new URL('../../components/imagegen.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data
        if (msg.type === 'progress') {
            pending.forEach(p => p.handlers.onProgress?.(msg.progress))
        } else if (msg.type === 'image') {
            const p = pending.get(msg.id)
            if (p) {
                pending.delete(msg.id)
                p.resolve(toDataUrl(msg.width, msg.height, msg.data))
            }
        } else if (msg.type === 'error' && msg.id) {
            const p = pending.get(msg.id)
            if (p) {
                pending.delete(msg.id)
                p.reject(new Error(msg.message))
            }
        }
    }
    worker = w
    return w
}

// Generate a 512² image from a prompt; resolves to a PNG data URL.
export function generateImage(prompt: string, handlers: Handlers = {}): Promise<string> {
    const w = ensureWorker()
    const id = `ig${nextId++}`
    return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject, handlers })
        if (handlers.signal) {
            if (handlers.signal.aborted) {
                pending.delete(id)
                disposeImageGen()
                reject(new Error('Stopped.'))
                return
            }
            handlers.signal.addEventListener(
                'abort',
                () => {
                    if (pending.has(id)) {
                        pending.delete(id)
                        disposeImageGen()
                        reject(new Error('Stopped.'))
                    }
                },
                { once: true }
            )
        }
        w.postMessage({ type: 'generate', id, prompt })
    })
}

export function imageGenLoaded(): boolean {
    return worker !== null
}

export function disposeImageGen() {
    if (!worker) return
    worker.terminate()
    worker = null
    pending.forEach(p => p.reject(new Error('Image generator unloaded.')))
    pending.clear()
}
