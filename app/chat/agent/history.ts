// Conversation history — the chat's local persistence. Each thread (a full
// transcript) is stored in the IndexedDB 'threads' store so past conversations
// survive a reload. Like memory, everything stays on the user's device; nothing
// is ever uploaded.

import { idbSet, idbDelete, idbValues, idbClear } from '../../lib/idb'
import type { Source } from '../../data/knowledge'

// Per-turn generation telemetry, shown as a faint badge under an answer.
export type GenStats = { tps: number; ttftMs: number; tokens: number }

// A persisted message mirrors the in-memory Msg shape (multi-part: text + an
// optional image data URL + citation sources + generation stats).
export type StoredMsg = {
    role: 'user' | 'assistant'
    content: string
    sources?: Source[]
    image?: string
    stats?: GenStats
}

export type Thread = { id: string; title: string; updatedAt: number; messages: StoredMsg[] }

// Subscribers (the history drawer) refresh whenever a thread is saved or removed.
const listeners = new Set<() => void>()
function emit() {
    listeners.forEach(fn => fn())
}
export function subscribeThreads(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

// A readable title from the first real user message (images aside).
export function titleFor(messages: StoredMsg[]): string {
    const first = messages.find(m => m.role === 'user' && m.content && m.content !== '(image)')
    const text = (first?.content ?? 'New chat').trim()
    return text.length > 60 ? `${text.slice(0, 57)}…` : text || 'New chat'
}

// Upsert a thread. Empty conversations are never written. Storage failures
// (e.g. quota) are swallowed — persistence is a convenience, never a blocker.
export async function saveThread(thread: Thread): Promise<void> {
    if (!thread.messages.length) return
    try {
        await idbSet('threads', thread.id, thread)
        emit()
    } catch {
        /* best-effort */
    }
}

export async function listThreads(): Promise<Thread[]> {
    const all = await idbValues<Thread>('threads').catch(() => [] as Thread[])
    return all.filter(t => t && t.messages?.length).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteThread(id: string): Promise<void> {
    await idbDelete('threads', id)
    emit()
}

export async function clearThreads(): Promise<void> {
    await idbClear('threads')
    emit()
}
