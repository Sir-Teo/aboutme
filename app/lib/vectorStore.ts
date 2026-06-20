// An in-memory cosine-similarity vector store with optional IndexedDB persistence.
//
// The playground's retrieval needs are small — a ~30-chunk profile knowledge
// base and a user's growing pile of long-term memories — well under the few
// thousand vectors where a brute-force cosine scan stays sub-millisecond. So we
// skip a WASM HNSW dependency (Voy) until a tab actually needs it; the API here
// is deliberately swap-compatible if that day comes.
//
// Vectors are expected L2-normalized (EmbeddingGemma output is normalized, and
// truncated MRL vectors are re-normalized), so cosine similarity is a dot product.

import { idbGet, idbSet, type StoreName } from './idb'

export type VectorRecord<M = unknown> = {
    id: string
    vector: number[]
    metadata: M
}

export type SearchHit<M = unknown> = {
    id: string
    score: number
    metadata: M
}

export class VectorStore<M = unknown> {
    private records: VectorRecord<M>[] = []

    constructor(
        // Where to persist, if at all. Omit for an ephemeral in-memory index.
        private readonly persist?: { store: StoreName; key: string }
    ) {}

    get size(): number {
        return this.records.length
    }

    add(record: VectorRecord<M>) {
        const existing = this.records.findIndex(r => r.id === record.id)
        if (existing >= 0) this.records[existing] = record
        else this.records.push(record)
    }

    addMany(records: VectorRecord<M>[]) {
        for (const record of records) this.add(record)
    }

    remove(id: string) {
        this.records = this.records.filter(r => r.id !== id)
    }

    clear() {
        this.records = []
    }

    all(): VectorRecord<M>[] {
        return this.records.slice()
    }

    search(query: number[], k = 5, minScore = 0): SearchHit<M>[] {
        const hits: SearchHit<M>[] = []
        for (const record of this.records) {
            const score = dot(query, record.vector)
            if (score >= minScore) hits.push({ id: record.id, score, metadata: record.metadata })
        }
        hits.sort((a, b) => b.score - a.score)
        return hits.slice(0, k)
    }

    async load(): Promise<boolean> {
        if (!this.persist) return false
        const saved = await idbGet<VectorRecord<M>[]>(this.persist.store, this.persist.key)
        if (Array.isArray(saved)) {
            this.records = saved
            return true
        }
        return false
    }

    async save(): Promise<void> {
        if (!this.persist) return
        await idbSet(this.persist.store, this.persist.key, this.records)
    }
}

// Dot product of two equal-length normalized vectors = cosine similarity.
function dot(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length)
    let sum = 0
    for (let i = 0; i < n; i++) sum += a[i] * b[i]
    return sum
}

// Truncate an embedding to `dims` (Matryoshka) and re-normalize so cosine stays valid.
export function truncateAndNormalize(vector: number[], dims: number): number[] {
    const sliced = vector.slice(0, dims)
    let norm = 0
    for (const v of sliced) norm += v * v
    norm = Math.sqrt(norm) || 1
    return sliced.map(v => v / norm)
}
