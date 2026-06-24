// Semantic RAG over the profile knowledge base, using EmbeddingGemma.
//
// Replaces the lexical retrieve() at the chat call site (per the no-fallback
// direction: once WebGPU is gated in, we use real embeddings rather than keyword
// matching). Chunk embeddings are computed once and cached in IndexedDB keyed by
// a content hash, so repeat visits skip the work entirely.

import { ALL_KNOWLEDGE, type KnowledgeChunk, type Source } from '../../data/knowledge'
import { EMBEDDING_ENGINE } from '../engines'
import { VectorStore } from '../../lib/vectorStore'
import { embed, embedOne, rerank } from './embeddings'

type ChunkMeta = { topic: string; text: string; source?: Source }

// Embed the knowledge base in bounded sub-batches rather than one giant forward
// pass: the KB now spans hundreds of chunks (curated facts + ingested GitHub/blog),
// and padding ~400 texts into a single WebGPU batch would spike memory on weaker
// GPUs. 32 keeps the forward pass small while still amortizing per-call overhead.
const EMBED_BATCH = 32

// Bump implicitly via content: the cache key folds in every chunk + source + model
// + dims, so editing the KB (or re-running `npm run ingest`) rebuilds the index.
function contentHash(): string {
    const blob =
        ALL_KNOWLEDGE.map(c => `${c.id}:${c.text}:${c.source?.url ?? ''}`).join('|') +
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
    // document, in bounded batches, and persist. One-time cost — cached in
    // IndexedDB keyed by the content hash, so repeat visits skip it entirely.
    const vectors: number[][] = []
    for (let i = 0; i < ALL_KNOWLEDGE.length; i += EMBED_BATCH) {
        const batch = ALL_KNOWLEDGE.slice(i, i + EMBED_BATCH)
        const embedded = await embed(
            batch.map(c => c.text),
            'document'
        )
        vectors.push(...embedded)
    }
    store.addMany(
        ALL_KNOWLEDGE.map((c: KnowledgeChunk, i) => ({
            id: c.id,
            vector: vectors[i] ?? [],
            metadata: { topic: c.topic, text: c.text, source: c.source },
        }))
    )
    await store.save()
    return store
}

function ensureIndex(): Promise<VectorStore<ChunkMeta>> {
    return (indexPromise ??= buildIndex())
}

export type RetrievedChunk = { topic: string; text: string; score: number; source?: Source }

// Return the top-k most semantically relevant chunks for `query`.
export async function retrieveSemantic(query: string, k = 5): Promise<RetrievedChunk[]> {
    const [store, queryVec] = await Promise.all([ensureIndex(), embedOne(query, 'query')])
    return store.search(queryVec, k).map(hit => ({
        topic: hit.metadata.topic,
        text: hit.metadata.text,
        score: hit.score,
        source: hit.metadata.source,
    }))
}

// Two-stage retrieval: pull a wide candidate set with the bi-encoder, then let
// the cross-encoder reranker re-score them for sharper grounding. Falls back to
// the first-stage order if the reranker isn't available. The candidate pool is
// wide (40) so a curated fact still reaches the reranker even when the bi-encoder
// surfaces many ingested chunks first — widened as the KB grew past ~500 (curated +
// GitHub/blog + the privacy-screened vault coursework/research pass).
export async function retrieveReranked(query: string, k = 5, candidates = 40): Promise<RetrievedChunk[]> {
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

// Like groundingBlock, but also returns the distinct sources behind the grounding
// so the UI can cite them. De-duped by URL, in retrieval-rank order.
export async function groundingWithSources(query: string, k = 5): Promise<{ text: string; sources: Source[] }> {
    const chunks = await retrieveReranked(query, k)
    const seen = new Set<string>()
    const sources: Source[] = []
    for (const c of chunks) {
        if (c.source && !seen.has(c.source.url)) {
            seen.add(c.source.url)
            sources.push(c.source)
        }
    }
    return { text: chunks.map(c => `- ${c.text}`).join('\n'), sources }
}

// Warm the index in the background so the first question doesn't wait on it.
export function warmIndex() {
    void ensureIndex().catch(() => undefined)
}

// Expose the cache key for diagnostics/eviction.
export { contentHash as knowledgeCacheKey }
