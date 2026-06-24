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
import { embedText, lexicalSearch, rrf, chunkById } from './hybrid'

// Bump to invalidate every cached embedding index when the indexing scheme (not
// just the KB content) changes — e.g. the switch to contextual embedText below.
const INDEX_VERSION = 'ctx-hybrid-v2'

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
        `|${EMBEDDING_ENGINE.modelId}|${EMBEDDING_ENGINE.dimensions}|${INDEX_VERSION}`
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
        // Embed the CONTEXTUAL text (subject + topic + body), not the bare body, so
        // chunks with vague self-reference still retrieve. Display text is unchanged.
        const embedded = await embed(
            batch.map(c => embedText(c)),
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

export type RetrievedChunk = { id: string; topic: string; text: string; score: number; source?: Source }

// Return the top-k most semantically relevant chunks for `query` (dense bi-encoder).
export async function retrieveSemantic(query: string, k = 5): Promise<RetrievedChunk[]> {
    const [store, queryVec] = await Promise.all([ensureIndex(), embedOne(query, 'query')])
    return store.search(queryVec, k).map(hit => ({
        id: hit.id,
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

// Three-stage HYBRID retrieval — the production grounding path:
//   1. dense bi-encoder  → top-`pool` (semantic breadth)
//   2. BM25 lexical      → top-`pool` (exact-token recall: codes, IDs, names)
//   3. RRF-fuse the two rankings, then cross-encoder rerank the fused pool → top-k.
// Falls back gracefully: if the reranker is unavailable, the RRF order stands.
export async function retrieveHybrid(query: string, k = 5, pool = 40): Promise<RetrievedChunk[]> {
    const dense = await retrieveSemantic(query, pool)
    const lexical = lexicalSearch(query, pool)
    const denseById = new Map(dense.map(d => [d.id, d]))

    const fusedIds = rrf([dense.map(d => d.id), lexical.map(l => l.id)]).slice(0, pool)
    const candidates: RetrievedChunk[] = fusedIds
        .map(id => {
            const hit = denseById.get(id)
            if (hit) return hit
            const c = chunkById(id)
            return c ? { id, topic: c.topic, text: c.text, score: 0, source: c.source } : null
        })
        .filter((c): c is RetrievedChunk => c !== null)

    if (candidates.length <= k) return candidates
    try {
        const scores = await rerank(
            query,
            candidates.map(c => c.text)
        )
        return candidates
            .map((c, i) => ({ ...c, score: scores[i] ?? c.score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
    } catch {
        return candidates.slice(0, k)
    }
}

// Convenience: a ready-to-inject grounding block (hybrid retrieve → rerank).
// Default k=8 gives the model a richer, fuller fact set to compose from.
export async function groundingBlock(query: string, k = 8): Promise<string> {
    const chunks = await retrieveHybrid(query, k)
    return chunks.map(c => `- ${c.text}`).join('\n')
}

// Like groundingBlock, but also returns the distinct sources behind the grounding
// so the UI can cite them. De-duped by URL, in retrieval-rank order.
export async function groundingWithSources(query: string, k = 8): Promise<{ text: string; sources: Source[] }> {
    const chunks = await retrieveHybrid(query, k)
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
