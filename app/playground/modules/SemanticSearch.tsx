'use client'

import { useEffect, useRef, useState } from 'react'
import GpuGate from '../GpuGate'
import { retrieveSemantic, warmIndex, type RetrievedChunk } from '../agent/retrieval'
import { warmEmbedder, onEmbedProgress } from '../agent/embeddings'

// Semantic search over the site's content (the profile knowledge base), powered
// by EmbeddingGemma + the in-browser vector store. Meaning, not keywords:
// "where did he go to school" finds the education chunk with no shared words.

const EXAMPLES = ['machine learning research', 'where did he go to school', 'side projects', 'airline pricing work']

function SearchInner() {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<RetrievedChunk[] | null>(null)
    const [busy, setBusy] = useState(false)
    const [progress, setProgress] = useState('')
    const seq = useRef(0)

    useEffect(() => {
        warmEmbedder()
        warmIndex()
        return onEmbedProgress(setProgress)
    }, [])

    async function run(q: string) {
        const text = q.trim()
        if (!text) return
        setQuery(text)
        setBusy(true)
        const mine = ++seq.current
        try {
            const hits = await retrieveSemantic(text, 6)
            if (mine === seq.current) setResults(hits)
        } finally {
            if (mine === seq.current) {
                setBusy(false)
                setProgress('')
            }
        }
    }

    return (
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <form
                onSubmit={e => {
                    e.preventDefault()
                    run(query)
                }}
                className="flex items-center gap-2"
            >
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search Teo’s site by meaning…"
                    aria-label="Semantic search"
                    className="flex-1 rounded-lg bg-slate-50 px-3 py-2 text-[15px] text-slate-800 outline-none ring-1 ring-slate-200 placeholder:text-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
                />
                <button
                    type="submit"
                    disabled={busy || !query.trim()}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-[14px] text-slate-50 transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                >
                    {busy ? '…' : 'Search'}
                </button>
            </form>

            {results === null && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {EXAMPLES.map(ex => (
                        <button
                            key={ex}
                            type="button"
                            onClick={() => run(ex)}
                            className="rounded-full bg-slate-100 px-3 py-1 text-[13px] text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700"
                        >
                            {ex}
                        </button>
                    ))}
                </div>
            )}

            {progress && <p className="mt-3 text-[13px] text-slate-400">{progress}</p>}

            {results && (
                <ul className="mt-4 space-y-2">
                    {results.map((r, i) => (
                        <li key={i} className="rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-[12px] font-medium uppercase tracking-wide text-slate-400">
                                    {r.topic}
                                </span>
                                <span className="text-[11px] tabular-nums text-slate-400">
                                    {(r.score * 100).toFixed(0)}% match
                                </span>
                            </div>
                            <p className="mt-1 text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">
                                {r.text}
                            </p>
                            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                    className="h-full rounded-full bg-emerald-500/70"
                                    style={{ width: `${Math.max(4, Math.min(100, r.score * 100))}%` }}
                                />
                            </div>
                        </li>
                    ))}
                    {results.length === 0 && (
                        <li className="text-[14px] text-slate-500 dark:text-slate-400">No matches.</li>
                    )}
                </ul>
            )}
        </div>
    )
}

export default function SemanticSearch() {
    return (
        <GpuGate>
            <SearchInner />
        </GpuGate>
    )
}
