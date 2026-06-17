'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { profile, bio, links } from '../data/profile'

// ---- Types ----------------------------------------------------------------

type Role = 'user' | 'assistant' | 'tool'
type Msg = {
    role: Role
    content: string
    reasoning?: string
    // tool rows carry the call + (eventual) result for display
    toolName?: string
    toolArgs?: string
    toolResult?: string
}
type RuntimeDevice = 'webgpu' | 'wasm'
type RuntimeMode = {
    device: RuntimeDevice
    modelId: string
    dtype: 'q4' | 'q4f16'
    label: string
    maxNewTokens: number
}
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
type WorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'ready'; mode: RuntimeMode }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'tool-call'; id: string; name: string; args: string }
    | { type: 'tool-result'; id: string; name: string; result: string }
    | { type: 'step'; id: string; step: number }
    | { type: 'done'; id: string }
    | { type: 'error'; id?: string; message: string }

type ActiveGeneration = {
    id: string
    targetId: string
    raw: string
    frame: number | null
    resolve: () => void
    reject: (err: Error) => void
}

type Conversation = { id: string; messages: Msg[]; createdAt: number; updatedAt: number }

const EMPTY_MESSAGES: Msg[] = []

// ---- Model catalog --------------------------------------------------------
// Data-driven: every entry is a browser-runnable ONNX chat model. `agentic`
// marks models whose chat template supports tool calling well enough for the
// in-browser agent loop. Adding a model is just another row here.

type ModelEntry = {
    id: string
    name: string
    family: string
    size: string
    device: RuntimeDevice
    modelId: string
    dtype: 'q4' | 'q4f16'
    maxNewTokens: number
    agentic: boolean
    note?: string
}

const MODELS: ModelEntry[] = [
    {
        id: 'lfm2-350m',
        name: 'LFM2.5 350M',
        family: 'LiquidAI',
        size: '350M',
        device: 'webgpu',
        modelId: 'LiquidAI/LFM2.5-350M-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
        note: 'Fast · ~120MB',
    },
    {
        id: 'lfm2-1.2b',
        name: 'LFM2 1.2B',
        family: 'LiquidAI',
        size: '1.2B',
        device: 'webgpu',
        modelId: 'onnx-community/LFM2-1.2B-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
        note: 'Larger · sharper',
    },
    {
        id: 'gemma4-e2b',
        name: 'Gemma 4 E2B',
        family: 'Google Gemma',
        size: '2.3B',
        device: 'webgpu',
        modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
        note: 'Latest · ~1.5GB',
    },
    {
        id: 'gemma4-e4b',
        name: 'Gemma 4 E4B',
        family: 'Google Gemma',
        size: '4.5B',
        device: 'webgpu',
        modelId: 'onnx-community/gemma-4-E4B-it-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
        note: 'Highest quality · heavy',
    },
    {
        id: 'gemma3-4b',
        name: 'Gemma 3 4B',
        family: 'Google Gemma',
        size: '4B',
        device: 'webgpu',
        modelId: 'onnx-community/gemma-3-4b-it-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
        note: 'Larger · sharper',
    },
    {
        id: 'gemma3-1b',
        name: 'Gemma 3 1B',
        family: 'Google Gemma',
        size: '1B',
        device: 'webgpu',
        modelId: 'onnx-community/gemma-3-1b-it-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
    },
    {
        id: 'qwen3-0.6b',
        name: 'Qwen3 0.6B',
        family: 'Qwen',
        size: '0.6B',
        device: 'webgpu',
        modelId: 'onnx-community/Qwen3-0.6B-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
    },
    {
        id: 'qwen3.5-0.8b',
        name: 'Qwen3.5 0.8B',
        family: 'Qwen',
        size: '0.8B',
        device: 'webgpu',
        modelId: 'onnx-community/Qwen3.5-0.8B-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
    },
    {
        id: 'llama3.2-1b',
        name: 'Llama 3.2 1B',
        family: 'Meta Llama',
        size: '1B',
        device: 'webgpu',
        modelId: 'onnx-community/Llama-3.2-1B-Instruct',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
    },
    {
        id: 'deepseek-r1-1.5b',
        name: 'DeepSeek-R1 Distill 1.5B',
        family: 'DeepSeek',
        size: '1.5B',
        device: 'webgpu',
        modelId: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 1024,
        agentic: false,
        note: 'Reasoning',
    },
    {
        id: 'smollm2-360m',
        name: 'SmolLM2 360M',
        family: 'HuggingFace SmolLM',
        size: '360M',
        device: 'webgpu',
        modelId: 'HuggingFaceTB/SmolLM2-360M-Instruct',
        dtype: 'q4f16',
        maxNewTokens: 512,
        agentic: false,
    },
    {
        id: 'smollm2-135m',
        name: 'SmolLM2 135M',
        family: 'HuggingFace SmolLM',
        size: '135M',
        device: 'wasm',
        modelId: 'HuggingFaceTB/SmolLM2-135M-Instruct',
        dtype: 'q4',
        maxNewTokens: 256,
        agentic: false,
        note: 'WASM fallback',
    },
]

const DEFAULT_MODEL_ID = 'lfm2-350m'

const modeFor = (m: ModelEntry): RuntimeMode => ({
    device: m.device,
    modelId: m.modelId,
    dtype: m.dtype,
    label: m.name,
    maxNewTokens: m.maxNewTokens,
})

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

// Strip special tokens and <think> wrappers; route reasoning vs answer.
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

const STORAGE_KEY = 'teo.chat.v2'

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
                    .filter(
                        (m: any) =>
                            (m.role === 'user' || m.role === 'assistant' || m.role === 'tool') &&
                            typeof m.content === 'string'
                    )
                    .map((m: any) => ({
                        role: m.role as Role,
                        content: m.content as string,
                        ...(typeof m.reasoning === 'string' ? { reasoning: m.reasoning } : {}),
                        ...(typeof m.toolName === 'string' ? { toolName: m.toolName } : {}),
                        ...(typeof m.toolArgs === 'string' ? { toolArgs: m.toolArgs } : {}),
                        ...(typeof m.toolResult === 'string' ? { toolResult: m.toolResult } : {}),
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

// ---- Prompt context -------------------------------------------------------

// Fed to the get_profile_info tool so the agent can ground answers about Teo.
const TOOL_CONTEXT = [bio, '', 'Public links:', ...links.filter(l => l.href).map(l => `- ${l.label}: ${l.href}`)].join(
    '\n'
)

const SYSTEM_PROMPT_BASE = [
    "You are a helpful AI assistant running entirely in the user's browser via on-device inference — no data leaves the device.",
    `You live on teozeng.dev, the personal site of ${profile.name} (Weicheng Zeng), a data scientist in the New York City area at 3Victors/ATPCO working on airline pricing, ML, agent systems, and forecasting.`,
    'Answer any question helpfully and concisely.',
].join('\n')

const SYSTEM_PROMPT_TOOLS = [
    SYSTEM_PROMPT_BASE,
    'You can call tools when they help: calculator (arithmetic), get_current_datetime (the local date/time), and get_profile_info (facts about Teo). Use get_profile_info for any question about Teo before answering. Only call a tool when it is actually needed, then give a short final answer.',
].join('\n')

// ---- Component ------------------------------------------------------------

export default function ChatPage() {
    const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_ID)
    const selectedModel = MODELS.find(m => m.id === modelId) ?? MODELS[0]

    const [toolsEnabled, setToolsEnabled] = useState(true)
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
    const messages = active?.messages ?? EMPTY_MESSAGES
    const agenticActive = selectedModel.agentic && toolsEnabled

    // --- conversation mutation helpers ---
    const updateConv = useCallback((id: string, fn: (msgs: Msg[]) => Msg[]) => {
        setConversations(prev =>
            prev.map(c => (c.id === id ? { ...c, messages: fn(c.messages), updatedAt: Date.now() } : c))
        )
    }, [])

    // Hydrate from localStorage + probe WebGPU after mount.
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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

    useEffect(() => {
        return () => {
            const g = generationRef.current
            if (g?.frame != null) cancelAnimationFrame(g.frame)
            workerRef.current?.terminate()
        }
    }, [])

    useEffect(() => {
        if (stickRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages, progress])

    // Live-update the trailing assistant bubble with streamed text.
    const flushGeneration = useCallback(
        (gen: ActiveGeneration, final = false) => {
            const { reasoning, answer } = parseThinking(gen.raw)
            updateConv(gen.targetId, msgs => {
                const next = [...msgs]
                // find last assistant row
                for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].role === 'assistant') {
                        next[i] = {
                            role: 'assistant',
                            content: final ? answer.trim() : answer,
                            ...(reasoning ? { reasoning } : {}),
                        }
                        return next
                    }
                    if (next[i].role === 'user') break
                }
                return next
            })
        },
        [updateConv]
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
            worker = new Worker(new URL('./chat.worker.ts', import.meta.url), { type: 'module' })
        } catch {
            return null
        }

        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
            const msg = e.data
            const gen = generationRef.current

            if (msg.type === 'progress') {
                setStatus('loading')
                setProgress(msg.progress)
            } else if (msg.type === 'ready') {
                setStatus('ready')
                setProgress('')
            } else if (msg.type === 'step') {
                if (!gen || gen.id !== msg.id) return
                // step 0 reuses the assistant bubble created on send(); later steps
                // (after a tool call) start a fresh assistant bubble.
                gen.raw = ''
                if (msg.step > 0) updateConv(gen.targetId, m => [...m, { role: 'assistant', content: '' }])
            } else if (msg.type === 'chunk') {
                if (!gen || gen.id !== msg.id) return
                gen.raw += msg.chunk
                if (gen.frame === null) {
                    gen.frame = requestAnimationFrame(() => {
                        gen.frame = null
                        if (generationRef.current?.id === gen.id) flushGeneration(gen)
                    })
                }
            } else if (msg.type === 'tool-call') {
                if (!gen || gen.id !== msg.id) return
                if (gen.frame != null) cancelAnimationFrame(gen.frame)
                gen.frame = null
                // The streamed bubble was the model deciding to call a tool — replace
                // it with a tool row (hides the raw tool-call syntax).
                updateConv(gen.targetId, msgs => {
                    const next = [...msgs]
                    for (let i = next.length - 1; i >= 0; i--) {
                        if (next[i].role === 'assistant') {
                            next[i] = { role: 'tool', content: '', toolName: msg.name, toolArgs: msg.args }
                            return next
                        }
                        if (next[i].role === 'user') break
                    }
                    return [...next, { role: 'tool', content: '', toolName: msg.name, toolArgs: msg.args }]
                })
            } else if (msg.type === 'tool-result') {
                if (!gen || gen.id !== msg.id) return
                updateConv(gen.targetId, msgs => {
                    const next = [...msgs]
                    for (let i = next.length - 1; i >= 0; i--) {
                        if (
                            next[i].role === 'tool' &&
                            next[i].toolName === msg.name &&
                            next[i].toolResult === undefined
                        ) {
                            next[i] = { ...next[i], toolResult: msg.result }
                            return next
                        }
                    }
                    return next
                })
            } else if (msg.type === 'done') {
                if (!gen || gen.id !== msg.id) return
                if (gen.frame != null) cancelAnimationFrame(gen.frame)
                gen.frame = null
                flushGeneration(gen, true)
                generationRef.current = null
                setStatus('ready')
                setProgress('')
                gen.resolve()
            } else if (msg.type === 'error') {
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
            setStatus('error')
            if (generationRef.current) failGeneration(event.message || 'Worker failed.')
        }

        workerRef.current = worker
        return worker
    }, [failGeneration, flushGeneration, updateConv])

    const stopGeneration = useCallback(() => {
        const gen = generationRef.current
        if (!gen) return
        if (gen.frame != null) cancelAnimationFrame(gen.frame)
        gen.frame = null
        if (workerRef.current) workerRef.current.postMessage({ type: 'stop', id: gen.id })
    }, [])

    const send = useCallback(
        async (text: string) => {
            const q = text.trim()
            if (!q || streaming) return
            const targetId = activeId
            const base = conversations.find(c => c.id === targetId)?.messages ?? []
            const history: Msg[] = [...base, { role: 'user', content: q }]
            setInput('')
            updateConv(targetId, () => [...history, { role: 'assistant', content: '' }])
            setStreaming(true)
            setStreamingId(targetId)
            stickRef.current = true

            const mode = modeFor(selectedModel)
            const useTools = selectedModel.agentic && toolsEnabled

            try {
                if (!workerRef.current) {
                    setStatus('loading')
                    setProgress(`${mode.label}: starting worker...`)
                }
                const worker = getWorker()
                if (!worker) throw new Error('Web Workers are unavailable in this browser.')

                const id = uid()
                // Send a clean user/assistant transcript (tool rows are display-only).
                const promptMessages: ChatMessage[] = [
                    { role: 'system', content: useTools ? SYSTEM_PROMPT_TOOLS : SYSTEM_PROMPT_BASE },
                    ...history
                        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content.trim()))
                        .slice(-12)
                        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
                ]

                await new Promise<void>((resolve, reject) => {
                    generationRef.current = { id, targetId, raw: '', frame: null, resolve, reject }
                    worker.postMessage({
                        type: 'generate',
                        id,
                        mode,
                        messages: promptMessages,
                        useTools,
                        toolContext: useTools ? TOOL_CONTEXT : undefined,
                    })
                })
            } catch (err) {
                setStatus('ready')
                setProgress('')
                const errMsg = err instanceof Error ? err.message : 'Something went wrong.'
                updateConv(targetId, msgs => {
                    const next = [...msgs]
                    for (let i = next.length - 1; i >= 0; i--) {
                        if (next[i].role === 'assistant') {
                            next[i] = { role: 'assistant', content: `⚠️ ${errMsg}` }
                            return next
                        }
                    }
                    return [...next, { role: 'assistant', content: `⚠️ ${errMsg}` }]
                })
            } finally {
                setStreaming(false)
                setStreamingId(null)
                inputRef.current?.focus()
            }
        },
        [activeId, conversations, getWorker, selectedModel, streaming, toolsEnabled, updateConv]
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

    const switchModel = useCallback(
        (id: string) => {
            if (id === modelId || streaming) return
            workerRef.current?.terminate()
            workerRef.current = null
            setStatus('idle')
            setProgress('')
            setModelId(id)
            setSidebarOpen(false)
        },
        [modelId, streaming]
    )

    const sorted = useMemo(
        () => [...conversations].filter(c => c.messages.length > 0).sort((a, b) => b.updatedAt - a.updatedAt),
        [conversations]
    )

    const families = useMemo(() => {
        const order: string[] = []
        const byFamily: Record<string, ModelEntry[]> = {}
        for (const m of MODELS) {
            if (!byFamily[m.family]) {
                byFamily[m.family] = []
                order.push(m.family)
            }
            byFamily[m.family].push(m)
        }
        return order.map(f => ({ family: f, models: byFamily[f] }))
    }, [])

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

    const statusColor =
        status === 'ready'
            ? 'bg-emerald-500'
            : status === 'loading'
            ? 'animate-pulse bg-amber-400'
            : status === 'error'
            ? 'bg-rose-500'
            : 'bg-slate-300 dark:bg-slate-600'

    const sidebarContent = (
        <div className="flex h-full flex-col">
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
            <div className="border-b border-slate-100 px-3 py-3 dark:border-slate-800">
                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Model
                </p>
                <div className="max-h-64 space-y-3 overflow-y-auto">
                    {families.map(({ family, models }) => (
                        <div key={family}>
                            <p className="mb-1 px-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                {family}
                            </p>
                            <div className="space-y-0.5">
                                {models.map(m => {
                                    const unavailable = m.device === 'webgpu' && gpuAvailable === false
                                    const isActive = modelId === m.id
                                    return (
                                        <button
                                            key={m.id}
                                            type="button"
                                            disabled={unavailable || streaming}
                                            onClick={() => switchModel(m.id)}
                                            title={unavailable ? 'Requires WebGPU' : m.modelId}
                                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                                                isActive
                                                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                                                    : unavailable
                                                    ? 'cursor-not-allowed opacity-40'
                                                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                            }`}
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-1.5">
                                                    <span className="truncate text-[13px] font-medium">{m.name}</span>
                                                    {m.agentic && (
                                                        <span
                                                            title="Supports tools"
                                                            className={`text-[10px] ${
                                                                isActive ? 'text-emerald-300' : 'text-emerald-500'
                                                            }`}
                                                        >
                                                            ⚒
                                                        </span>
                                                    )}
                                                </span>
                                                {m.note && (
                                                    <span
                                                        className={`block truncate text-[11px] ${
                                                            isActive
                                                                ? 'text-slate-300 dark:text-slate-500'
                                                                : 'text-slate-400 dark:text-slate-500'
                                                        }`}
                                                    >
                                                        {m.note}
                                                    </span>
                                                )}
                                            </span>
                                            <span
                                                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                                    m.device === 'webgpu'
                                                        ? isActive
                                                            ? 'bg-blue-500 text-white'
                                                            : 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                                                        : isActive
                                                        ? 'bg-amber-500 text-white'
                                                        : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                                                }`}
                                            >
                                                {m.device === 'webgpu' ? 'GPU' : 'WASM'}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>
                {gpuAvailable === false && (
                    <p className="mt-2 px-1 text-[11px] text-slate-400 dark:text-slate-500">
                        WebGPU unavailable — use a WASM model or try Chrome/Edge.
                    </p>
                )}
            </div>

            {/* Tools toggle */}
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <label className={`flex items-center justify-between ${selectedModel.agentic ? '' : 'opacity-40'}`}>
                    <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                        Tools (agent)
                        <span className="ml-1 block text-[11px] font-normal text-slate-400 dark:text-slate-500">
                            calculator · datetime · profile
                        </span>
                    </span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={agenticActive}
                        disabled={!selectedModel.agentic}
                        onClick={() => setToolsEnabled(v => !v)}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                            agenticActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                        } ${selectedModel.agentic ? '' : 'cursor-not-allowed'}`}
                    >
                        <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                                agenticActive ? 'left-[18px]' : 'left-0.5'
                            }`}
                        />
                    </button>
                </label>
                {!selectedModel.agentic && (
                    <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                        This model doesn&apos;t support tool calling.
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

            <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 lg:flex">
                {sidebarContent}
            </aside>

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
                <div className="hidden shrink-0 items-center justify-between border-b border-slate-100 px-6 py-3 dark:border-slate-800 lg:flex">
                    <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                        <span className="text-[14px] font-medium text-slate-700 dark:text-slate-200">
                            {selectedModel.name}
                        </span>
                        <span className="text-[13px] text-slate-400 dark:text-slate-500">
                            · {agenticActive ? 'agent · ' : ''}private, on-device
                        </span>
                    </div>
                    {progress && (
                        <span className="max-w-xs truncate text-[12px] text-slate-400 dark:text-slate-500">
                            {progress}
                        </span>
                    )}
                </div>

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
                            <p className="mt-1 max-w-sm text-[14px] text-slate-400 dark:text-slate-500">
                                Runs privately in your browser · no data leaves your device
                                {agenticActive && ' · tools enabled'}
                            </p>
                        </div>
                    ) : (
                        <div className="mx-auto max-w-2xl space-y-4">
                            {messages.map((m, i) => {
                                const isLast = i === messages.length - 1
                                if (m.role === 'tool') return <ToolRow key={i} msg={m} />
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

// A single tool call + result row in the transcript.
function ToolRow({ msg }: { msg: Msg }) {
    const [open, setOpen] = useState(false)
    let argsPretty = msg.toolArgs || ''
    try {
        argsPretty = JSON.stringify(JSON.parse(msg.toolArgs || '{}'))
    } catch {
        /* keep raw */
    }
    const pending = msg.toolResult === undefined
    return (
        <div className="flex justify-start">
            <div className="max-w-[85%]">
                <button
                    type="button"
                    onClick={() => setOpen(o => !o)}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-[13px] text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                    <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            pending ? 'animate-pulse bg-amber-400' : 'bg-emerald-500'
                        }`}
                    />
                    <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5 shrink-0 text-slate-400"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6a2 2 0 1 0 2.8 2.8l6-6a4 4 0 0 0 5.6-5.6l-2.1 2.1-2.2-2.2 2.1-2.1z" />
                    </svg>
                    <span className="font-mono">{msg.toolName}</span>
                    <span className="truncate text-slate-400 dark:text-slate-500">{argsPretty}</span>
                    {pending && <span className="text-slate-400">· running…</span>}
                </button>
                {open && !pending && (
                    <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-900 px-3 py-2 text-[12px] leading-relaxed text-slate-100 dark:bg-black">
                        {msg.toolResult}
                    </pre>
                )}
            </div>
        </div>
    )
}
