// Long-term, on-device memory. Durable facts about the visitor (their name,
// role, preferences) are embedded with EmbeddingGemma and stored in IndexedDB,
// so the assistant remembers returning visitors across sessions — entirely
// locally, nothing ever leaves the device. The user can inspect and clear it all
// from the memory panel.

import { VectorStore, type VectorRecord } from '../../lib/vectorStore'
import { embedOne } from './embeddings'

export type MemoryMeta = { text: string; createdAt: number }
export type Memory = { id: string; text: string; createdAt: number }

// Near-duplicate guard: a new fact this similar to an existing one replaces it
// rather than piling up ("his name is Sam" shouldn't be stored five times).
const DEDUPE_SIMILARITY = 0.92
// Recall floor: below this cosine a memory isn't relevant enough to surface.
const RECALL_MIN_SCORE = 0.35

const store = new VectorStore<MemoryMeta>({ store: 'memories', key: 'long-term' })
let loaded: Promise<void> | null = null
const listeners = new Set<() => void>()

function ensureLoaded(): Promise<void> {
    return (loaded ??= store.load().then(() => undefined))
}

function notify() {
    listeners.forEach(fn => fn())
}

export function subscribeMemory(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

// Save a durable fact. Returns the stored memory (or the one it merged into).
export async function rememberFact(fact: string): Promise<Memory | null> {
    const text = fact.trim()
    if (!text) return null
    await ensureLoaded()
    const vector = await embedOne(text, 'document')

    // Merge into a near-duplicate if one exists.
    const [top] = store.search(vector, 1)
    if (top && top.score >= DEDUPE_SIMILARITY) {
        const createdAt = Date.now()
        store.add({ id: top.id, vector, metadata: { text, createdAt } })
        await store.save()
        notify()
        return { id: top.id, text, createdAt }
    }

    const id = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const createdAt = Date.now()
    store.add({ id, vector, metadata: { text, createdAt } })
    await store.save()
    notify()
    return { id, text, createdAt }
}

// Recall the most relevant memories for a query (returns the fact strings).
export async function recallMemory(query: string, k = 3): Promise<string[]> {
    const q = query.trim()
    if (!q) return []
    await ensureLoaded()
    if (store.size === 0) return []
    const vector = await embedOne(q, 'query')
    return store.search(vector, k, RECALL_MIN_SCORE).map(hit => hit.metadata.text)
}

export async function listMemories(): Promise<Memory[]> {
    await ensureLoaded()
    return store
        .all()
        .map((r: VectorRecord<MemoryMeta>) => ({ id: r.id, text: r.metadata.text, createdAt: r.metadata.createdAt }))
        .sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteMemory(id: string): Promise<void> {
    await ensureLoaded()
    store.remove(id)
    await store.save()
    notify()
}

export async function clearMemories(): Promise<void> {
    await ensureLoaded()
    store.clear()
    await store.save()
    notify()
}

// Cheap auto-capture: pull obvious self-disclosures out of a user message so the
// agent remembers them without spending a model call. Tool-based `remember`
// covers everything else.
const SELF_PATTERNS: { re: RegExp; format: (m: RegExpMatchArray) => string }[] = [
    { re: /\bmy name is ([A-Z][\w'-]+(?:\s[A-Z][\w'-]+)?)/i, format: m => `The visitor's name is ${m[1]}.` },
    { re: /\b[Ii]'?m ([A-Z][\w'-]+)(?:\s|[.,!?]|$)/, format: m => `The visitor's name is ${m[1]}.` },
    {
        re: /\bi(?:'m| am) (?:an? )?([\w ]{3,40}?) at ([\w .&'-]{2,40})/i,
        format: m => `The visitor is a ${m[1].trim()} at ${m[2].trim()}.`,
    },
    {
        re: /\bi (?:work|study) (?:at|in) ([\w .&'-]{2,40})/i,
        format: m => `The visitor works/studies at ${m[1].trim()}.`,
    },
]

export async function autoCapture(userMessage: string): Promise<Memory[]> {
    const saved: Memory[] = []
    for (const { re, format } of SELF_PATTERNS) {
        const match = userMessage.match(re)
        if (match) {
            const mem = await rememberFact(format(match))
            if (mem) saved.push(mem)
        }
    }
    return saved
}
