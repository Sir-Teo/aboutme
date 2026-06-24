// The LLM dispatcher: one stable surface (warm / generate / stop / dispose) that
// routes each engine to its runtime —
//   • 'transformers' → the model.worker.ts WebGPU worker (this file owns it)
//   • 'webllm'       → ./webllm.ts (MLC engine in its own worker)
//   • 'chrome'       → ./chromeai.ts (browser Prompt API, no worker)
//
// Callers (AgentChat, VoiceChat, the LangGraph model adapter) only ever import
// from here, so adding a runtime never touches the UI.

import type { Engine } from '../engines'
import type { ChatMessage, ChatRole, ToolSpec, GenerateHandlers } from './llmTypes'
import * as webllm from './webllm'
import * as chromeai from './chromeai'

// Re-export the shared types so existing imports (`from './runtime'`) keep working.
export type { ChatMessage, ChatRole, ToolSpec, GenerateHandlers }

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

// ───────────────────────────── transformers.js worker ────────────────────────

let worker: Worker | null = null
let nextId = 0

// Which engine is currently resident (in GPU memory) right now, across runtimes.
// Drives the model manager's "Loaded" indicator. One model is resident at a time.
let loadedEngineId: string | null = null
const loadedListeners = new Set<(id: string | null) => void>()
function setLoaded(id: string | null) {
    if (loadedEngineId === id) return
    loadedEngineId = id
    loadedListeners.forEach(fn => fn(id))
}
export function loadedEngineId_(): string | null {
    return loadedEngineId
}
export function onLoadedChange(fn: (id: string | null) => void): () => void {
    loadedListeners.add(fn)
    return () => loadedListeners.delete(fn)
}
// WebLLM reports its own load/unload; mirror it into the shared loaded state.
webllm.onLoaded(id => setLoaded(id))

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
                setLoaded(msg.engineId)
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

function tfWarm(engine: Engine) {
    ensureWorker().postMessage({ type: 'warm', engine: engineConfig(engine) })
}

function tfGenerate(
    engine: Engine,
    messages: ChatMessage[],
    handlers: GenerateHandlers,
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

// ───────────────────────────────── public API ────────────────────────────────

// Preload weights ahead of the first message so it doesn't pay cold-start.
export function warm(engine: Engine) {
    if (engine.runtime === 'webllm') return webllm.warm(engine)
    if (engine.runtime === 'chrome') return chromeai.warm()
    tfWarm(engine)
}

// Global progress/ready subscriptions (used by warm-up status UIs). Fans out to
// every runtime so the subscriber sees progress regardless of which engine runs.
export function onProgress(fn: (progress: string) => void): () => void {
    progressListeners.add(fn)
    const offWeb = webllm.onProgress(fn)
    return () => {
        progressListeners.delete(fn)
        offWeb()
    }
}

export function onReady(fn: () => void): () => void {
    readyListeners.add(fn)
    const offWeb = webllm.onReady(fn)
    return () => {
        readyListeners.delete(fn)
        offWeb()
    }
}

export function generate(
    engine: Engine,
    messages: ChatMessage[],
    handlers: GenerateHandlers = {},
    tools?: ToolSpec[]
): Promise<string> {
    if (engine.runtime === 'webllm') return webllm.generate(engine, messages, handlers)
    if (engine.runtime === 'chrome') {
        setLoaded(engine.id) // built-in model — "resident" as soon as it's used
        return chromeai.generate(messages, handlers)
    }
    return tfGenerate(engine, messages, handlers, tools)
}

// Interrupt every in-flight generation (used by the UI stop button).
export function stopAll() {
    if (worker) pending.forEach((_p, id) => worker!.postMessage({ type: 'stop', id }))
    void webllm.stop()
}

// Free resident model GPU memory across runtimes but keep workers alive (cheap to
// reload from the browser cache). Used when leaving a tab.
export function disposeModel() {
    worker?.postMessage({ type: 'dispose' })
    void webllm.disposeModel()
    setLoaded(null)
}

export function disposeRuntime() {
    worker?.terminate()
    worker = null
    pending.clear()
    webllm.disposeRuntime()
}
