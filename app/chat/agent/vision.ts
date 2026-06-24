// Vision runtime adapter — owns the vision.worker (image-in, text-out VLM) and
// gives the unified chat a small surface to ask about an attached image, mirroring
// the text dispatcher in runtime.ts (warm / describe / dispose).
//
// The vision worker has no "dispose" message and holds a multi-GB model, so we
// free its VRAM by terminating the worker. Combined with runtime.disposeModel()
// for the text LLM, this lets the chat keep exactly one big model resident at a
// time — the on-device equivalent of a frontier app's single multimodal brain.

import type { Engine } from '../engines'

type VisionConfig = { id: string; modelId: string; modelClass: string; dtype: string; maxNewTokens: number }

type Handlers = {
    onChunk?: (chunk: string) => void
    onProgress?: (progress: string) => void
    onReady?: () => void
    signal?: AbortSignal
}

type WorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'ready' }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'done'; id: string; text: string }
    | { type: 'error'; id?: string; message: string }

// Vision answers (describe / OCR) can be long; give them a generous ceiling rather
// than the engine's small chat default.
const VISION_MAX_TOKENS = 1024

let worker: Worker | null = null
let nextId = 0
const pending = new Map<string, { resolve: (text: string) => void; reject: (e: Error) => void; handlers: Handlers }>()

function cfg(engine: Engine): VisionConfig {
    return {
        id: engine.id,
        modelId: engine.modelId,
        modelClass: engine.modelClass ?? '',
        dtype: engine.dtype,
        maxNewTokens: VISION_MAX_TOKENS,
    }
}

function ensureWorker(): Worker {
    if (worker) return worker
    const w = new Worker(new URL('../../components/vision.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data
        switch (msg.type) {
            case 'progress':
                pending.forEach(p => p.handlers.onProgress?.(msg.progress))
                break
            case 'ready':
                pending.forEach(p => p.handlers.onReady?.())
                break
            case 'chunk':
                pending.get(msg.id)?.handlers.onChunk?.(msg.chunk)
                break
            case 'done': {
                const p = pending.get(msg.id)
                if (p) {
                    pending.delete(msg.id)
                    p.resolve(msg.text)
                }
                break
            }
            case 'error': {
                if (msg.id) {
                    const p = pending.get(msg.id)
                    if (p) {
                        pending.delete(msg.id)
                        p.reject(new Error(msg.message))
                    }
                }
                break
            }
        }
    }
    worker = w
    return w
}

// Preload the VLM weights ahead of the first image question.
export function warmVision(engine: Engine) {
    ensureWorker().postMessage({ type: 'warm', engine: cfg(engine) })
}

// Ask a VLM about an image (data URL). Streams the answer via handlers.onChunk.
export function describeImage(engine: Engine, image: string, prompt: string, handlers: Handlers = {}): Promise<string> {
    const w = ensureWorker()
    const id = `vd${nextId++}`
    return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject, handlers })
        // The worker can't interrupt a generation, so honour an abort by tearing the
        // worker down (which also frees the model's VRAM).
        if (handlers.signal) {
            if (handlers.signal.aborted) {
                pending.delete(id)
                disposeVisionModel()
                reject(new Error('Stopped.'))
                return
            }
            handlers.signal.addEventListener(
                'abort',
                () => {
                    if (pending.has(id)) {
                        pending.delete(id)
                        disposeVisionModel()
                        reject(new Error('Stopped.'))
                    }
                },
                { once: true }
            )
        }
        w.postMessage({ type: 'describe', id, engine: cfg(engine), image, prompt })
    })
}

// Whether a vision model is (or is being) held resident.
export function visionLoaded(): boolean {
    return worker !== null
}

// Free the VLM's VRAM by terminating the worker (it reloads from browser cache on
// next use). Rejects any in-flight request.
export function disposeVisionModel() {
    if (!worker) return
    worker.terminate()
    worker = null
    pending.forEach(p => p.reject(new Error('Vision model unloaded.')))
    pending.clear()
}
