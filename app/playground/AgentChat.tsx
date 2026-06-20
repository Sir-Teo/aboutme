'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { profile, links } from '../data/profile'
import type { Engine } from './engines'
import { webgpuAvailable, webgpuHelpHint } from '../lib/webgpu'
import { generate, warm, disposeModel, type ChatMessage } from './agent/runtime'
import { groundingBlock, warmIndex } from './agent/retrieval'
import { warmEmbedder } from './agent/embeddings'
import { runAgent } from './agent/graph'
import { availableTools, type ToolContext } from './agent/tools'
import {
    rememberFact,
    recallMemory,
    autoCapture,
    listMemories,
    deleteMemory,
    clearMemories,
    subscribeMemory,
    type Memory,
} from './agent/memory'

type Role = 'user' | 'assistant'
type Msg = { role: Role; content: string }

const SUGGESTIONS = ['What does Teo work on?', 'Where did Teo study?', 'Open Teo’s GitHub']

// The assistant's persona. Grounding (semantic RAG) and tool observations are
// appended by the agent graph's respond node — this is just the voice + rules.
const PERSONA = [
    `You are a helpful assistant embedded on ${profile.name}'s personal website.`,
    `Answer concisely and warmly, in one or two short sentences.`,
    `Refer to him as Teo, never he/him/his/she/her.`,
    `Only use the provided context; if you don't know, say so rather than inventing.`,
].join('\n')

// Resolve a profile link by label (case-insensitive, loose match).
function findLinkHref(name: string): string | undefined {
    const q = name.trim().toLowerCase()
    const match = links.find(l => l.href && (l.label.toLowerCase() === q || l.label.toLowerCase().includes(q)))
    return match?.href
}

export default function AgentChat({ engine }: { engine: Engine }) {
    const [gpu, setGpu] = useState<'checking' | 'ready' | 'unavailable'>('checking')
    const [messages, setMessages] = useState<Msg[]>([])
    const [input, setInput] = useState('')
    const [streaming, setStreaming] = useState(false)
    const [progress, setProgress] = useState('')
    const [memories, setMemories] = useState<Memory[]>([])
    const [showMemory, setShowMemory] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    // Stable per-mount conversation id — used by the agent's checkpointer (P4).
    const threadId = useRef(`t-${Date.now().toString(36)}`)

    // Client-side effects the agent's action tools trigger in the browser.
    const toolContext = useMemo<ToolContext>(
        () => ({
            openLink: name => {
                const href = findLinkHref(name)
                if (!href) return null
                window.open(href, '_blank', 'noopener,noreferrer')
                return href
            },
            navigate: target => {
                const t = target.trim().toLowerCase()
                if (t === 'home' || t === 'links' || t === 'projects') {
                    window.location.href = '/'
                    return true
                }
                return false
            },
            setTheme: theme => {
                const c = document.documentElement.classList
                c.toggle('dark', theme === 'dark')
                try {
                    localStorage.setItem('theme', theme)
                } catch {}
                return true
            },
            rememberFact: async fact => {
                await rememberFact(fact)
            },
            recallMemory: query => recallMemory(query, 3),
        }),
        []
    )

    // Probe WebGPU once; warm the engine as soon as we know it's available.
    useEffect(() => {
        let alive = true
        webgpuAvailable().then(ok => {
            if (!alive) return
            setGpu(ok ? 'ready' : 'unavailable')
            if (ok) {
                warm(engine)
                // Warm the retrieval stack too so the first answer isn't blocked
                // on the embedder cold-starting.
                warmEmbedder()
                warmIndex()
            }
        })
        return () => {
            alive = false
            // Leaving the chat tab: free the model's GPU memory (it reloads from
            // the browser cache on return — no re-download).
            disposeModel()
        }
    }, [engine])

    // Auto-scroll the transcript as it grows.
    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages, progress])

    // Keep the memory panel in sync with the on-device store (persists across
    // reloads; updates whenever the agent remembers/forgets something).
    useEffect(() => {
        let alive = true
        const refresh = () => listMemories().then(m => alive && setMemories(m))
        refresh()
        const unsubscribe = subscribeMemory(refresh)
        return () => {
            alive = false
            unsubscribe()
        }
    }, [])

    const send = useCallback(
        async (text: string) => {
            const query = text.trim()
            if (!query || streaming || gpu !== 'ready') return
            setInput('')
            setProgress('')

            const priorHistory = messages.map(m => ({ role: m.role, content: m.content } as ChatMessage))
            setMessages([...messages, { role: 'user', content: query }, { role: 'assistant', content: '' }])
            setStreaming(true)

            const controller = new AbortController()
            abortRef.current = controller
            const assistantIndex = messages.length + 1

            const appendToAnswer = (chunk: string) =>
                setMessages(prev => {
                    const next = prev.slice()
                    const cur = next[assistantIndex]
                    if (cur && cur.role === 'assistant') next[assistantIndex] = { ...cur, content: cur.content + chunk }
                    return next
                })

            try {
                setProgress('Thinking…')
                // Auto-capture obvious self-disclosures before the turn so they're
                // recallable immediately (and persist for next visit).
                await autoCapture(query)
                await runAgent({
                    llm: (msgs, opts) =>
                        generate(engine, msgs, {
                            signal: controller.signal,
                            onProgress: setProgress,
                            onReady: () => setProgress(''),
                            onChunk: opts?.onChunk,
                        }),
                    tools: availableTools(toolContext),
                    ctx: toolContext,
                    persona: PERSONA,
                    // Grounding = profile RAG + anything we remember about this visitor.
                    grounding: async q => {
                        const [facts, mems] = await Promise.all([groundingBlock(q, 5), recallMemory(q, 3)])
                        return mems.length
                            ? `${facts}\n\nWhat you remember about the visitor:\n${mems.map(m => `- ${m}`).join('\n')}`
                            : facts
                    },
                    history: priorHistory,
                    input: query,
                    threadId: threadId.current,
                    onToolEvent: e => setProgress(`Using ${e.name}…`),
                    onChunk: chunk => {
                        setProgress('')
                        appendToAnswer(chunk)
                    },
                })
            } catch (error) {
                setMessages(prev => {
                    const next = prev.slice()
                    const cur = next[assistantIndex]
                    const message = error instanceof Error ? error.message : 'Something went wrong.'
                    if (cur && cur.role === 'assistant' && !cur.content) {
                        next[assistantIndex] = { ...cur, content: `Error: ${message}` }
                    }
                    return next
                })
            } finally {
                setStreaming(false)
                setProgress('')
                abortRef.current = null
            }
        },
        [engine, gpu, messages, streaming, toolContext]
    )

    const stop = useCallback(() => {
        abortRef.current?.abort()
    }, [])

    const newChat = useCallback(() => {
        if (streaming) abortRef.current?.abort()
        setMessages([])
        setInput('')
        setProgress('')
    }, [streaming])

    // Download the conversation as a Markdown transcript (stays on-device).
    const exportChat = useCallback(() => {
        const md = messages.map(m => `**${m.role === 'user' ? 'You' : 'Assistant'}:** ${m.content}`).join('\n\n')
        const blob = new Blob([`# Chat with ${profile.name}'s assistant\n\n${md}\n`], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `chat-${new Date().toISOString().slice(0, 10)}.md`
        a.click()
        URL.revokeObjectURL(url)
    }, [messages])

    const empty = messages.length === 0
    const firstName = useMemo(() => profile.name.split(' ')[0], [])

    if (gpu === 'unavailable') {
        return (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[14px] font-medium text-slate-800 dark:text-slate-100">WebGPU required</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                    This playground runs frontier models entirely on your device — that needs WebGPU, which this browser
                    isn’t exposing.
                </p>
                <p className="mt-2 text-[12px] text-slate-400">{webgpuHelpHint()}</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <span className="relative flex h-2 w-2">
                        <span
                            className={`inline-flex h-2 w-2 rounded-full ${
                                gpu === 'checking'
                                    ? 'animate-pulse bg-amber-400'
                                    : streaming
                                    ? 'animate-pulse bg-amber-400'
                                    : 'bg-emerald-500'
                            }`}
                        />
                    </span>
                    <span>
                        {engine.label}
                        <span className="text-slate-400 dark:text-slate-500"> · on-device</span>
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setShowMemory(s => !s)}
                        aria-pressed={showMemory}
                        title="What this assistant remembers about you (stored only on your device)"
                        className={`flex items-center gap-1 rounded px-1.5 py-1 text-[13px] transition ${
                            showMemory
                                ? 'text-slate-700 dark:text-slate-200'
                                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                        }`}
                    >
                        Memory{memories.length > 0 && <span className="opacity-70">· {memories.length}</span>}
                    </button>
                    {!empty && (
                        <button
                            type="button"
                            onClick={exportChat}
                            title="Download this conversation"
                            className="flex items-center gap-1 rounded px-1.5 py-1 text-[13px] text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
                        >
                            Export
                        </button>
                    )}
                    {!empty && (
                        <button
                            type="button"
                            onClick={newChat}
                            className="flex items-center gap-1 rounded px-1.5 py-1 text-[13px] text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
                        >
                            New
                        </button>
                    )}
                </div>
            </div>

            {showMemory && (
                <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                        <p className="text-[12px] text-slate-500 dark:text-slate-400">
                            Stored on your device only — never uploaded.
                        </p>
                        {memories.length > 0 && (
                            <button
                                type="button"
                                onClick={() => clearMemories()}
                                className="text-[12px] text-rose-500 transition hover:text-rose-600"
                            >
                                Clear all
                            </button>
                        )}
                    </div>
                    {memories.length === 0 ? (
                        <p className="mt-2 text-[13px] text-slate-400">
                            Nothing yet. Tell me about yourself and I’ll remember it next time.
                        </p>
                    ) : (
                        <ul className="mt-2 space-y-1">
                            {memories.map(m => (
                                <li
                                    key={m.id}
                                    className="group flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                                >
                                    <span className="min-w-0 flex-1">{m.text}</span>
                                    <button
                                        type="button"
                                        onClick={() => deleteMemory(m.id)}
                                        aria-label="Forget this"
                                        title="Forget this"
                                        className="shrink-0 text-[12px] text-slate-400 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                                    >
                                        Forget
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <div
                ref={scrollRef}
                className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[15px] leading-relaxed"
                style={{ maxHeight: '52vh', minHeight: '12rem' }}
            >
                {empty ? (
                    <div className="text-slate-500 dark:text-slate-400">
                        <p>Ask me anything about {profile.name}.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {SUGGESTIONS.map(s => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => send(s)}
                                    className="rounded-full bg-slate-100 px-3 py-1 text-[13px] text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    messages.map((m, i) => {
                        const isLast = i === messages.length - 1
                        const showDots = m.role === 'assistant' && isLast && streaming && !m.content
                        if (m.role === 'user') {
                            return (
                                <div key={i} className="text-right">
                                    <span className="inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-slate-900 px-3.5 py-2 text-left text-slate-50 dark:bg-slate-100 dark:text-slate-900">
                                        {m.content}
                                    </span>
                                </div>
                            )
                        }
                        return (
                            <div key={i} className="text-left">
                                <span className="inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-slate-100 px-3.5 py-2 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                                    {m.content || (showDots ? '…' : '')}
                                </span>
                            </div>
                        )
                    })
                )}
                {progress && <p className="text-[13px] text-slate-400 dark:text-slate-500">{progress}</p>}
            </div>

            <form
                onSubmit={e => {
                    e.preventDefault()
                    send(input)
                }}
                className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-800"
            >
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={streaming ? 'Thinking…' : `Ask about ${firstName}…`}
                    disabled={streaming}
                    spellCheck={false}
                    enterKeyHint="send"
                    aria-label="Chat input"
                    className="flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-slate-100"
                />
                {streaming ? (
                    <button
                        type="button"
                        onClick={stop}
                        aria-label="Stop generation"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose-500 text-white transition hover:bg-rose-600"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="currentColor">
                            <rect x="7" y="7" width="10" height="10" rx="1.5" />
                        </svg>
                    </button>
                ) : (
                    <button
                        type="submit"
                        disabled={!input.trim()}
                        aria-label="Send"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-slate-50 transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            aria-hidden
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                    </button>
                )}
            </form>
        </div>
    )
}
