// Build-time knowledge ingestion. Pulls Teo's public footprint — GitHub repos and
// the research blog — into typed KnowledgeChunk[] and writes app/data/generated.ts
// (committed, so the static export needs no network at build time).
//
//   node scripts/ingest.mjs      # or: npm run ingest
//
// Sources used (all public, CORS-friendly so the same data could be fetched live):
//   • GitHub REST API   — api.github.com/users/Sir-Teo/repos (+ per-repo README)
//   • Research blog      — sir-teo.github.io/blogs index (title + description + tags)
//
// Resilient by design: each source is independent, and if *nothing* is gathered the
// existing generated.ts is left untouched rather than wiped. Set GITHUB_TOKEN to
// raise the API rate limit; BLOG_POSTS / GH_MAX / GH_README to tune volume.

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../app/data/generated.ts')

const GITHUB_USER = 'Sir-Teo'
const BLOG_BASE = 'https://sir-teo.github.io/blogs'
// Tunables (env overrides). BLOG_POSTS=all keeps every post as its own chunk.
const GH_MAX = Number(process.env.GH_MAX ?? 40) // repos to include, by stars
const GH_README = Number(process.env.GH_README ?? 15) // README lookups for repos lacking a description
const BLOG_POSTS = process.env.BLOG_POSTS ?? 'all' // recent posts as individual chunks ('all' or a number)

const GH_HEADERS = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aboutme-ingest',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

// ───────────────────────────────── helpers ───────────────────────────────────

const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'this', 'that', 'it', 'its',
    'as', 'at', 'by', 'be', 'from', 'using', 'use', 'via', 'app', 'my', 'your', 'you', 'we', 'i',
])

function decodeEntities(s) {
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
}

function clean(s) {
    return decodeEntities(String(s ?? '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
}

function tokenize(s) {
    return clean(s)
        .toLowerCase()
        .replace(/[^a-z0-9+#.\s-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP.has(t))
}

// Unique, capped keyword list from several term sources.
function keywords(...parts) {
    const out = []
    const seen = new Set()
    for (const t of parts.flat()) {
        if (t && !seen.has(t)) {
            seen.add(t)
            out.push(t)
        }
    }
    return out.slice(0, 18)
}

function titleCase(slug) {
    return slug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
}

async function getJson(url) {
    const res = await fetch(url, { headers: GH_HEADERS })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
    return res.json()
}

// ─────────────────────────────────── GitHub ──────────────────────────────────

async function ingestGithub() {
    const repos = await getJson(
        `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&type=owner&sort=pushed`
    )
    const owned = repos
        .filter(r => !r.fork && !r.private)
        .sort((a, b) => (b.stargazers_count - a.stargazers_count) || (Date.parse(b.pushed_at) - Date.parse(a.pushed_at)))
        .slice(0, GH_MAX)

    let readmeBudget = GH_README
    const chunks = []
    for (const r of owned) {
        let description = clean(r.description)
        // Backfill missing descriptions from the README's first real sentence.
        if (!description && readmeBudget > 0) {
            readmeBudget--
            try {
                const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${r.name}/readme`, {
                    headers: { ...GH_HEADERS, Accept: 'application/vnd.github.raw+json' },
                })
                if (res.ok) {
                    const md = await res.text()
                    const firstLine = md
                        .split('\n')
                        .map(l => clean(l.replace(/^#+\s*/, '').replace(/[*_`>[\]]/g, '')))
                        .find(l => l.length > 25 && !/^!\[/.test(l) && !/^https?:\/\//.test(l))
                    if (firstLine) description = firstLine.slice(0, 240)
                }
            } catch {
                /* README is best-effort */
            }
        }

        const topics = Array.isArray(r.topics) ? r.topics : []
        const lang = r.language ? String(r.language) : ''
        const stars = r.stargazers_count || 0
        const updated = r.pushed_at ? r.pushed_at.slice(0, 10) : ''
        const text = [
            `GitHub repository "${r.name}"${lang ? ` (${lang})` : ''}: ${description || 'A project by Teo.'}`,
            topics.length ? ` Topics: ${topics.join(', ')}.` : '',
            stars ? ` ${stars} star${stars === 1 ? '' : 's'}.` : '',
            updated ? ` Last updated ${updated}.` : '',
            ` Repo: ${r.html_url}`,
        ].join('')

        chunks.push({
            id: `gh-${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            topic: `Project — ${r.name}`,
            text,
            keywords: keywords(
                ['project', 'projects', 'repo', 'repository', 'github', 'code'],
                tokenize(r.name.replace(/[-_]/g, ' ')),
                topics.map(t => t.toLowerCase()),
                lang ? [lang.toLowerCase()] : [],
                tokenize(description).slice(0, 6)
            ),
            source: { label: 'GitHub', url: r.html_url },
        })
    }
    return chunks
}

// ──────────────────────────────────── Blog ───────────────────────────────────

async function ingestBlog() {
    const res = await fetch(`${BLOG_BASE}/`, { headers: { 'User-Agent': 'aboutme-ingest' } })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for blog index`)
    const html = await res.text()

    const reAnchor = /<a class="postlist__link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    const seen = new Set()
    const posts = []
    let m
    while ((m = reAnchor.exec(html))) {
        const href = m[1]
        if (seen.has(href)) continue
        seen.add(href)
        const inner = m[2]
        const title = clean((inner.match(/<span class="postlist__title">([\s\S]*?)<\/span>/) || [])[1])
        const desc = clean((inner.match(/<span class="postlist__desc">([\s\S]*?)<\/span>/) || [])[1])
        const pathMatch = href.match(/\/blogs\/([a-z-]+)\/(\d{4})\/(\d{2})\/(\d{2})\/([^"]+?)\.html/)
        if (!title || !pathMatch) continue
        const [, category, y, mo, d, slug] = pathMatch
        posts.push({
            url: href.startsWith('http') ? href : `https://sir-teo.github.io${href}`,
            title,
            desc,
            category,
            date: `${y}-${mo}-${d}`,
            slug,
        })
    }
    posts.sort((a, b) => b.date.localeCompare(a.date))

    const chunks = []

    // Per-category aggregates — answer "what does Teo write about?" compactly.
    const byCategory = new Map()
    for (const p of posts) {
        if (!byCategory.has(p.category)) byCategory.set(p.category, [])
        byCategory.get(p.category).push(p)
    }
    for (const [category, list] of byCategory) {
        const label = titleCase(category)
        const recent = list.slice(0, 4).map(p => `"${p.title}"`).join(', ')
        chunks.push({
            id: `blog-cat-${category}`,
            topic: `Blog — ${label}`,
            text: `Teo's research notebook has ${list.length} note${list.length === 1 ? '' : 's'} on ${label}. Recent ones include ${recent}. Read more at ${BLOG_BASE}/.`,
            keywords: keywords(
                ['blog', 'blogs', 'writing', 'writes', 'notes', 'notebook', 'articles', 'posts'],
                tokenize(label)
            ),
            source: { label: 'Blog', url: `${BLOG_BASE}/` },
        })
    }

    // Individual posts (most recent first) — each its own citable, described chunk.
    const limit = BLOG_POSTS === 'all' ? posts.length : Math.max(0, Number(BLOG_POSTS) || 0)
    for (const p of posts.slice(0, limit)) {
        const label = titleCase(p.category)
        chunks.push({
            id: `blog-${p.slug}`,
            topic: `Blog post — ${p.title}`,
            text: `Blog post (${p.date}, ${label}): "${p.title}".${p.desc ? ` ${p.desc}` : ''}`,
            keywords: keywords(
                ['blog', 'post', 'note', 'writing'],
                tokenize(p.title),
                tokenize(label),
                tokenize(p.desc).slice(0, 6)
            ),
            source: { label: 'Blog', url: p.url },
        })
    }

    return chunks
}

// ─────────────────────────────────── write ───────────────────────────────────

function serialize(chunks) {
    const body = chunks.map(c => '    ' + JSON.stringify(c)).join(',\n')
    return `/* eslint-disable */
// AUTO-GENERATED by scripts/ingest.mjs — do not edit by hand. Run \`npm run ingest\`.
//
// Ingested from Teo's public footprint (GitHub repos + research blog) and committed
// so the static export needs no network at build time. Merged with the hand-curated
// facts via ALL_KNOWLEDGE in ./knowledge, which feeds the semantic retriever.

import type { KnowledgeChunk } from './knowledge'

export const GENERATED_AT = ${JSON.stringify(new Date().toISOString())}

export const GENERATED_KNOWLEDGE: KnowledgeChunk[] = [
${body}
]
`
}

async function main() {
    const results = await Promise.allSettled([ingestGithub(), ingestBlog()])
    const [gh, blog] = results
    const chunks = []
    if (gh.status === 'fulfilled') {
        console.log(`✓ GitHub: ${gh.value.length} repo chunks`)
        chunks.push(...gh.value)
    } else {
        console.warn(`✗ GitHub ingest failed: ${gh.reason?.message ?? gh.reason}`)
    }
    if (blog.status === 'fulfilled') {
        console.log(`✓ Blog: ${blog.value.length} chunks`)
        chunks.push(...blog.value)
    } else {
        console.warn(`✗ Blog ingest failed: ${blog.reason?.message ?? blog.reason}`)
    }

    if (chunks.length === 0) {
        console.error('Nothing ingested — leaving app/data/generated.ts untouched.')
        process.exitCode = 1
        return
    }

    // Guard against duplicate ids (would clobber each other in the vector store).
    const ids = new Set()
    const unique = chunks.filter(c => (ids.has(c.id) ? false : (ids.add(c.id), true)))

    await writeFile(OUT, serialize(unique), 'utf8')
    console.log(`Wrote ${unique.length} chunks → app/data/generated.ts`)
}

main().catch(err => {
    console.error('Ingest crashed:', err)
    process.exitCode = 1
})
