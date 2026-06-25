'use client'

import type { Thread } from './agent/history'

// A quiet left slide-over listing past conversations. Presentational only — the
// chat owns the data and decides what loading a thread does. Mirrors the calm,
// minimal styling of the rest of the chat surface.

export default function ChatHistory({
    open,
    threads,
    activeId,
    onSelect,
    onDelete,
    onClear,
    onClose,
}: {
    open: boolean
    threads: Thread[]
    activeId: string
    onSelect: (thread: Thread) => void
    onDelete: (id: string) => void
    onClear: () => void
    onClose: () => void
}) {
    if (!open) return null
    return (
        <div className="absolute inset-0 z-30">
            <button
                type="button"
                aria-label="Close history"
                onClick={onClose}
                className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
            />
            <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-[var(--c-border)] bg-[var(--c-sidebar)] shadow-xl">
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--c-border)] px-3.5">
                    <span className="text-[13px] font-semibold text-[var(--c-text)]">History</span>
                    {threads.length > 0 && (
                        <button
                            type="button"
                            onClick={onClear}
                            className="text-[12px] text-[var(--c-faint)] transition hover:text-rose-500"
                        >
                            Clear all
                        </button>
                    )}
                </div>
                <div className="chat-scroll min-h-0 flex-1 overflow-y-auto p-2">
                    {threads.length === 0 ? (
                        <p className="px-2 py-6 text-center text-[12.5px] text-[var(--c-faint)]">
                            Past conversations show up here — stored only on this device.
                        </p>
                    ) : (
                        <ul className="space-y-0.5">
                            {threads.map(t => (
                                <li key={t.id}>
                                    <div
                                        className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 transition ${
                                            t.id === activeId ? 'bg-[var(--c-accent-soft)]' : 'hover:bg-[var(--c-soft)]'
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => onSelect(t)}
                                            className="min-w-0 flex-1 text-left"
                                        >
                                            <span className="block truncate text-[13px] text-[var(--c-text)]">
                                                {t.title}
                                            </span>
                                            <span className="block text-[11px] text-[var(--c-faint)]">
                                                {new Date(t.updatedAt).toLocaleDateString(undefined, {
                                                    month: 'short',
                                                    day: 'numeric',
                                                })}
                                                {' · '}
                                                {t.messages.length} messages
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onDelete(t.id)}
                                            aria-label="Delete conversation"
                                            title="Delete"
                                            className="shrink-0 px-1 text-[12px] text-[var(--c-faint)] opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </aside>
        </div>
    )
}
