// Contract for the ingested knowledge (scripts/ingest.mjs → generated.ts). Guards
// that every auto-generated chunk is well-formed and carries a citable source, and
// that merging it with the curated facts keeps ids globally unique (a duplicate id
// would silently clobber a vector in the store).

import { describe, it, expect } from 'vitest'
import { ALL_KNOWLEDGE, KNOWLEDGE } from './knowledge'
import { GENERATED_KNOWLEDGE } from './generated'

describe('generated knowledge integrity', () => {
    it('every generated chunk is well-formed and cites a source', () => {
        for (const c of GENERATED_KNOWLEDGE) {
            expect(c.id, 'id').toBeTruthy()
            expect(c.text.length, c.id).toBeGreaterThan(10)
            expect(c.topic.length, c.id).toBeGreaterThan(2)
            expect(c.keywords.length, c.id).toBeGreaterThan(0)
            expect(c.source?.url ?? '', `${c.id} source url`).toMatch(/^https?:\/\//)
        }
    })

    it('ALL_KNOWLEDGE = curated + generated, with globally unique ids', () => {
        expect(ALL_KNOWLEDGE.length).toBe(KNOWLEDGE.length + GENERATED_KNOWLEDGE.length)
        const ids = ALL_KNOWLEDGE.map(c => c.id)
        expect(new Set(ids).size, 'duplicate ids would clobber vectors').toBe(ids.length)
    })

    it('every generated id is namespaced (gh-/blog-) so it cannot collide with curated ids', () => {
        for (const c of GENERATED_KNOWLEDGE) {
            expect(c.id, c.id).toMatch(/^(gh-|blog-)/)
        }
    })
})

// Partition the generated chunks by kind so each source's contract is checked.
const ghChunks = GENERATED_KNOWLEDGE.filter(c => c.id.startsWith('gh-'))
const blogCatChunks = GENERATED_KNOWLEDGE.filter(c => c.id.startsWith('blog-cat-'))
const blogPostChunks = GENERATED_KNOWLEDGE.filter(c => c.id.startsWith('blog-') && !c.id.startsWith('blog-cat-'))

describe('ingested GitHub repos', () => {
    it('has a healthy number of repo chunks', () => {
        expect(ghChunks.length).toBeGreaterThanOrEqual(10)
    })

    it('each cites the exact repo on GitHub and has no duplicate repo URL', () => {
        const urls = new Set<string>()
        for (const c of ghChunks) {
            expect(c.source?.label, c.id).toBe('GitHub')
            expect(c.source?.url ?? '', c.id).toMatch(/^https:\/\/github\.com\/Sir-Teo\/[^/]+$/)
            expect(c.text, c.id).toContain('GitHub repository')
            expect(urls.has(c.source!.url), `duplicate repo url ${c.source?.url}`).toBe(false)
            urls.add(c.source!.url)
        }
    })
})

describe('ingested blog', () => {
    it('has category aggregates and a healthy number of post chunks', () => {
        expect(blogCatChunks.length).toBeGreaterThanOrEqual(5)
        expect(blogPostChunks.length).toBeGreaterThanOrEqual(50)
    })

    it('category aggregates link the blog and report a count', () => {
        for (const c of blogCatChunks) {
            expect(c.source?.label, c.id).toBe('Blog')
            expect(c.source?.url, c.id).toBe('https://sir-teo.github.io/blogs/')
            expect(c.text, c.id).toMatch(/research notebook has \d+ note/)
        }
    })

    it('each post cites a real .html permalink and embeds a parseable date', () => {
        const urls = new Set<string>()
        for (const c of blogPostChunks) {
            expect(c.source?.label, c.id).toBe('Blog')
            expect(c.source?.url ?? '', c.id).toMatch(
                /^https:\/\/sir-teo\.github\.io\/blogs\/[a-z-]+\/\d{4}\/\d{2}\/\d{2}\/.+\.html$/
            )
            expect(c.text, c.id).toMatch(/^Blog post \(\d{4}-\d{2}-\d{2},/)
            expect(urls.has(c.source!.url), `duplicate post url ${c.source?.url}`).toBe(false)
            urls.add(c.source!.url)
        }
    })
})
