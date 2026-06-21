// Client wrapper around embed.worker.ts. Owns the embedding Worker and exposes a
// simple async `embed(texts, kind)`. Shared by RAG, long-term memory and search.

import { EMBEDDING_ENGINE, RERANKER_ENGINE } from '../engines'

type EmbedKind = 'query' | 'document'

type WorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'ready' }
    | { type: 'embeddings'; id: string; vectors: number[][] }
    | { type: 'scores'; id: string; scores: number[] }
    | { type: 'error'; id?: string; message: string }

let worker: Worker | null = null
let nextId = 0
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const progressListeners = new Set<(p: string) => void>()

function ensureWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('../../components/embed.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data
        if (msg.type === 'progress') progressListeners.forEach(fn => fn(msg.progress))
        else if (msg.type === 'embeddings') {
            const p = pending.get(msg.id)
            if (p) {
                pending.delete(msg.id)
                p.resolve(msg.vectors)
            }
        } else if (msg.type === 'scores') {
            const p = pending.get(msg.id)
            if (p) {
                pending.delete(msg.id)
                p.resolve(msg.scores)
            }
        } else if (msg.type === 'error' && msg.id) {
            const p = pending.get(msg.id)
            if (p) {
                pending.delete(msg.id)
                p.reject(new Error(msg.message))
            }
        }
    }
    return worker
}

export function warmEmbedder() {
    ensureWorker().postMessage({ type: 'warm', modelId: EMBEDDING_ENGINE.modelId, dtype: EMBEDDING_ENGINE.dtype })
}

export function onEmbedProgress(fn: (p: string) => void): () => void {
    progressListeners.add(fn)
    return () => progressListeners.delete(fn)
}

export function embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (texts.length === 0) return Promise.resolve([])
    const w = ensureWorker()
    const id = `e${nextId++}`
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        w.postMessage({
            type: 'embed',
            id,
            modelId: EMBEDDING_ENGINE.modelId,
            dtype: EMBEDDING_ENGINE.dtype,
            texts,
            kind,
            dims: EMBEDDING_ENGINE.dimensions,
        })
    })
}

export async function embedOne(text: string, kind: EmbedKind): Promise<number[]> {
    const [vector] = await embed([text], kind)
    return vector ?? []
}

// Cross-encoder rerank: returns a relevance score in [0,1] for each passage.
export function rerank(query: string, passages: string[]): Promise<number[]> {
    if (passages.length === 0) return Promise.resolve([])
    const w = ensureWorker()
    const id = `r${nextId++}`
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        w.postMessage({
            type: 'rerank',
            id,
            modelId: RERANKER_ENGINE.modelId,
            dtype: RERANKER_ENGINE.dtype,
            query,
            passages,
        })
    })
}
