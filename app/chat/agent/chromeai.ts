// Chrome built-in AI adapter — drives the browser's own on-device model (Gemini
// Nano) through the Prompt API. Zero download, nothing leaves the device. The
// global is `LanguageModel` (origin-trial / flag-gated), so everything here is
// capability-detected and the UI only offers this engine when it's actually live.

import type { ChatMessage, GenerateHandlers } from './llmTypes'

type ChromeRole = 'system' | 'user' | 'assistant'
type ChromePrompt = { role: ChromeRole; content: string }

// The Prompt API surface we use (typed loosely — it isn't in lib.dom yet).
type LanguageModelStatic = {
    availability: () => Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>
    create: (opts?: {
        initialPrompts?: ChromePrompt[]
        monitor?: (m: EventTarget) => void
        signal?: AbortSignal
    }) => Promise<LanguageModelSession>
}
type LanguageModelSession = {
    promptStreaming: (input: string, opts?: { signal?: AbortSignal }) => ReadableStream<string>
    destroy: () => void
}

function getLanguageModel(): LanguageModelStatic | null {
    if (typeof self === 'undefined') return null
    const lm = (self as any).LanguageModel ?? (globalThis as any).LanguageModel
    return lm && typeof lm.availability === 'function' ? (lm as LanguageModelStatic) : null
}

// Is Chrome's Prompt API present and usable (available now or downloadable)?
export async function chromeAIAvailable(): Promise<boolean> {
    const lm = getLanguageModel()
    if (!lm) return false
    try {
        const status = await lm.availability()
        return status !== 'unavailable'
    } catch {
        return false
    }
}

function toChromeRole(role: ChatMessage['role']): ChromeRole {
    if (role === 'assistant' || role === 'system') return role
    return 'user' // map 'tool' and anything else to a user turn
}

export function warm() {
    // Kick a session create so the model starts downloading if needed.
    const lm = getLanguageModel()
    if (!lm) return
    void lm
        .create()
        .then(s => s.destroy())
        .catch(() => undefined)
}

export async function generate(messages: ChatMessage[], handlers: GenerateHandlers = {}): Promise<string> {
    const { onChunk, onProgress, onReady, signal } = handlers
    const lm = getLanguageModel()
    if (!lm) throw new Error('Chrome built-in AI (Prompt API) is not available in this browser.')

    onProgress?.('Starting Gemini Nano…')

    // First non-system message stays in order; the final turn is the live prompt.
    const convo = messages.filter(m => m.role !== 'system')
    const system = messages.find(m => m.role === 'system')?.content
    const last = convo[convo.length - 1]
    const priors = convo.slice(0, -1)

    const initialPrompts: ChromePrompt[] = [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        ...priors.map(m => ({ role: toChromeRole(m.role), content: m.content })),
    ]

    const session = await lm.create({
        initialPrompts: initialPrompts.length ? initialPrompts : undefined,
        monitor: m =>
            m.addEventListener('downloadprogress', (e: any) =>
                onProgress?.(`Downloading Gemini Nano… ${Math.round((e.loaded ?? 0) * 100)}%`)
            ),
        signal,
    })
    onReady?.()

    let full = ''
    try {
        const stream = session.promptStreaming(last?.content ?? '', { signal })
        const reader = stream.getReader()
        // The API has shipped both cumulative and delta chunking — handle both.
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (typeof value !== 'string' || !value) continue
            let delta = value
            if (value.length >= full.length && value.startsWith(full)) delta = value.slice(full.length)
            full = value.length >= full.length && value.startsWith(full) ? value : full + value
            if (delta) onChunk?.(delta)
        }
    } finally {
        session.destroy()
    }
    return full
}
