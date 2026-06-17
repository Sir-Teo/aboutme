'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

// ---- Types ----------------------------------------------------------------

type Role = 'user' | 'assistant'
type Msg = { role: Role; content: string; reasoning?: string }
type RuntimeDevice = 'webgpu' | 'wasm'
type RuntimeMode = {
    device: RuntimeDevice
    modelId: string
    dtype: 'q4' | 'q4f16'
    label: string
    maxNewTokens: number
}
type WorkerChatMessage = { role: 'system' | Role; content: string }
type WorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'fallback'; mode: RuntimeMode; progress: string }
    | { type: 'ready'; mode: RuntimeMode }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'done'; id: string }
    | { type: 'error'; id?: string; message: string }

type ActiveGeneration = {
    id: string
    targetId: string
    history: Msg[]
    raw: string
    frame: number | null
    resolve: () => void
    reject: (err: Error) => void
}

type Conversation = {
    id: string
    messages: Msg[]
    createdAt: number
    updatedAt: number
}

// ---- Model catalog --------------------------------------------------------

const MODELS = [
    {
        id: 'lfm2',
        name: 'LFM2.5 350M',
        provider: 'LiquidAI',
        badge: 'WebGPU',
        mode: {
            device: 'webgpu' as RuntimeDevice,
            modelId: 'LiquidAI/LFM2.5-350M-ONNX',
            dtype: 'q4f16' as const,
            label: 'LFM2.5',
            maxNewTokens: 512,
        },
    },
    {
        id: 'gemma3-1b',
        name: 'Gemma 3 1B',
        provider: 'Google',
        badge: 'WebGPU',
        mode: {
            device: 'webgpu' as RuntimeDevice,
            modelId: 'onnx-community/gemma-3-1b-it-ONNX',
            dtype: 'q4f16' as const,
            label: 'Gemma 3',
            maxNewTokens: 512,
        },
    },
    {
        id: 'smollm2',
        name: 'SmolLM2 135M',
        provider: 'HuggingFace',
        badge: 'WASM',
        mode: {
            device: 'wasm' as RuntimeDevice,
            modelId: 'HuggingFaceTB/SmolLM2-135M-Instruct',
            dtype: 'q4' as const,
            label: 'SmolLM2',
            maxNewTokens: 256,
        },
    },
]

// ---- Helpers --------------------------------------------------------------

const uid = (): string =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)

const createConv = (messages: Msg[] = []): Conversation => {
    const now = Date.now()
    return { id: uid(), messages, createdAt: now, updatedAt: now }
}

const convTitle = (c: Conversation): string =>
    c.messages
        .find(m => m.role === 'user')
        ?.content.trim()
        .slice(0, 60) || 'New chat'

// WebGPU probe (cached — reopening page reuses first result)
const PROBE_TIMEOUT_MS = 1200
let gpuProbe: Promise<boolean> | null = null
async function probeWebGPU(): Promise<boolean> {
    const gpu = (navigator as any).gpu
    if (!gpu?.requestAdapter) return false
    try {
        const adapter: any = await Promise.race([
            gpu.requestAdapter(),
            new Promise<null>(r => setTimeout(() => r(null), PROBE_TIMEOUT_MS)),
        ])
        if (!adapter) return false
        if (typeof adapter.requestDevice === 'function') {
            const device: any = await Promise.race([
                adapter.requestDevice(),
                new Promise<null>(r => setTimeout(() => r(null), PROBE_TIMEOUT_MS)),
            ])
            if (!device) return false
            device.destroy?.()
        }
        return true
    } catch {
        return false
    }
}
const webgpuAvailable = () => (gpuProbe ??= probeWebGPU())

// Strip model special tokens and <think> wrappers; route reasoning vs answer
function parseThinking(raw: string): { reasoning: string; answer: string } {
    const clean = (s: string) =>
        s
            .replace(/<\|[^|]*\|>/g, '')
            .replace(/<think>/g, '')
            .trim()
    const end = raw.lastIndexOf('</think>')
    if (end !== -1) return { reasoning: clean(raw.slice(0, end)), answer: clean(raw.slice(end + 8)) }
    if (raw.includes('<think>')) return { reasoning: clean(raw), answer: '' }
    return { reasoning: '', answer: clean(raw) }
}

// ---- Persistence ----------------------------------------------------------

const STORAGE_KEY = 'teo.chat.v1'

function loadHistory(): { convs: Conversation[]; activeId: string } | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const p = JSON.parse(raw)
        if (!Array.isArray(p?.conversations) || !p.conversations.length) return null
        const convs: Conversation[] = p.conversations
            .filter((c: any) => c?.id && Array.isArray(c.messages) && c.messages.length > 0)
            .map((c: any) => ({
                id: String(c.id),
                messages: (c.messages as any[])
                    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
                    .map((m: any) => ({
                        role: m.role as Role,
                        content: m.content as string,
                        ...(typeof m.reasoning === 'string' ? { reasoning: m.reasoning } : {}),
                    })),
                createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
                updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
            }))
            .filter((c: Conversation) => c.messages.length > 0)
            .slice(-100)
        if (!convs.length) return null
        const activeId = convs.find((c: Conversation) => c.id === p.activeId)?.id ?? convs[convs.length - 1].id
        return { convs, activeId }
    } catch {
        return null
    }
}

// ---- System prompt --------------------------------------------------------

const SYSTEM_PROMPT = [
    "You are a helpful AI assistant running entirely in the user's browser using on-device inference. No data leaves the device.",
    'You are hosted on teozeng.dev, the personal website of Teo Zeng (Weicheng Zeng), a Data Scientist in the New York City area working at 3Victors/ATPCO on airline pricing, ML, and forecasting.',
    'Answer any question helpfully and concisely. For questions about Teo, use the above context.',
].join('\n')

// ---- Component ------------------------------------------------------------

export default function ChatPage() {
    const [modelId, setModelId] = useState<string>('lfm2')
    const selectedModel = MODELS.find(m => m.id === modelId) ?? MODELS[0]

    const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null)
    const [conversations, setConversations] = useState<Conversation[]>(() => [createConv()])
    const [activeId, setActiveId] = useState<string>('')
    const [hydrated, setHydrated] = useState(false)

    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const [progress, setProgress] = useState('')
    const [streaming, setStreaming] = useState(false)
    const [streamingId, setStreamingId] = useState<string | null>(null)
    const [input, setInput] = useState('')
    const [sidebarOpen, setSidebarOpen] = useState(false)

    const workerRef = useRef<Worker | null>(null)
    const generationRef = useRef<ActiveGeneration | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const stickRef = useRef(true)

    const active = conversations.find(c => c.id === activeId)
    const messages = active?.messages ?? []

    // Hydrate localStorage after mount so SSR markup is stable
    useEffect(() => {
        const saved = loadHistory()
        if (saved) {
            setConversations(saved.convs)
            setActiveId(saved.activeId)
        } else {
            setActiveId(conversations[0].id)
        }
        setHydrated(true)
        webgpuAvailable()
            .then(setGpuAvailable)
            .catch(() => setGpuAvailable(false))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Persist to localStorage on change
    useEffect(() => {
        if (!hydrated) return
        const t = setTimeout(() => {
            const toSave = conversations.filter(c => c.messages.length > 0).slice(-100)
            if (!toSave.length) {
                localStorage.removeItem(STORAGE_KEY)
                return
            }
            const savedActive = toSave.find(c => c.id === activeId)?.id ?? toSave[toSave.length - 1].id
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations: toSave, activeId: savedActive }))
        }, 300)
        return () => clearTimeout(t)
    }, [conversations, activeId, hydrated])

    // Worker cleanup on unmount
    useEffect(() => {
        return () => {
            const g = generationRef.current
            if (g?.frame != null) cancelAnimationFrame(g.frame)
            workerRef.current?.terminate()
        }
    }, [])

    // Scroll to bottom on new content
    useEffect(() => {
        if (stickRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages, progress])

    const setConvMessages = useCallback((id: string, msgs: Msg[]) => {
        setConversations(prev => prev.map(c => (c.id === id ? { ...c, messages: msgs, updatedAt: Date.now() } : c)))
    }, [])

    const flushGeneration = useCallback(
        (gen: ActiveGeneration, final = false) => {
            const { reasoning, answer } = parseThinking(gen.raw)
            const msg: Msg = { role: 'assistant', content: final ? answer.trim() : answer }
            if (reasoning) msg.reasoning = reasoning
            setConvMessages(gen.targetId, [...gen.history, msg])
        },
        [setConvMessages]
    )

    const failGeneration = useCallback((message: string) => {
        const gen = generationRef.current
        if (gen?.frame != null) cancelAnimationFrame(gen.frame)
        generationRef.current = null
        gen?.reject(new Error(message))
    }, [])

    const getWorker = useCallback((): Worker | null => {
        if (workerRef.current) return workerRef.current
        let worker: Worker
        try {
            worker = new Worker(new URL('../components/AskAI.worker.ts', import.meta.url), { type: 'module' })
        } catch {
            return null
        }

        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
            const msg = e.data
            if (msg.type === 'progress') {
                setStatus('loading')
                setProgress(msg.progress)
            } else if (msg.type === 'fallback') {
                setStatus('loading')
                setProgress(msg.progress)
            } else if (msg.type === 'ready') {
                setStatus('ready')
                setProgress('')
            } else if (msg.type === 'chunk') {
                const gen = generationRef.current
                if (!gen || gen.id !== msg.id) return
                gen.raw += msg.chunk
                if (gen.frame === null) {
                    gen.frame = requestAnimationFrame(() => {
                        gen.frame = null
                        if (generationRef.current?.id === gen.id) flushGeneration(gen)
                    })
                }
            } else if (msg.type === 'done') {
                const gen = generationRef.current
                if (!gen || gen.id !== msg.id) return
                if (gen.frame != null) cancelAnimationFrame(gen.frame)
                gen.frame = null
                flushGeneration(gen, true)
                generationRef.current = null
                setStatus('ready')
                setProgress('')
                gen.resolve()
            } else if (msg.type === 'error') {
                const gen = generationRef.current
                if (gen && (!msg.id || gen.id === msg.id)) {
                    if (gen.frame != null) cancelAnimationFrame(gen.frame)
                    generationRef.current = null
                    gen.reject(new Error(msg.message))
                }
                setStatus('error')
                setProgress('')
            }
        }

        worker.onerror = event => {
            setProgress('')
            worker.terminate()
            if (workerRef.current === worker) workerRef.current = null
            if (generationRef.current) {
                setStatus('error')
                failGeneration(event.message || 'Worker failed.')
            } else {
                setStatus('error')
            }
        }

        workerRef.current = worker
        return worker
    }, [failGeneration, flushGeneration])

    const stopGeneration = useCallback(() => {
        const gen = generationRef.current
        if (!gen) return
        if (gen.frame != null) cancelAnimationFrame(gen.frame)
        gen.frame = null
        if (gen.raw && workerRef.current) {
            workerRef.current.postMessage({ type: 'stop', id: gen.id })
            return
        }
        const { answer } = parseThinking(gen.raw)
        setConvMessages(gen.targetId, [...gen.history, { role: 'assistant', content: answer || 'Stopped.' }])
        generationRef.current = null
        workerRef.current?.terminate()
        workerRef.current = null
        setProgress('')
        setStatus('ready')
        setStreaming(false)
        setStreamingId(null)
        gen.resolve()
        inputRef.current?.focus()
    }, [setConvMessages])

    const send = useCallback(
        async (text: string) => {
            const q = text.trim()
            if (!q || streaming) return
            const targetId = activeId
            const base = conversations.find(c => c.id === targetId)?.messages ?? []
            const history: Msg[] = [...base, { role: 'user', content: q }]
            setInput('')
            setConvMessages(targetId, [...history, { role: 'assistant', content: '' }])
            setStreaming(true)
            setStreamingId(targetId)
            stickRef.current = true

            try {
                const mode = selectedModel.mode
                if (!workerRef.current) {
                    setStatus('loading')
                    setProgress(`${mode.label}: starting worker...`)
                }
                const worker = getWorker()
                if (!worker) throw new Error('Web Workers are unavailable in this browser.')

                const id = uid()
                const promptMessages: WorkerChatMessage[] = [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...history.slice(-12).map(m => ({ role: m.role, content: m.content })),
                ]

                await new Promise<void>((resolve, reject) => {
                    generationRef.current = { id, targetId, history, raw: '', frame: null, resolve, reject }
                    worker.postMessage({ type: 'generate', id, mode, messages: promptMessages })
                })
            } catch (err) {
                setStatus('ready')
                setProgress('')
                const errMsg = err instanceof Error ? err.message : 'Something went wrong.'
                setConvMessages(targetId, [
                    ...history.slice(0, -1),
                    { role: 'user', content: q },
                    { role: 'assistant', content: `Error: ${errMsg}` },
                ])
            } finally {
                setStreaming(false)
                setStreamingId(null)
                inputRef.current?.focus()
            }
        },
        [activeId, conversations, getWorker, selectedModel, setConvMessages, streaming]
    )

    const newChat = useCallback(() => {
        const empty = conversations.find(c => c.messages.length === 0)
        if (empty) {
            setActiveId(empty.id)
        } else {
            const next = createConv()
            setConversations(prev => [...prev, next])
            setActiveId(next.id)
        }
        setInput('')
        setSidebarOpen(false)
        inputRef.current?.focus()
    }, [conversations])

    const sorted = useMemo(
        () => [...conversations].filter(c => c.messages.length > 0).sort((a, b) => b.updatedAt - a.updatedAt),
        [conversations]
    )

    const onScroll = () => {
        const el = scrollRef.current
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send(input)
        }
    }

    // Switch model: tear down existing worker so the next send re-initialises
    // with the newly selected model (the worker keeps the old model resident).
    const switchModel = useCallback(
        (id: string) => {
            if (id === modelId) return
            if (streaming) return
            workerRef.current?.terminate()
            workerRef.current = null
            setStatus('idle')
            setProgress('')
            setModelId(id)
            setSidebarOpen(false)
        },
        [modelId, streaming]
    )

    const statusColor =
        status === 'ready'
            ? 'bg-emerald-500'
            : status === 'loading'
            ? 'bg-amber-400 animate-pulse'
            : status === 'error'
            ? 'bg-rose-500'
            : 'bg-slate-300 dark:bg-slate-600'

    const sidebarContent = (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <Link
                    href="/"
                    className="flex items-center gap-1.5 text-[13px] text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                    <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M19 12H5M12 5l-7 7 7 7" />
                    </svg>
                    teozeng.dev
                </Link>
                <button
                    type="button"
                    onClick={newChat}
                    title="New chat"
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                    <svg
                        viewBox="0 0 24 24"
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
            </div>

            {/* Model picker */}
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Model
                </p>
                <div className="space-y-1">
                    {MODELS.map(m => {
                        const needsGPU = m.mode.device === 'webgpu'
                        const unavailable = needsGPU && gpuAvailable === false
                        const active = modelId === m.id
                        return (
                            <button
                                key={m.id}
                                type="button"
                                disabled={unavailable || streaming}
                                onClick={() => switchModel(m.id)}
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition ${
                                    active
                                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                                        : unavailable
                                        ? 'cursor-not-allowed opacity-40'
                                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                }`}
                            >
                                <div>
                                    <span className="block text-[13px] font-medium">{m.name}</span>
                                    <span
                                        className={`block text-[11px] ${
                                            active
                                                ? 'text-slate-300 dark:text-slate-500'
                                                : 'text-slate-400 dark:text-slate-500'
                                        }`}
                                    >
                                        {m.provider}
                                    </span>
                                </div>
                                <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        needsGPU
                                            ? active
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                                            : active
                                            ? 'bg-amber-500 text-white'
                                            : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                                    }`}
                                >
                                    {m.badge}
                                </span>
                            </button>
                        )
                    })}
                </div>
                {gpuAvailable === false && (
                    <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                        WebGPU unavailable — use WASM or try Chrome/Edge.
                    </p>
                )}
            </div>

            {/* History */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    History
                </p>
                {sorted.length === 0 ? (
                    <p className="text-[13px] text-slate-400 dark:text-slate-500">No conversations yet.</p>
                ) : (
                    <ul className="space-y-0.5">
                        {sorted.map(c => (
                            <li key={c.id}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveId(c.id)
                                        setSidebarOpen(false)
                                        stickRef.current = true
                                    }}
                                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition ${
                                        c.id === activeId
                                            ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50'
                                    }`}
                                >
                                    {streamingId === c.id ? (
                                        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                                    ) : (
                                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                                    )}
                                    <span className="block truncate text-[13px]">{convTitle(c)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
                <p className="text-[11px] text-slate-400 dark:text-slate-500">Private · on-device · no data sent</p>
            </div>
        </div>
    )

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-slate-950 lg:flex-row">
            {/* Mobile top bar */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800 lg:hidden">
                <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="flex items-center gap-2 text-[14px] font-medium text-slate-700 dark:text-slate-200"
                >
                    <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <line x1="3" y1="12" x2="21" y2="12" />
                        <line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                    Chat
                </button>
                <div className="flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
                    <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                    {selectedModel.name}
                </div>
            </div>

            {/* Sidebar — desktop */}
            <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 lg:flex">
                {sidebarContent}
            </aside>

            {/* Sidebar — mobile drawer */}
            {sidebarOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
                    <aside className="absolute left-0 top-0 h-full w-72 overflow-y-auto bg-white shadow-xl dark:bg-slate-900">
                        {sidebarContent}
                    </aside>
                </div>
            )}

            {/* Chat area */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* Desktop header */}
                <div className="hidden shrink-0 items-center justify-between border-b border-slate-100 px-6 py-3 dark:border-slate-800 lg:flex">
                    <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                        <span className="text-[14px] font-medium text-slate-700 dark:text-slate-200">
                            {selectedModel.name}
                        </span>
                        <span className="text-[13px] text-slate-400 dark:text-slate-500">· private, on-device</span>
                    </div>
                    {progress && (
                        <span className="max-w-xs truncate text-[12px] text-slate-400 dark:text-slate-500">
                            {progress}
                        </span>
                    )}
                </div>

                {/* Message thread */}
                <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                    {messages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center text-center">
                            <div className="mb-4 rounded-2xl bg-slate-100 p-5 dark:bg-slate-800">
                                <svg
                                    viewBox="0 0 24 24"
                                    className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                            </div>
                            <h2 className="text-[18px] font-semibold text-slate-700 dark:text-slate-200">
                                {selectedModel.name}
                            </h2>
                            <p className="mt-1 text-[14px] text-slate-400 dark:text-slate-500">
                                Runs privately in your browser · no data leaves your device
                            </p>
                        </div>
                    ) : (
                        <div className="mx-auto max-w-2xl space-y-4">
                            {messages.map((m, i) => {
                                const isLast = i === messages.length - 1
                                const showDots =
                                    m.role === 'assistant' && isLast && streaming && !m.content && !m.reasoning
                                if (m.role === 'user') {
                                    return (
                                        <div key={i} className="flex justify-end">
                                            <div className="max-w-[80%] rounded-2xl bg-slate-900 px-4 py-2.5 text-[15px] leading-relaxed text-slate-50 dark:bg-slate-100 dark:text-slate-900">
                                                <span className="whitespace-pre-wrap break-words">{m.content}</span>
                                            </div>
                                        </div>
                                    )
                                }
                                return (
                                    <div key={i} className="flex justify-start">
                                        <div className="max-w-[85%] space-y-2">
                                            {m.reasoning && (
                                                <div className="border-l-2 border-slate-200 pl-3 text-[13px] leading-relaxed text-slate-400 dark:border-slate-700 dark:text-slate-500">
                                                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide">
                                                        {m.content ? 'Reasoning' : 'Thinking…'}
                                                    </span>
                                                    <span className="whitespace-pre-wrap break-words">
                                                        {m.reasoning}
                                                    </span>
                                                </div>
                                            )}
                                            {(m.content || showDots) && (
                                                <div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-[15px] leading-relaxed text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                                                    <span className="whitespace-pre-wrap break-words">
                                                        {m.content || '…'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                            {status === 'loading' && progress && (
                                <p className="text-center text-[13px] text-slate-400 dark:text-slate-500">{progress}</p>
                            )}
                        </div>
                    )}
                </div>

                {/* Composer */}
                <div className="shrink-0 border-t border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-6">
                    <div className="mx-auto max-w-2xl">
                        <div className="flex items-end gap-3 rounded-2xl bg-slate-100 px-4 py-3 ring-1 ring-transparent focus-within:ring-slate-300 dark:bg-slate-800 dark:focus-within:ring-slate-600">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={
                                    streaming ? 'Generating…' : 'Message · Enter to send, Shift+Enter for newline'
                                }
                                disabled={streaming}
                                rows={1}
                                style={{ resize: 'none' }}
                                className="max-h-40 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-slate-100"
                            />
                            {streaming ? (
                                <button
                                    type="button"
                                    onClick={stopGeneration}
                                    aria-label="Stop generation"
                                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500 text-white transition hover:bg-rose-600"
                                >
                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                                        <rect x="7" y="7" width="10" height="10" rx="1.5" />
                                    </svg>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    disabled={!input.trim()}
                                    onClick={() => send(input)}
                                    aria-label="Send"
                                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-slate-50 transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                                >
                                    <svg
                                        viewBox="0 0 24 24"
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
                        </div>
                        <p className="mt-2 text-center text-[11px] text-slate-300 dark:text-slate-600">
                            Runs privately in your browser · no data leaves your device
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
