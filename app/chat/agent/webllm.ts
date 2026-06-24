// WebLLM runtime adapter — drives MLC's in-browser engine for the bigger general
// LLMs (Llama, Qwen3, Phi, Gemma 2, SmolLM2) and gives us grammar-constrained
// JSON decoding for guaranteed-valid tool calls.
//
// Mirrors the small surface the dispatcher (runtime.ts) needs: warm / generate /
// stop / dispose. The model runs in webllm.worker.ts (off the main thread); here
// we own the engine singleton, model swaps, streaming and graceful interrupt.

import type { Engine } from '../engines'
import type { ChatMessage, GenerateHandlers } from './llmTypes'
import type { MLCEngineInterface, InitProgressReport } from '@mlc-ai/web-llm'

let worker: Worker | null = null
let engine: MLCEngineInterface | null = null
let loadedModelId: string | null = null
let loadingFor: string | null = null
let loadPromise: Promise<MLCEngineInterface> | null = null

const progressListeners = new Set<(progress: string) => void>()
const readyListeners = new Set<() => void>()
const loadedListeners = new Set<(id: string | null) => void>()

export function onProgress(fn: (progress: string) => void): () => void {
    progressListeners.add(fn)
    return () => progressListeners.delete(fn)
}
export function onReady(fn: () => void): () => void {
    readyListeners.add(fn)
    return () => readyListeners.delete(fn)
}
// Fires the Engine id when a WebLLM model becomes resident, or null when freed.
export function onLoaded(fn: (id: string | null) => void): () => void {
    loadedListeners.add(fn)
    return () => loadedListeners.delete(fn)
}

function ensureWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('../../components/webllm.worker.ts', import.meta.url), { type: 'module' })
    return worker
}

// Load (or hot-swap) the model. WebLLM caches weights in the browser, so a second
// load of the same model is fast; switching models reuses the worker via reload.
async function ensureEngine(engineDef: Engine): Promise<MLCEngineInterface> {
    if (engine && loadedModelId === engineDef.modelId) return engine
    if (loadPromise && loadingFor === engineDef.modelId) return loadPromise

    loadingFor = engineDef.modelId
    loadPromise = (async () => {
        const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm')
        const initProgressCallback = (report: InitProgressReport) => {
            const text = report.text || 'Loading…'
            progressListeners.forEach(fn => fn(text))
        }

        if (engine) {
            // Same worker, different model — reload swaps the weights in place.
            await engine.reload(engineDef.modelId)
        } else {
            engine = await CreateWebWorkerMLCEngine(ensureWorker(), engineDef.modelId, { initProgressCallback })
        }
        loadedModelId = engineDef.modelId
        readyListeners.forEach(fn => fn())
        loadedListeners.forEach(fn => fn(engineDef.id))
        return engine!
    })()

    try {
        return await loadPromise
    } finally {
        loadPromise = null
        loadingFor = null
    }
}

export function warm(engineDef: Engine) {
    void ensureEngine(engineDef).catch(() => undefined)
}

export async function generate(
    engineDef: Engine,
    messages: ChatMessage[],
    handlers: GenerateHandlers = {}
): Promise<string> {
    const { onChunk, onProgress: onProg, onReady: onRdy, signal, json, maxNewTokens } = handlers

    const unProg = onProg ? onProgress(onProg) : () => undefined
    const unRdy = onRdy ? onReady(onRdy) : () => undefined
    try {
        const eng = await ensureEngine(engineDef)
        onRdy?.()

        if (signal?.aborted) {
            await eng.interruptGenerate()
            return ''
        }
        const onAbort = () => void eng.interruptGenerate()
        signal?.addEventListener('abort', onAbort, { once: true })

        let full = ''
        try {
            const stream = await eng.chat.completions.create({
                messages: messages as any,
                stream: true,
                temperature: 0,
                max_tokens: maxNewTokens ?? engineDef.maxNewTokens,
                // Grammar-constrained JSON when the planner asks for it (XGrammar).
                ...(json ? { response_format: { type: 'json_object' as const } } : {}),
            })
            for await (const chunk of stream) {
                const delta = chunk.choices?.[0]?.delta?.content ?? ''
                if (delta) {
                    full += delta
                    onChunk?.(delta)
                }
            }
        } finally {
            signal?.removeEventListener('abort', onAbort)
        }
        return full
    } finally {
        unProg()
        unRdy()
    }
}

export async function stop() {
    try {
        await engine?.interruptGenerate()
    } catch {
        /* best-effort */
    }
}

// Free the resident model's GPU memory but keep the worker thread alive.
export async function disposeModel() {
    try {
        await engine?.unload()
    } catch {
        /* best-effort */
    }
    loadedModelId = null
    loadedListeners.forEach(fn => fn(null))
}

export function disposeRuntime() {
    void engine?.unload?.().catch?.(() => undefined)
    worker?.terminate()
    worker = null
    engine = null
    loadedModelId = null
}
