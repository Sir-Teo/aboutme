'use client'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { profile, links, bio } from '../data/profile'

// An "Ask AI" pill that runs LiquidAI's LFM2.5-1.2B-Thinking model fully in the
// browser via Transformers.js (@huggingface/transformers) on WebGPU — no
// backend, no API keys, nothing leaves the device. The runtime and the ~1.2 GB
// model are lazy-loaded on first use, so they cost nothing on page load. WebGPU
// is required; where it is missing the panel explains that instead of breaking.

type Role = 'user' | 'assistant'
// `reasoning` holds the model's streamed chain-of-thought (assistant turns only).
type Msg = { role: Role; content: string; reasoning?: string }

const MODEL_ID = 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX'
const DTYPE = 'q4'

// WebGPU availability gates whether we can run at all.
async function webgpuAvailable(): Promise<boolean> {
    const gpu = (navigator as any).gpu
    if (!gpu) return false
    try {
        return !!(await gpu.requestAdapter())
    } catch {
        return false
    }
}

// Seed the model with who Teo is so answers stay on-topic and grounded.
function systemPrompt(): string {
    const social = links
        .filter(l => l.href)
        .map(l => `- ${l.label}: ${l.href}`)
        .join('\n')
    return [
        `You are a friendly assistant embedded on ${profile.name}'s personal website.`,
        `Answer questions about ${profile.name} concisely and in a warm, first-impression tone.`,
        `If you don't know something specific, say so rather than inventing facts.`,
        ``,
        `About ${profile.name}:`,
        bio,
        ``,
        `Links where people can find ${profile.name}:`,
        social,
    ].join('\n')
}

// LFM2.5-Thinking streams its chain-of-thought inside <think>…</think> before
// the answer. We surface both: the reasoning (shown live, muted) and the final
// reply. Everything up to </think> is reasoning; everything after is the answer.
function parseThinking(raw: string): { reasoning: string; answer: string } {
    // Strip chat special tokens (e.g. <|im_end|>) and the opening <think> tag.
    const clean = (s: string) =>
        s
            .replace(/<\|[^|]*\|>/g, '')
            .replace(/<think>/g, '')
            .trim()
    const end = raw.lastIndexOf('</think>')
    if (end !== -1) {
        return { reasoning: clean(raw.slice(0, end)), answer: clean(raw.slice(end + '</think>'.length)) }
    }
    // No closing tag yet — still reasoning, no answer.
    return { reasoning: clean(raw), answer: '' }
}

const SUGGESTIONS = ['Who is Teo?', 'What sports does Teo like?', 'Where can I find Teo online?']

export default function AskAI({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [supported, setSupported] = useState<boolean | null>(null) // null = unknown yet
    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const [progress, setProgress] = useState('')
    const [messages, setMessages] = useState<Msg[]>([])
    const [streaming, setStreaming] = useState(false)
    const [input, setInput] = useState('')

    const generatorRef = useRef<any>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    // Whether to keep pinning to the bottom as new tokens stream. Flipped off when
    // the user scrolls up to read history mid-generation, back on when they return.
    const stickRef = useRef(true)

    // Probe WebGPU the first time the panel opens.
    useEffect(() => {
        if (!open || supported !== null) return
        let alive = true
        webgpuAvailable().then(ok => alive && setSupported(ok))
        return () => {
            alive = false
        }
    }, [open, supported])

    const onScroll = () => {
        const el = scrollRef.current
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    }

    // Follow the latest tokens only while the user is parked at the bottom, so
    // scrolling up to read earlier messages isn't yanked back during generation.
    useEffect(() => {
        if (stickRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages, progress])

    const ensureGenerator = useCallback(async () => {
        if (generatorRef.current) return generatorRef.current
        setStatus('loading')
        const { pipeline } = await import('@huggingface/transformers') // lazy — nothing on page load
        console.info(`[AskAI] loading model: ${MODEL_ID} (${DTYPE}, webgpu)`)
        const generator = await pipeline('text-generation', MODEL_ID, {
            dtype: DTYPE,
            device: 'webgpu',
            progress_callback: (p: any) => {
                if (p.status === 'progress' && typeof p.progress === 'number') {
                    setProgress(`Downloading model… ${Math.round(p.progress)}%`)
                } else if (p.status === 'ready' || p.status === 'done') {
                    setProgress('Preparing…')
                }
            },
        })
        console.info(`[AskAI] model ready: ${MODEL_ID}`)
        generatorRef.current = generator
        setProgress('')
        setStatus('ready')
        return generator
    }, [])

    const send = useCallback(
        async (text: string) => {
            const q = text.trim()
            if (!q || streaming) return
            setInput('')
            const history = [...messages, { role: 'user' as Role, content: q }]
            setMessages([...history, { role: 'assistant', content: '' }])
            setStreaming(true)
            stickRef.current = true // new turn: follow the stream until the user scrolls
            try {
                const generator = await ensureGenerator()
                const { TextStreamer } = await import('@huggingface/transformers')
                let raw = ''
                const streamer = new TextStreamer(generator.tokenizer, {
                    skip_prompt: true,
                    skip_special_tokens: false,
                    callback_function: (chunk: string) => {
                        raw += chunk
                        const { reasoning, answer } = parseThinking(raw)
                        setMessages([...history, { role: 'assistant', content: answer, reasoning }])
                    },
                })
                await generator([{ role: 'system', content: systemPrompt() }, ...history], {
                    max_new_tokens: 2048,
                    do_sample: false,
                    streamer,
                })
            } catch (e) {
                console.error('[AskAI] error:', e)
                setStatus('error')
                setMessages([
                    ...history,
                    { role: 'assistant', content: 'Sorry — something went wrong loading the model on this device.' },
                ])
            } finally {
                setStreaming(false)
                inputRef.current?.focus()
            }
        },
        [messages, streaming, ensureGenerator]
    )

    // Start a fresh conversation without unloading the model.
    const newChat = useCallback(() => {
        if (streaming) return
        setMessages([])
        setInput('')
        if (status === 'error') setStatus(generatorRef.current ? 'ready' : 'idle')
        inputRef.current?.focus()
    }, [streaming, status])

    return (
        <div
            aria-hidden={!open}
            className={`grid transition-all duration-300 ease-out motion-reduce:transition-none ${
                open ? 'mt-3 grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
            }`}
        >
            <div className="min-h-0 overflow-hidden">
                <div className="relative flex h-[clamp(220px,55vh,420px)] flex-col rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                            <span className="relative flex h-2 w-2">
                                <span
                                    className={`inline-flex h-2 w-2 rounded-full ${
                                        status === 'ready'
                                            ? 'bg-emerald-500'
                                            : status === 'loading'
                                            ? 'animate-pulse bg-amber-400'
                                            : status === 'error'
                                            ? 'bg-rose-500'
                                            : 'bg-slate-300 dark:bg-slate-600'
                                    }`}
                                />
                            </span>
                            <span>
                                Ask AI
                                <span className="text-slate-400 dark:text-slate-500"> · private, on-device</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            {messages.length > 0 && (
                                <button
                                    type="button"
                                    onClick={newChat}
                                    disabled={streaming}
                                    aria-label="Start a new chat"
                                    title="New chat"
                                    tabIndex={open ? 0 : -1}
                                    className="flex items-center gap-1 rounded px-1.5 py-1 text-[13px] text-slate-400 transition hover:text-slate-600 disabled:opacity-40 dark:hover:text-slate-200"
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        aria-hidden
                                        className="h-3.5 w-3.5"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M12 5v14M5 12h14" />
                                    </svg>
                                    New
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close Ask AI panel"
                                tabIndex={open ? 0 : -1}
                                className="grid h-6 w-6 place-items-center rounded text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
                            >
                                <svg
                                    viewBox="0 0 24 24"
                                    aria-hidden
                                    className="h-3.5 w-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                >
                                    <path d="M6 6l12 12M18 6 6 18" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* transcript */}
                    <div
                        ref={scrollRef}
                        onScroll={onScroll}
                        className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[15px] leading-relaxed"
                    >
                        {supported === false ? (
                            <p className="text-slate-500 dark:text-slate-400">
                                This runs a language model directly in your browser, which needs{' '}
                                <span className="font-medium text-slate-700 dark:text-slate-200">WebGPU</span>. It
                                isn&apos;t available here — try a recent Chrome or Edge on desktop, or Chrome on
                                Android.
                            </p>
                        ) : messages.length === 0 ? (
                            <div className="text-slate-500 dark:text-slate-400">
                                <p>Ask me anything about {profile.name}.</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {SUGGESTIONS.map(s => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => send(s)}
                                            tabIndex={open ? 0 : -1}
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
                                // While the last assistant turn has produced neither reasoning
                                // nor answer yet, show a typing indicator.
                                const showDots =
                                    m.role === 'assistant' && isLast && streaming && !m.content && !m.reasoning
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
                                    <div key={i} className="space-y-1.5 text-left">
                                        {m.reasoning && (
                                            <div className="border-l-2 border-slate-200 pl-2.5 text-[13px] leading-relaxed text-slate-400 dark:border-slate-700 dark:text-slate-500">
                                                <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                                    {m.content ? 'Reasoning' : 'Thinking…'}
                                                </span>
                                                <span className="whitespace-pre-wrap break-words">{m.reasoning}</span>
                                            </div>
                                        )}
                                        {(m.content || showDots) && (
                                            <span className="inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-slate-100 px-3.5 py-2 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                                                {m.content || '…'}
                                            </span>
                                        )}
                                    </div>
                                )
                            })
                        )}
                        {status === 'loading' && progress && (
                            <p className="text-[13px] text-slate-400 dark:text-slate-500">{progress}</p>
                        )}
                    </div>

                    {/* composer */}
                    {supported !== false && (
                        <form
                            onSubmit={e => {
                                e.preventDefault()
                                send(input)
                            }}
                            className="flex items-center gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-800"
                        >
                            <input
                                ref={inputRef}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                placeholder={streaming ? 'Thinking…' : `Ask about ${profile.name.split(' ')[0]}…`}
                                disabled={streaming || supported === null}
                                spellCheck={false}
                                enterKeyHint="send"
                                aria-label="Ask AI input"
                                tabIndex={open ? 0 : -1}
                                className="flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-slate-100"
                            />
                            <button
                                type="submit"
                                disabled={streaming || !input.trim()}
                                aria-label="Send"
                                tabIndex={open ? 0 : -1}
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
                        </form>
                    )}
                </div>
            </div>
        </div>
    )
}

export const AskAIChip = forwardRef<HTMLButtonElement, { active: boolean; onClick: () => void }>(function AskAIChip(
    { active, onClick },
    ref
) {
    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            aria-expanded={active}
            aria-label={active ? 'Close Ask AI' : 'Open Ask AI'}
            title="Ask an on-device AI about Teo"
            className={`group inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 transition hover:-translate-y-0.5 ${
                active
                    ? 'bg-slate-900 text-slate-100 ring-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-300'
                    : 'bg-white text-slate-700 ring-slate-200 hover:ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:ring-slate-600'
            }`}
        >
            <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M12 3a4 4 0 0 1 4 4 4 4 0 0 1 0 8 4 4 0 0 1-8 0 4 4 0 0 1 0-8 4 4 0 0 1 4-4Z" />
                <path d="M12 7v.01M9 11h6" />
            </svg>
            <span>Ask AI</span>
        </button>
    )
})
