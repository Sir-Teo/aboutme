// Always-on tests for the hybrid-retrieval primitives (no model download). These
// pin the deterministic pieces — contextual prefixing, BM25 lexical recall, RRF
// fusion, the id map — and the golden-set integrity, so the heavy e2e
// (retrieval-hybrid.e2e.test.ts) only has to measure accuracy, not catch typos.

import { describe, it, expect } from 'vitest'
import { embedText, lexTokenize, BM25, rrf, lexicalSearch, chunkById } from './hybrid'
import { ALL_KNOWLEDGE, OVERVIEW_KNOWLEDGE } from '../../data/knowledge'
import { GOLDEN } from '../../data/eval.golden'

describe('contextual embedText', () => {
    it('prepends the subject and topic to the body', () => {
        expect(embedText({ topic: 'Education', text: 'M.S. at NYU.' })).toBe(
            'Weicheng "Teo" Zeng, a data scientist and AI/ML engineer. Education. M.S. at NYU.'
        )
    })
})

describe('lexTokenize', () => {
    it('keeps tech tokens and ids intact, drops stopwords', () => {
        const t = lexTokenize('What is C++ and DINOv2 for masterteo1205 in PSTAT 120A?')
        expect(t).toContain('c++')
        expect(t).toContain('dinov2')
        expect(t).toContain('masterteo1205')
        expect(t).toContain('120a')
        expect(t).not.toContain('what') // stopword
        expect(t).not.toContain('is')
    })
})

describe('BM25 lexical search', () => {
    const docs = [
        { id: 'cpp', text: 'Programs in C++ and Python with PyTorch and machine learning.' },
        { id: 'chess', text: 'Plays chess on Chess.com as masterteo1205 and studies machine learning.' },
        { id: 'math', text: 'Real analysis, topology, and abstract algebra coursework.' },
    ]
    const bm25 = new BM25(docs)

    it('finds the doc containing an exact rare token (period-insensitive)', () => {
        expect(bm25.search('masterteo1205', 1)[0].id).toBe('chess')
        expect(bm25.search('topology', 1)[0].id).toBe('math')
        expect(bm25.search('pytorch', 1)[0].id).toBe('cpp') // "PyTorch." must match "pytorch"
    })

    it('ranks by relevance and respects k', () => {
        const hits = bm25.search('machine learning', 2) // shared by cpp + chess
        expect(hits.length).toBe(2)
        expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score)
    })

    it('returns nothing for an out-of-vocabulary query', () => {
        expect(lexTokenize('zzzqqq')).toEqual(['zzzqqq'])
        expect(bm25.search('zzzqqq', 5)).toEqual([])
    })
})

describe('reciprocal rank fusion', () => {
    it('rewards ids that appear high across multiple lists', () => {
        const fused = rrf([
            ['a', 'b', 'c'],
            ['c', 'd', 'a'],
        ])
        // a and c each appear in both lists → they outrank the singletons b and d.
        expect(new Set(fused.slice(0, 2))).toEqual(new Set(['a', 'c']))
        expect(fused.indexOf('a')).toBeLessThan(fused.indexOf('b'))
        expect(fused.indexOf('c')).toBeLessThan(fused.indexOf('d'))
    })
})

describe('lexicalSearch over the live KB', () => {
    it("surfaces Teo's chess handle for an exact-token query", () => {
        const ids = lexicalSearch('masterteo1205', 5).map(h => h.id)
        expect(ids.some(id => id === 'hobby-chess' || id === 'socials')).toBe(true)
    })
    it('surfaces a pancreatitis chunk for clinical jargon', () => {
        const ids = lexicalSearch('AUPRC pancreatitis CT severity', 8).map(h => h.id)
        expect(ids).toContain('pub-pancreatitis')
    })
})

describe('chunkById', () => {
    it('resolves known ids and returns undefined otherwise', () => {
        expect(chunkById('role')?.id).toBe('role')
        expect(chunkById('overview-bio')?.topic).toMatch(/overview/i)
        expect(chunkById('does-not-exist')).toBeUndefined()
    })
})

describe('overview (summary) tier', () => {
    it('has the six global-question nodes, each cited', () => {
        expect(OVERVIEW_KNOWLEDGE.length).toBe(6)
        for (const c of OVERVIEW_KNOWLEDGE) {
            expect(c.id).toMatch(/^overview-/)
            expect(c.text.length).toBeGreaterThan(120)
            expect(c.source?.url ?? '').toMatch(/^https?:\/\//)
        }
    })
})

describe('golden eval set integrity', () => {
    const known = new Set(ALL_KNOWLEDGE.map(c => c.id))
    it('every golden case has a question and at least one expected id', () => {
        for (const g of GOLDEN) {
            expect(g.q.length, g.q).toBeGreaterThan(5)
            expect(g.ids.length, g.q).toBeGreaterThan(0)
        }
    })
    it('every expected id exists in the knowledge base', () => {
        for (const g of GOLDEN) {
            for (const id of g.ids) {
                expect(known.has(id), `golden case "${g.q}" references unknown id "${id}"`).toBe(true)
            }
        }
    })
})
