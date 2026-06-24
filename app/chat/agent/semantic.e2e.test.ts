// Bi-encoder semantic probe (the real thing). Loads EmbeddingGemma via
// transformers.js (CPU in Node) and reproduces the dense stage — same contextual
// embedText, task prefixes, mean pooling, MRL truncation to 256 dims, cosine — then
// asserts the right curated chunk is in the bi-encoder's top-3 for a battery of
// paraphrased questions. (The full production path — dense + BM25 + RRF + rerank,
// with recall@k/MRR metrics — is audited in retrieval-hybrid.e2e.test.ts.)
//
// Downloads ~180 MB on first run, so it's opt-in:
//
//     RUN_SEMANTIC=1 npm test
//
// (The always-on suites — knowledge.test.ts, hybrid.test.ts — cover the same KB
// without a model download.)

import { describe, it, expect, beforeAll } from 'vitest'
import { KNOWLEDGE } from '../../data/knowledge'
import { embedText } from './hybrid'

const EMBED_MODEL = 'onnx-community/embeddinggemma-300m-ONNX'
const DIMS = 256

const run = process.env.RUN_SEMANTIC ? describe : describe.skip

function truncateNormalize(vec: number[], dims: number): number[] {
    const sliced = vec.slice(0, dims)
    let norm = 0
    for (const v of sliced) norm += v * v
    norm = Math.sqrt(norm) || 1
    return sliced.map(v => v / norm)
}
function withPrefix(text: string, kind: 'query' | 'document'): string {
    return kind === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}`
}
function dot(a: number[], b: number[]): number {
    let s = 0
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) s += a[i] * b[i]
    return s
}

run('semantic retrieval accuracy (EmbeddingGemma)', () => {
    let extractor: any
    let docVecs: number[][] = []

    beforeAll(async () => {
        const { pipeline } = await import('@huggingface/transformers')
        extractor = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q4' })
        const docs = KNOWLEDGE.map(c => withPrefix(embedText(c), 'document'))
        const out = await extractor(docs, { pooling: 'mean', normalize: true })
        docVecs = out.tolist().map((v: number[]) => truncateNormalize(v, DIMS))
    }, 600000)

    // Bi-encoder top-3 ids. We assert top-3 (not strict #1) because production
    // reranks a wide pool anyway, and the contextual+keyword embedding can reshuffle
    // near-ties at the very top — what matters is that the right chunk is in front.
    async function topIds(query: string, k = 3): Promise<string[]> {
        const out = await extractor(withPrefix(query, 'query'), { pooling: 'mean', normalize: true })
        const q = truncateNormalize(out.tolist()[0], DIMS)
        return KNOWLEDGE.map((c, i) => ({ id: c.id, score: dot(q, docVecs[i]) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .map(x => x.id)
    }

    // Paraphrased questions that share little surface vocabulary with the chunk —
    // the real test of *semantic* (not keyword) retrieval.
    // `id` may list several acceptable chunks where more than one is genuinely
    // correct (e.g. the Go app is described by both its project and hobby chunks).
    const CASES: { q: string; id: string | string[] }[] = [
        // NB: very vague phrasings like "what does Teo do for a living" are a known
        // weakness of the bare 300M bi-encoder over curated-only — the production
        // hybrid path (BM25 + rerank + overview nodes) handles them, and that's
        // asserted in retrieval-hybrid.e2e.test.ts. Here we probe with fair phrasings.
        { q: "What is Teo's current job?", id: 'role' },
        { q: 'Which university gave Teo his graduate degree?', id: 'edu-nyu' },
        { q: 'What was his undergrad?', id: 'edu-ucsb' },
        { q: 'How do I get in touch with him?', id: 'contact' },
        { q: 'What sports is he into?', id: ['hobby-basketball', 'interests'] },
        { q: 'Tell me about his work on hospital scan analysis.', id: 'nyu-langone' },
        { q: 'Which coding tools does he use day to day?', id: 'skills-languages' },
        { q: 'Has he written any academic papers on the pancreas?', id: 'pub-pancreatitis' },
        {
            q: 'Which app did he build with TensorFlow.js and Monte Carlo Tree Search?',
            id: ['proj-katrain', 'hobby-go'],
        },
        { q: 'Does he keep an online journal of technical notes?', id: 'blog' },
    ]

    for (const c of CASES) {
        const accept = Array.isArray(c.id) ? c.id : [c.id]
        it(`"${c.q}" → ${accept.join(' | ')} (top-3)`, async () => {
            const ids = await topIds(c.q, 3)
            expect(
                ids.some(id => accept.includes(id)),
                `top-3: ${ids.join(', ')}`
            ).toBe(true)
        }, 60000)
    }
})
