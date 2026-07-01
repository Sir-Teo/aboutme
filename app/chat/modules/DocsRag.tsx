'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import GpuGate from '../GpuGate'
import { engineById } from '../engines'
import { VectorStore } from '../../lib/vectorStore'
import { embed, embedOne, rerank, warmEmbedder } from '../agent/embeddings'
import { generate, warm, disposeModel } from '../agent/runtime'
import { chunkText, extractText } from '../agent/docs'

// "Chat with a document" — drop a PDF / text file (or paste), and ask questions
// answered only from its contents. Parsing, chunking, embedding (EmbeddingGemma),
// reranking and generation all run on-device. Nothing is uploaded.

const ANSWER_ENGINE = engineById('lfm2.5-1.2b')
type DocMeta = { text: string; source: string }
type QA = { q: string; a: string; sources: string[] }

function DocsRagInner() {
    const [status, setStatus] = useState('')
    const [docName, setDocName] = useState('')
    const [chunkCount, setChunkCount] = useState(0)
    const [question, setQuestion] = useState('')
    const [history, setHistory] = useState<QA[]>([])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const storeRef = useRef<VectorStore<DocMeta> | null>(null)

    useEffect(() => {
        warmEmbedder()
        warm(ANSWER_ENGINE)
        return () => disposeModel()
    }, [])

    const ingest = useCallback(async (file: File | undefined, pasted?: string) => {
        setError('')
        try {
            setBusy(true)
            setStatus('Reading…')
            const raw = pasted ?? (file ? await extractText(file) : '')
            const name = pasted ? 'Pasted text' : file?.name ?? 'Document'
            const chunks = chunkText(raw)
            if (!chunks.length) {
                setError('No readable text found in that document.')
                return
            }
            setStatus(`Embedding ${chunks.length} chunks…`)
            const vectors: number[][] = []
            for (let i = 0; i < chunks.length; i += 32) {
                vectors.push(...(await embed(chunks.slice(i, i + 32), 'document')))
            }
            const store = new VectorStore<DocMeta>()
            store.addMany(
                chunks.map((text, i) => ({ id: `c${i}`, vector: vectors[i] ?? [], metadata: { text, source: name } }))
            )
            storeRef.current = store
            setDocName(name)
            setChunkCount(chunks.length)
            setHistory([])
            setStatus('')
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not read that document.')
        } finally {
            setBusy(false)
        }
    }, [])

    const ask = useCallback(async () => {
        const q = question.trim()
        const store = storeRef.current
        if (!q || !store || busy) return
        setQuestion('')
        setBusy(true)
        setError('')
        const entry: QA = { q, a: '', sources: [] }
        setHistory(prev => [...prev, entry])
        try {
            setStatus('Searching document…')
            const qVec = await embedOne(q, 'query')
            const pool = store.search(qVec, 12).map(h => h.metadata.text)
            let top = pool.slice(0, 4)
            try {
                const scores = await rerank(q, pool)
                top = pool
                    .map((text, i) => ({ text, score: scores[i] ?? 0 }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 4)
                    .map(x => x.text)
            } catch {
                /* reranker optional */
            }
            const system = [
                `Answer the question using ONLY the document excerpts below.`,
                `If the answer isn't in them, say you couldn't find it in the document.`,
                ``,
                `Excerpts:`,
                ...top.map((t, i) => `[${i + 1}] ${t}`),
            ].join('\n')
            setStatus('Answering…')
            let full = ''
            await generate(
                ANSWER_ENGINE,
                [
                    { role: 'system', content: system },
                    { role: 'user', content: q },
                ],
                {
                    onProgress: setStatus,
                    onReady: () => setStatus(''),
                    onChunk: chunk => {
                        full += chunk
                        setHistory(prev => {
                            const next = prev.slice()
                            next[next.length - 1] = { ...next[next.length - 1], a: full }
                            return next
                        })
                    },
                }
            )
            setHistory(prev => {
                const next = prev.slice()
                next[next.length - 1] = { ...next[next.length - 1], sources: top }
                return next
            })
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not answer.')
        } finally {
            setBusy(false)
            setStatus('')
        }
    }, [question, busy])

    const loaded = chunkCount > 0

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <p className="text-[12px] text-slate-400">
                EmbeddingGemma · BGE reranker · {ANSWER_ENGINE.label} — your document never leaves the device
            </p>

            {!loaded ? (
                <div className="mt-4 flex flex-col items-center gap-3">
                    <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 py-10 text-center dark:border-slate-700">
                        <span className="text-[14px] text-slate-500 dark:text-slate-400">
                            Drop a PDF or text file, or click to choose
                        </span>
                        <span className="mt-1 text-[12px] text-slate-400">PDF · TXT · Markdown</span>
                        <input
                            type="file"
                            accept=".pdf,.txt,.md,text/plain,application/pdf"
                            className="hidden"
                            onChange={e => ingest(e.target.files?.[0])}
                        />
                    </label>
                    {status && <span className="text-[12px] text-slate-400">{status}</span>}
                </div>
            ) : (
                <>
                    <div className="mt-3 flex items-center justify-between">
                        <p className="text-[13px] text-slate-600 dark:text-slate-300">
                            {docName} · {chunkCount} chunks indexed
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                storeRef.current = null
                                setChunkCount(0)
                                setHistory([])
                            }}
                            className="text-[12px] text-slate-400 transition hover:text-slate-600"
                        >
                            New document
                        </button>
                    </div>

                    <div className="mt-3 space-y-3">
                        {history.map((qa, i) => (
                            <div key={i} className="space-y-1.5">
                                <p className="text-right">
                                    <span className="inline-block rounded-2xl bg-slate-900 px-3.5 py-2 text-left text-[14px] text-slate-50 dark:bg-slate-100 dark:text-slate-900">
                                        {qa.q}
                                    </span>
                                </p>
                                <p>
                                    <span className="inline-block rounded-2xl bg-slate-100 px-3.5 py-2 text-[14px] leading-relaxed text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                                        {qa.a || '…'}
                                    </span>
                                </p>
                            </div>
                        ))}
                    </div>

                    <form
                        onSubmit={e => {
                            e.preventDefault()
                            void ask()
                        }}
                        className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
                    >
                        <input
                            value={question}
                            onChange={e => setQuestion(e.target.value)}
                            placeholder={busy ? status || 'Working…' : 'Ask about the document…'}
                            disabled={busy}
                            className="flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-slate-100"
                        />
                        <button
                            type="submit"
                            disabled={busy || !question.trim()}
                            className="rounded-full bg-slate-900 px-3.5 py-1.5 text-[13px] text-white transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                        >
                            Ask
                        </button>
                    </form>
                </>
            )}
            {error && <p className="mt-2 text-[13px] text-rose-500">{error}</p>}
        </div>
    )
}

export default function DocsRag() {
    return (
        <GpuGate>
            <DocsRagInner />
        </GpuGate>
    )
}
