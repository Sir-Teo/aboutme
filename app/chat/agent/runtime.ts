// A small promise/streaming wrapper around model.worker.ts.
//
// Both the plain chat UI and (later) the LangGraph model adapter talk to the
// model through this one object, so there is a single place that owns the
// Worker lifecycle, request ids, warm-up and graceful stop.

import type { Engine } from '../engines'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'
export type ChatMessage = { role: ChatRole; content: string }

export type ToolSpec = {
    name: string
    description: string
    parameters: Record<string, unknown>
}

export type GenerateHandlers = {
    onChunk?: (chunk: string) => void
    onProgress?: (progress: string) => void
    onReady?: () => void
    signal?: AbortSignal
}

type EngineConfig = {
    id: string
    modelId: string
    dtype: Engine['dtype']
    maxNewTokens: number
}

type WorkerResponse =
    | { type: 'progress'; engineId: string; progress: string }
    | { type: 'ready'; engineId: string }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'done'; id: string; text: string }
    | { type: 'error'; id?: string; message: string }

let worker: Worker | null = null
let nextId = 0

type Pending = {
    resolve: (text: string) => void
    reject: (error: Error) => void
    handlers: GenerateHandlers
}
const pending = new Map<string, Pending>()
const progressListeners = new Set<(progress: string) => void>()
const readyListeners = new Set<() => void>()

function engineConfig(engine: Engine): EngineConfig {
    return {
        id: engine.id,
        modelId: engine.modelId,
        dtype: engine.dtype,
        maxNewTokens: engine.maxNewTokens,
    }
}

function ensureWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('../../components/model.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data
        switch (msg.type) {
            case 'progress':
                progressListeners.forEach(fn => fn(msg.progress))
                pending.forEach(p => p.handlers.onProgress?.(msg.progress))
                break
            case 'ready':
                readyListeners.forEach(fn => fn())
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
    return worker
}

// Preload weights ahead of the first message so it doesn't pay cold-start.
export function warm(engine: Engine) {
    ensureWorker().postMessage({ type: 'warm', engine: engineConfig(engine) })
}

export function onProgress(fn: (progress: string) => void): () => void {
    progressListeners.add(fn)
    return () => progressListeners.delete(fn)
}

export function onReady(fn: () => void): () => void {
    readyListeners.add(fn)
    return () => readyListeners.delete(fn)
}

export function generate(
    engine: Engine,
    messages: ChatMessage[],
    handlers: GenerateHandlers = {},
    tools?: ToolSpec[]
): Promise<string> {
    const w = ensureWorker()
    const id = `g${nextId++}`
    return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject, handlers })
        if (handlers.signal) {
            if (handlers.signal.aborted) {
                w.postMessage({ type: 'stop', id })
            } else {
                handlers.signal.addEventListener('abort', () => w.postMessage({ type: 'stop', id }), { once: true })
            }
        }
        w.postMessage({ type: 'generate', id, engine: engineConfig(engine), messages, tools })
    })
}

// Interrupt every in-flight generation (used by the UI stop button).
export function stopAll() {
    if (!worker) return
    pending.forEach((_p, id) => worker!.postMessage({ type: 'stop', id }))
}

// Free the resident model's GPU memory but keep the worker thread alive (cheap
// to reload from the browser cache). Used when leaving a tab.
export function disposeModel() {
    worker?.postMessage({ type: 'dispose' })
}

export function disposeRuntime() {
    worker?.terminate()
    worker = null
    pending.clear()
}
