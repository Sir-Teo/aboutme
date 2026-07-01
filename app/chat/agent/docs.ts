// On-device document ingestion for "chat with a doc", shared by the unified chat.
// A dropped PDF / text file is parsed (pdfjs), chunked, embedded (EmbeddingGemma)
// into an ephemeral in-memory vector store, then searched + reranked per question
// — all in the browser, nothing uploaded. Mirrors the standalone Docs lab so both
// can share one implementation.

import { VectorStore } from '../../lib/vectorStore'
import { embed, embedOne, rerank } from './embeddings'

export type DocChunkMeta = { text: string }
export type IngestedDoc = { name: string; store: VectorStore<DocChunkMeta>; chunks: number }

// Pull plain text out of a PDF (pdfjs) or a text/markdown file.
export async function extractText(file: File): Promise<string> {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pdfjs: any = await import('pdfjs-dist')
        // Bundled worker (same version as the installed package) — keeps parsing
        // working offline/behind CSP instead of reaching out to a CDN.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const data = new Uint8Array(await file.arrayBuffer())
        const pdf = await pdfjs.getDocument({ data }).promise
        let text = ''
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p)
            const content = await page.getTextContent()
            text += content.items.map((it: any) => it.str).join(' ') + '\n'
        }
        return text
    }
    return file.text()
}

// Split text into ~overlapping chunks on sentence-ish boundaries.
export function chunkText(text: string, size = 900, overlap = 150): string[] {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean.length <= size) return clean ? [clean] : []
    const chunks: string[] = []
    let i = 0
    while (i < clean.length) {
        let end = Math.min(i + size, clean.length)
        if (end < clean.length) {
            const dot = clean.lastIndexOf('. ', end)
            if (dot > i + size * 0.5) end = dot + 1
        }
        chunks.push(clean.slice(i, end).trim())
        if (end >= clean.length) break
        i = Math.max(end - overlap, i + 1)
    }
    return chunks.filter(Boolean)
}

// Embed in bounded sub-batches: a big PDF can produce hundreds of chunks, and a
// single giant WebGPU forward pass would spike memory on weaker GPUs.
const EMBED_BATCH = 32

// Parse → chunk → embed a file into an in-memory store. Throws if no readable text.
export async function ingestDoc(file: File): Promise<IngestedDoc> {
    const raw = await extractText(file)
    const chunks = chunkText(raw)
    if (!chunks.length) throw new Error('No readable text found in that document.')
    const vectors: number[][] = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        vectors.push(...(await embed(chunks.slice(i, i + EMBED_BATCH), 'document')))
    }
    const store = new VectorStore<DocChunkMeta>()
    store.addMany(chunks.map((text, i) => ({ id: `c${i}`, vector: vectors[i] ?? [], metadata: { text } })))
    return { name: file.name, store, chunks: chunks.length }
}

// Top-k document excerpts for a query (bi-encoder recall → cross-encoder rerank).
export async function searchDoc(store: VectorStore<DocChunkMeta>, query: string, k = 4): Promise<string[]> {
    const qVec = await embedOne(query, 'query')
    const pool = store.search(qVec, 12).map(h => h.metadata.text)
    if (pool.length <= k) return pool
    try {
        const scores = await rerank(query, pool)
        return pool
            .map((text, i) => ({ text, score: scores[i] ?? 0 }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .map(x => x.text)
    } catch {
        return pool.slice(0, k)
    }
}
