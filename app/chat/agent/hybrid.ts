// Hybrid-retrieval primitives shared by the production retriever (retrieval.ts)
// and the eval/e2e tests, so both exercise the EXACT same logic:
//
//   • embedText()   — contextual prefix prepended to every chunk before it's
//     embedded AND lexically indexed (Anthropic "Contextual Retrieval", done
//     deterministically with no LLM — our chunks already carry topic/subject).
//   • BM25          — sparse lexical search; rescues exact-token queries that
//     dense embeddings blur (course codes, IDs: "PSTAT 120A", "DINOv2", "rag-law").
//   • rrf()         — Reciprocal Rank Fusion to merge the dense and lexical
//     rankings before the cross-encoder rerank.
//
// Pure and worker-free (no transformers.js, no IndexedDB) so it imports cleanly in
// Node tests as well as the browser.

import { ALL_KNOWLEDGE, type KnowledgeChunk } from '../../data/knowledge'

// ─────────────────────────────── contextual text ─────────────────────────────
// Situate each chunk under its subject + topic so a vague body ("the company",
// "this course", "C-index 0.85") still retrieves. The same string is embedded and
// BM25-indexed; the ORIGINAL `text` is still what grounds the answer.
const SUBJECT = 'Weicheng "Teo" Zeng, a data scientist and AI/ML engineer'
export function embedText(c: { topic: string; text: string; keywords?: string[] }): string {
    // Fold in the curated keywords too: they're hand-picked synonyms/aliases that
    // are often ABSENT from the body ("undergraduate" vs "B.S.", "masterteo1205"),
    // so embedding + BM25-indexing them closes real query↔doc vocabulary gaps.
    const aliases = c.keywords?.length ? ` Related: ${c.keywords.join(', ')}.` : ''
    return `${SUBJECT}. ${c.topic}. ${c.text}${aliases}`
}

// ───────────────────────────────── BM25 lexical ──────────────────────────────
const BM25_K1 = 1.5
const BM25_B = 0.75

// Keep +, #, ., - so tech tokens survive ("c++", "dinov2", "masterteo1205", "120a").
const STOP = new Set([
    'a',
    'an',
    'and',
    'the',
    'of',
    'to',
    'in',
    'on',
    'for',
    'is',
    'are',
    'was',
    'were',
    'be',
    'do',
    'does',
    'did',
    'has',
    'have',
    'had',
    'what',
    'which',
    'who',
    'when',
    'where',
    'why',
    'how',
    'tell',
    'me',
    'about',
    'his',
    'he',
    'her',
    'she',
    'they',
    'it',
    'this',
    'that',
    'with',
    'as',
    'at',
    'by',
    'or',
    'i',
    'you',
    'your',
    'teo',
    'teos',
    'can',
    'any',
    'from',
    'into',
])

export function lexTokenize(text: string): string[] {
    return (
        text
            .toLowerCase()
            .replace(/[^a-z0-9+#.\s-]/g, ' ')
            .split(/\s+/)
            // Strip sentence punctuation at token edges so "pytorch." matches "pytorch"
            // and "analysis," matches "analysis", while keeping internal dots/pluses
            // ("chess.com", "c++", "3.90", "120a").
            .map(t => t.replace(/^[.\-]+|[.\-]+$/g, ''))
            .filter(t => t.length > 1 && !STOP.has(t))
    )
}

export class BM25 {
    private readonly ids: string[]
    private readonly docLen: number[]
    private readonly avgdl: number
    private readonly idf = new Map<string, number>()
    // term → (docIndex → term frequency)
    private readonly postings = new Map<string, Map<number, number>>()

    constructor(docs: { id: string; text: string }[]) {
        this.ids = docs.map(d => d.id)
        this.docLen = new Array(docs.length).fill(0)
        const df = new Map<string, number>()
        docs.forEach((doc, i) => {
            const terms = lexTokenize(doc.text)
            this.docLen[i] = terms.length
            const tf = new Map<string, number>()
            for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1)
            tf.forEach((freq, t) => {
                if (!this.postings.has(t)) this.postings.set(t, new Map())
                this.postings.get(t)!.set(i, freq)
                df.set(t, (df.get(t) ?? 0) + 1)
            })
        })
        const N = docs.length
        this.avgdl = this.docLen.reduce((a, b) => a + b, 0) / (N || 1)
        // Robertson–Spärck-Jones idf with the standard +1 to keep it non-negative.
        df.forEach((n, t) => this.idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5))))
    }

    search(query: string, k = 40): { id: string; score: number }[] {
        const terms = Array.from(new Set(lexTokenize(query)))
        const scores = new Map<number, number>()
        for (const t of terms) {
            const idf = this.idf.get(t)
            const posting = this.postings.get(t)
            if (idf === undefined || !posting) continue
            posting.forEach((freq, docIdx) => {
                const norm = freq + BM25_K1 * (1 - BM25_B + (BM25_B * this.docLen[docIdx]) / this.avgdl)
                const add = idf * ((freq * (BM25_K1 + 1)) / norm)
                scores.set(docIdx, (scores.get(docIdx) ?? 0) + add)
            })
        }
        return Array.from(scores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, k)
            .map(([idx, score]) => ({ id: this.ids[idx], score }))
    }
}

// Lazy singleton BM25 over the full KB (curated + overviews + ingested + vault),
// indexed on the SAME contextual text the embeddings use.
let _bm25: BM25 | null = null
export function lexicalSearch(query: string, k = 40): { id: string; score: number }[] {
    _bm25 ??= new BM25(ALL_KNOWLEDGE.map(c => ({ id: c.id, text: embedText(c) })))
    return _bm25.search(query, k)
}

// ───────────────────────────── reciprocal rank fusion ────────────────────────
// Merge several ranked id-lists. A doc ranked high in any list scores well; a doc
// ranked across multiple lists wins. k (=60, the canonical TREC value) damps the
// influence of the very top ranks so lower-but-agreed results can surface.
export function rrf(rankedLists: string[][], k = 60): string[] {
    const score = new Map<string, number>()
    for (const list of rankedLists) {
        list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)))
    }
    return Array.from(score.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id)
}

// ───────────────────────────────── id → chunk ────────────────────────────────
let _byId: Map<string, KnowledgeChunk> | null = null
export function chunkById(id: string): KnowledgeChunk | undefined {
    _byId ??= new Map(ALL_KNOWLEDGE.map(c => [c.id, c] as [string, KnowledgeChunk]))
    return _byId.get(id)
}
