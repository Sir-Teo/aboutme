// Semantic RAG over the profile knowledge base, using EmbeddingGemma.
//
// Replaces the lexical retrieve() at the chat call site (per the no-fallback
// direction: once WebGPU is gated in, we use real embeddings rather than keyword
// matching). Chunk embeddings are computed once and cached in IndexedDB keyed by
// a content hash, so repeat visits skip the work entirely.

import { KNOWLEDGE, type KnowledgeChunk } from '../../data/knowledge'
import { EMBEDDING_ENGINE } from '../engines'
import { VectorStore } from '../../lib/vectorStore'
import { embed, embedOne, rerank } from './embeddings'

type ChunkMeta = { topic: string; text: string }

// Bump implicitly via content: the cache key folds in every chunk + model + dims,
// so editing knowledge.ts or changing the embedding config rebuilds the index.
function contentHash(): string {
    const blob =
        KNOWLEDGE.map(c => `${c.id}:${c.text}`).join('|') +
        `|${EMBEDDING_ENGINE.modelId}|${EMBEDDING_ENGINE.dimensions}`
    let h = 5381
    for (let i = 0; i < blob.length; i++) h = ((h << 5) + h + blob.charCodeAt(i)) | 0
    return `kb-${(h >>> 0).toString(36)}`
}

let indexPromise: Promise<VectorStore<ChunkMeta>> | null = null

async function buildIndex(): Promise<VectorStore<ChunkMeta>> {
    const cacheKey = contentHash()
    const store = new VectorStore<ChunkMeta>({ store: 'vectors', key: cacheKey })

    if (await store.load()) return store

    // Cache miss (first visit or knowledge changed): embed every chunk as a
    // document and persist. EmbeddingGemma batches these in one worker call.
    const vectors = await embed(
        KNOWLEDGE.map(c => c.text),
        'document'
    )
    store.addMany(
        KNOWLEDGE.map((c: KnowledgeChunk, i) => ({
            id: c.id,
            vector: vectors[i] ?? [],
            metadata: { topic: c.topic, text: c.text },
        }))
    )
    await store.save()
    return store
}

function ensureIndex(): Promise<VectorStore<ChunkMeta>> {
    return (indexPromise ??= buildIndex())
}

export type RetrievedChunk = { topic: string; text: string; score: number }

// Return the top-k most semantically relevant chunks for `query`.
export async function retrieveSemantic(query: string, k = 5): Promise<RetrievedChunk[]> {
    const [store, queryVec] = await Promise.all([ensureIndex(), embedOne(query, 'query')])
    return store.search(queryVec, k).map(hit => ({
        topic: hit.metadata.topic,
        text: hit.metadata.text,
        score: hit.score,
    }))
}

// Two-stage retrieval: pull a wide candidate set with the bi-encoder, then let
// the cross-encoder reranker re-score them for sharper grounding. Falls back to
// the first-stage order if the reranker isn't available.
export async function retrieveReranked(query: string, k = 5, candidates = 20): Promise<RetrievedChunk[]> {
    const pool = await retrieveSemantic(query, candidates)
    if (pool.length <= k) return pool
    try {
        const scores = await rerank(
            query,
            pool.map(c => c.text)
        )
        return pool
            .map((c, i) => ({ ...c, score: scores[i] ?? c.score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
    } catch {
        return pool.slice(0, k)
    }
}

// Convenience: a ready-to-inject grounding block (two-stage retrieve → rerank).
export async function groundingBlock(query: string, k = 5): Promise<string> {
    const chunks = await retrieveReranked(query, k)
    return chunks.map(c => `- ${c.text}`).join('\n')
}

// Warm the index in the background so the first question doesn't wait on it.
export function warmIndex() {
    void ensureIndex().catch(() => undefined)
}

// Expose the cache key for diagnostics/eviction.
export { contentHash as knowledgeCacheKey }
