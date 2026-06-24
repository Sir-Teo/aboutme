// Build-time ingestion of Teo's PRIVATE Obsidian "knowledgebase" vault into typed
// KnowledgeChunk[] → app/data/vault.ts (committed, so the static export needs no
// access to the vault at build time). Run manually after the vault changes:
//
//   node scripts/ingest-vault.mjs          # or: npm run ingest:vault
//   VAULT_DIR=/path/to/vault node scripts/ingest-vault.mjs
//
// Scope (what the site owner asked to surface): coursework + research + experience.
//   • Coursework → "20 Areas/*coursework*.md"  (NYU + UCSB course notes)
//   • Research + experience → "10 Projects/*.md" (work, internships, papers, labs,
//     Kaggle, apps)
//
// PRIVACY IS THE WHOLE GAME HERE — this is a public website fed from a private vault:
//   • YAML frontmatter is dropped entirely (it holds absolute /Users/ paths and
//     deidentified data filenames).
//   • Only the FIRST section of each note (the Scope/Summary/What-It-Is prose) is
//     kept — never the later evidence tables that name files and other people.
//   • Every sentence that mentions a file, path, or "local evidence" is dropped, and
//     any chunk still tripping the safety net (paths, emails, other people's names)
//     is skipped. Each chunk is cited to a PUBLIC url (LinkedIn/Scholar/GitHub/
//     Kaggle), never the vault. See app/data/knowledge.ts header for the policy.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, basename } from 'node:path'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../app/data/vault.ts')
const VAULT_DIR = process.env.VAULT_DIR ?? join(homedir(), 'Developer/knowledgebase')

// Coursework notes whose name matches /coursework/ but that we still exclude:
// the academic-record note surfaces GPA-discrepancy bookkeeping, and planning /
// application archives are personal application material.
const COURSEWORK_DENY = [/academic record/i, /major planning/i, /transfer application/i]

const PUBLIC_SOURCES = {
    linkedin: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    scholar: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
    github: { label: 'GitHub', url: 'https://github.com/Sir-Teo' },
    kaggle: { label: 'Kaggle', url: 'https://www.kaggle.com/sirteo' },
}

// ───────────────────────────────── privacy net ───────────────────────────────

// A sentence is "meta" (about the vault's own files/provenance, not about Teo's
// knowledge) if it mentions a path, file, or evidence-bookkeeping vocabulary.
const FILE_EXT = /\.(pdf|ipynb|csv|tsv|xlsx|xls|docx|doc|pptx|pages|bib|tex|json|jsonl|nbn|plist|zip|vtt|html|md|dsstore|py|png|jpg|nii|dicom)\b/i
const META_SENTENCE = new RegExp(
    [
        '\\/Users\\/',
        '[A-Za-z0-9_.-]*\\s?' + FILE_EXT.source, // file refs incl. the "31 .docx" form
        'local evidence',
        'source files?',
        'source note',
        '\\bfolder\\b',
        'notability|metadata|icloud|downloads\\/|documents\\/|byte-identical|deidentified',
        'this note',
        '\\bartifacts?\\b|local files',
        // file/media bookkeeping: resolutions, durations, sizes, local folder roots
        // (scoped to real vault roots so tech phrases like "AI/ML" survive)
        '\\d+x\\d+|\\b\\d+(\\.\\d+)?\\s*(minutes|hours|gb|mb)\\b|\\b(Developer|Documents|Downloads|Desktop|Library|iCloud)\\/',
        // course-admin / other-people provenance, never about Teo's own knowledge
        'instructor|teaching assistant|\\bta\\b|\\btas\\b|syllabus|professor|lecturer|gauchospace|\\benrolled\\b',
        'evidence (type|links|to|status|spans|includes|covers|comprises|consists|center)|\\bevidence,|, and [^.]*\\bevidence\\b',
    ].join('|'),
    'i'
)

// Vault-jargon words trimmed off a note title before it's used as the chunk's
// semantic anchor, so a public answer never parrots "… analysis workspace".
const TITLE_JARGON = /\b(analysis )?(workspace|corpus|archive|local|detailed note)\b/gi

// PI / advisor / collaborator surnames that appear as note-title prefixes (e.g.
// "Yoon conversational memory", "… with Ludkovski"). Their work is Teo's; their
// names are other people's — strip them from anchors and drop any sentence using
// them. Extend this list if `npm run ingest:vault` surfaces a new collaborator.
// (Instructor/TA names are already handled by META_SENTENCE; this list is for PI
// surnames that prefix research-note titles. "Pierce" is deliberately absent — it
// only occurs as the Kaggle competition "Pierce the VEIL", not a person here.)
const COLLAB_SOURCE = 'Yoon|Ludkovski|Mengyang|Kilaberia|Cournane|Ailis'
const COLLAB_TEST = () => new RegExp(`\\b(${COLLAB_SOURCE})\\b`)
const COLLAB_STRIP = new RegExp(`\\bwith\\s+(${COLLAB_SOURCE})\\b|\\b(${COLLAB_SOURCE})\\b`, 'g')

// If a finished chunk still contains any of these, drop the chunk entirely:
// absolute paths, emails, long id-like digit runs, or any leftover file reference.
const UNSAFE_CHUNK = /\/Users\/|@[a-z0-9.-]+\.[a-z]{2,}|\b\d{6,}\b|\s\.[a-z]{2,6}\b|[A-Za-z0-9_-]+\.(pdf|ipynb|csv|xlsx|docx|pptx|pages|bib|tex|nii|dsstore)\b/i

// ───────────────────────────────── helpers ───────────────────────────────────

const STOP = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'this', 'that', 'it', 'its',
    'as', 'at', 'by', 'be', 'from', 'using', 'use', 'via', 'app', 'my', 'your', 'you', 'we', 'i', 'teo', 'teos',
    'his', 'he', 'into', 'over', 'note', 'work', 'works',
])

function tokenize(s) {
    return String(s ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9+#.\s-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP.has(t))
}

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

function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Strip YAML frontmatter, return { title, body }.
function splitNote(md) {
    const noFront = md.replace(/^﻿?---\n[\s\S]*?\n---\n?/, '')
    const titleMatch = noFront.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1].trim() : ''
    const body = noFront.replace(/^#\s+.+$/m, '')
    return { title, body }
}

// Keep intro prose + the first "## " section; stop at the second "## " heading
// (later sections are the file-level evidence tables we never want public).
function firstSection(body) {
    const lines = body.split('\n')
    const out = []
    let headings = 0
    for (const line of lines) {
        if (/^##\s+/.test(line)) {
            if (++headings >= 2) break
            continue // drop the "## Heading" label itself
        }
        if (/^\s*\|/.test(line)) continue // drop table rows
        out.push(line)
    }
    return out.join('\n')
}

// Markdown → plain prose: unwrap wikilinks/links, strip emphasis/code/quotes.
function plain(s) {
    return s
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[`*_>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

// Build the public-facing description: first few non-meta sentences, capped.
function describe(body) {
    const prose = plain(firstSection(body))
    const sentences = prose.split(/(?<=[.!?])\s+/)
    const kept = []
    let len = 0
    for (const s of sentences) {
        if (!s) continue
        if (META_SENTENCE.test(s)) continue
        if (COLLAB_TEST().test(s)) continue // mentions a PI/collaborator by name
        // "evidence"-framed list sentences (e.g. "Resume, offer-letter, … evidence
        // describe …") are provenance bookkeeping, not facts about Teo.
        if (/\bevidence\b/i.test(s) && s.includes(',')) continue
        kept.push(s.trim())
        len += s.length
        if (kept.length >= 4 || len >= 620) break
    }
    return kept.join(' ').trim()
}

function sourceFor(kind, title, text) {
    const t = `${title} ${text}`.toLowerCase()
    if (/kaggle/.test(t)) return PUBLIC_SOURCES.kaggle
    if (
        /publication|paper|crystallograph|pancreatitis|\bhcc\b|brain tumor|segmentation|conversational|dinov2|recurrence|radiolog|\bmri\b|medical|aifsr|antiferromagnetic|social media|aging|elder|steering|survival|forecasting|gaussian process|dynamical/.test(
            t
        )
    )
        return PUBLIC_SOURCES.scholar
    if (kind === 'coursework' || /atpco|3victors|bier|internship|langone|teaching|pstat 197|resume|career/.test(t))
        return PUBLIC_SOURCES.linkedin
    return PUBLIC_SOURCES.github
}

async function mdFiles(dir) {
    let entries
    try {
        entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
        console.warn(`✗ cannot read ${dir}: ${err.message}`)
        return []
    }
    return entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => join(dir, e.name))
}

async function ingestFolder(dir, kind, { keep } = {}) {
    const files = await mdFiles(dir)
    const chunks = []
    for (const file of files) {
        const name = basename(file, '.md')
        if (keep && !keep(name)) continue
        const md = await readFile(file, 'utf8')
        const { title, body } = splitNote(md)
        const topicTitle = title || name
        const text = describe(body)
        if (text.length < 80) continue // too thin to be useful
        // Anchor the chunk with a de-jargoned title (best practice), unless the
        // text already opens with it.
        const anchor = topicTitle
            .replace(TITLE_JARGON, '')
            .replace(COLLAB_STRIP, '')
            .replace(/^\s*with\s+/i, '')
            .replace(/\s{2,}/g, ' ')
            .replace(/^[\s—–-]+/, '')
            .trim()
        const full = text.toLowerCase().startsWith(anchor.toLowerCase().slice(0, 12)) ? text : `${anchor}: ${text}`
        if (UNSAFE_CHUNK.test(full)) {
            console.warn(`  ⚠ skipped (privacy net): ${name}`)
            continue
        }
        const seed =
            kind === 'coursework'
                ? ['coursework', 'course', 'class', 'studied', 'education']
                : ['project', 'research', 'experience', 'work']
        // Derive topic + keywords from the scrubbed anchor (not the raw title) so a
        // stripped PI name never lingers in metadata either.
        const cleanTopic = anchor || topicTitle.replace(COLLAB_STRIP, '').trim()
        chunks.push({
            id: `vault-${slugify(name)}`,
            topic: kind === 'coursework' ? `Coursework — ${cleanTopic}` : cleanTopic,
            text: full,
            keywords: keywords(seed, tokenize(cleanTopic), tokenize(text).slice(0, 10)),
            source: sourceFor(kind, cleanTopic, text),
        })
    }
    return chunks
}

// ─────────────────────────────────── write ───────────────────────────────────

function serialize(chunks) {
    const body = chunks.map(c => '    ' + JSON.stringify(c)).join(',\n')
    return `/* eslint-disable */
// AUTO-GENERATED by scripts/ingest-vault.mjs — do not edit by hand. Run \`npm run ingest:vault\`.
//
// Privacy-screened pass over Teo's private Obsidian vault (~/Developer/knowledgebase):
// coursework (20 Areas) + research/experience/projects (10 Projects). Only the first
// summary section of each note is kept; frontmatter, file paths, evidence tables and
// other people's names are stripped. Each chunk cites a PUBLIC url, never the vault.
// Merged into ALL_KNOWLEDGE in ./knowledge, which feeds the semantic retriever only.

import type { KnowledgeChunk } from './knowledge'

export const VAULT_GENERATED_AT = ${JSON.stringify(new Date().toISOString())}

export const VAULT_KNOWLEDGE: KnowledgeChunk[] = [
${body}
]
`
}

async function main() {
    const coursework = await ingestFolder(join(VAULT_DIR, '20 Areas'), 'coursework', {
        keep: name => /coursework/i.test(name) && !COURSEWORK_DENY.some(re => re.test(name)),
    })
    const projects = await ingestFolder(join(VAULT_DIR, '10 Projects'), 'project')

    console.log(`✓ Coursework: ${coursework.length} chunks`)
    console.log(`✓ Research/experience/projects: ${projects.length} chunks`)

    const all = [...coursework, ...projects]
    if (all.length === 0) {
        console.error(`Nothing ingested from ${VAULT_DIR} — leaving app/data/vault.ts untouched.`)
        process.exitCode = 1
        return
    }

    const ids = new Set()
    const unique = all.filter(c => (ids.has(c.id) ? false : (ids.add(c.id), true)))

    await writeFile(OUT, serialize(unique), 'utf8')
    console.log(`Wrote ${unique.length} chunks → app/data/vault.ts`)
}

main().catch(err => {
    console.error('Vault ingest crashed:', err)
    process.exitCode = 1
})
