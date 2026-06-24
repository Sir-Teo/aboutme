// Pixel-vision adapter — owns the pixel worker (transformers.js) that *transforms*
// an image: background removal, depth map, object detection. Returns a finished
// PNG data URL so the result lands straight in the chat thread. Detection boxes
// are composited over the original image here on the main thread.

import { VISION_LAB_TASKS, type VisionLabTask } from '../engines'

type Box = { label: string; score: number; xmin: number; ymin: number; xmax: number; ymax: number }

type Handlers = { onProgress?: (progress: string) => void; signal?: AbortSignal }

type WorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'image'; id: string; width: number; height: number; data: Uint8ClampedArray }
    | { type: 'boxes'; id: string; boxes: Box[] }
    | { type: 'error'; id?: string; message: string }

let worker: Worker | null = null
let nextId = 0
const pending = new Map<
    string,
    { resolve: (url: string) => void; reject: (e: Error) => void; handlers: Handlers; sourceImage: string }
>()

function colorFor(label: string): string {
    let h = 0
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360
    return `hsl(${h} 80% 55%)`
}

function pixelsToDataUrl(width: number, height: number, data: Uint8ClampedArray): string {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.putImageData(new ImageData(data, width, height), 0, 0)
    return canvas.toDataURL('image/png')
}

// Draw detection boxes over the original image and read back a PNG data URL.
function compositeBoxes(sourceImage: string, boxes: Box[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            const w = img.naturalWidth
            const h = img.naturalHeight
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (!ctx) return reject(new Error('Canvas unavailable.'))
            ctx.drawImage(img, 0, 0, w, h)
            ctx.lineWidth = Math.max(2, Math.round(w / 320))
            ctx.font = `${Math.max(12, Math.round(w / 40))}px ui-sans-serif, system-ui`
            ctx.textBaseline = 'top'
            for (const b of boxes) {
                const x = b.xmin * w
                const y = b.ymin * h
                const color = colorFor(b.label)
                ctx.strokeStyle = color
                ctx.strokeRect(x, y, (b.xmax - b.xmin) * w, (b.ymax - b.ymin) * h)
                const tag = `${b.label} ${Math.round(b.score * 100)}%`
                const tw = ctx.measureText(tag).width + 8
                ctx.fillStyle = color
                ctx.fillRect(x, Math.max(0, y - 20), tw, 20)
                ctx.fillStyle = '#fff'
                ctx.fillText(tag, x + 4, Math.max(0, y - 18))
            }
            resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = () => reject(new Error('Could not load the image.'))
        img.src = sourceImage
    })
}

function ensureWorker(): Worker {
    if (worker) return worker
    const w = new Worker(new URL('../../components/pixel.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = async (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data
        if (msg.type === 'progress') {
            pending.forEach(p => p.handlers.onProgress?.(msg.progress))
            return
        }
        if (msg.type === 'image') {
            const p = pending.get(msg.id)
            if (p) {
                pending.delete(msg.id)
                p.resolve(pixelsToDataUrl(msg.width, msg.height, msg.data))
            }
        } else if (msg.type === 'boxes') {
            const p = pending.get(msg.id)
            if (p) {
                pending.delete(msg.id)
                try {
                    p.resolve(await compositeBoxes(p.sourceImage, msg.boxes))
                } catch (e) {
                    p.reject(e instanceof Error ? e : new Error('Box compositing failed.'))
                }
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

// Run a pixel task on an image (data URL); resolves to the result as a PNG data URL.
export function runImageOp(task: VisionLabTask, image: string, handlers: Handlers = {}): Promise<string> {
    const def = VISION_LAB_TASKS.find(t => t.id === task) ?? VISION_LAB_TASKS[0]
    const w = ensureWorker()
    const id = `px${nextId++}`
    return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject, handlers, sourceImage: image })
        if (handlers.signal) {
            if (handlers.signal.aborted) {
                pending.delete(id)
                disposePixelOps()
                reject(new Error('Stopped.'))
                return
            }
            handlers.signal.addEventListener(
                'abort',
                () => {
                    if (pending.has(id)) {
                        pending.delete(id)
                        disposePixelOps()
                        reject(new Error('Stopped.'))
                    }
                },
                { once: true }
            )
        }
        w.postMessage({ type: 'run', id, task: def.id, modelId: def.modelId, image })
    })
}

export function pixelOpsLoaded(): boolean {
    return worker !== null
}

export function disposePixelOps() {
    if (!worker) return
    worker.terminate()
    worker = null
    pending.forEach(p => p.reject(new Error('Pixel model unloaded.')))
    pending.clear()
}
