'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Engine, EngineRuntime } from './engines'
import { warm, onProgress, onLoadedChange, loadedEngineId_ } from './agent/runtime'
import { downloadStates, deleteDownload, markDownloaded, type DownloadState } from './agent/models'

// The model manager: a single minimal control to pick a model, download it
// deliberately, and see at a glance which models are on the device and which one
// is loaded right now. Trigger button stays out of the way; the panel opens on
// demand (same pattern as the chat's Memory panel).

const RUNTIME_LABEL: Record<EngineRuntime, string> = {
    transformers: 'transformers.js',
    webllm: 'WebLLM',
    chrome: 'Chrome built-in',
}
const RUNTIME_ORDER: EngineRuntime[] = ['transformers', 'webllm', 'chrome']

export default function ModelManager({
    engines,
    activeId,
    onPick,
}: {
    engines: Engine[]
    activeId: string
    onPick: (id: string) => void
}) {
    const [open, setOpen] = useState(false)
    const [states, setStates] = useState<Record<string, DownloadState>>({})
    const [loadedId, setLoadedId] = useState<string | null>(loadedEngineId_())
    const [progress, setProgress] = useState('')
    const [busyId, setBusyId] = useState<string | null>(null)
    const rootRef = useRef<HTMLDivElement | null>(null)

    const active = engines.find(e => e.id === activeId) ?? engines[0]

    const refresh = useCallback(() => {
        downloadStates(engines).then(setStates)
    }, [engines])

    useEffect(() => {
        refresh()
        const offLoaded = onLoadedChange(id => {
            setLoadedId(id)
            if (id) {
                markDownloaded(id) // a model that loaded is, by definition, downloaded
                setBusyId(b => (b === id ? null : b))
                refresh()
            }
        })
        const offProg = onProgress(setProgress)
        return () => {
            offLoaded()
            offProg()
        }
    }, [refresh])

    // Close the panel on outside click.
    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
    }, [open])

    const downloadOrUse = useCallback(
        (e: Engine) => {
            onPick(e.id)
            if (loadedId !== e.id) {
                setBusyId(e.id)
                setProgress('')
                warm(e) // streams + caches if absent; just loads if already cached
            }
        },
        [onPick, loadedId]
    )

    const remove = useCallback(
        async (e: Engine) => {
            await deleteDownload(e)
            refresh()
        },
        [refresh]
    )

    const dotColor =
        loadedId === activeId
            ? 'bg-emerald-500'
            : busyId
            ? 'animate-pulse bg-amber-400'
            : 'bg-slate-300 dark:bg-slate-600'

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
                <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                <span className="max-w-[10rem] truncate">{active?.label}</span>
                <svg
                    viewBox="0 0 24 24"
                    className="h-3 w-3 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && (
                <div className="absolute right-0 z-20 mt-1 max-h-[60vh] w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <p className="px-2 py-1 text-[11px] text-slate-400">
                        Models download on first use and cache on your device.
                    </p>
                    {RUNTIME_ORDER.filter(rt => engines.some(e => e.runtime === rt)).map(rt => (
                        <div key={rt} className="mt-1">
                            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
                                {RUNTIME_LABEL[rt]}
                            </p>
                            {engines
                                .filter(e => e.runtime === rt)
                                .map(e => {
                                    const loaded = loadedId === e.id
                                    const downloaded = states[e.id] === 'downloaded'
                                    const loading = busyId === e.id && !loaded
                                    return (
                                        <div
                                            key={e.id}
                                            className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${
                                                activeId === e.id ? 'bg-slate-50 dark:bg-slate-800/60' : ''
                                            }`}
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-[13px] text-slate-700 dark:text-slate-200">
                                                    {e.label}
                                                </p>
                                                <p className="text-[11px] text-slate-400">
                                                    {e.vendor} · {e.sizeLabel}
                                                </p>
                                                {loading && progress && (
                                                    <p className="mt-0.5 truncate text-[11px] text-amber-500">
                                                        {progress}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1.5">
                                                {loaded ? (
                                                    <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                        Loaded
                                                    </span>
                                                ) : loading ? (
                                                    <span className="text-[11px] text-amber-500">Loading…</span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => downloadOrUse(e)}
                                                        className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] text-white transition hover:opacity-90 dark:bg-slate-100 dark:text-slate-900"
                                                    >
                                                        {downloaded ? 'Use' : 'Download'}
                                                    </button>
                                                )}
                                                {downloaded && !loaded && e.runtime !== 'chrome' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => remove(e)}
                                                        title="Delete from device"
                                                        className="text-[11px] text-slate-400 transition hover:text-rose-500"
                                                    >
                                                        Delete
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
