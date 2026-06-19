'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
        id: 'lfm25-1.2b-instruct',
        name: 'LFM2.5 1.2B Instruct',
        family: 'LiquidAI',
        size: '1.2B',
        device: 'webgpu',
        modelId: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
        note: 'Larger · sharper',
    },
    {
        id: 'lfm25-1.2b-thinking',
        name: 'LFM2.5 1.2B Thinking',
        family: 'LiquidAI',
        size: '1.2B',
        device: 'webgpu',
        modelId: 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 1024,
        agentic: true,
        note: 'Reasoning',
    },
    {
        id: 'lfm25-8b-a1b',
        name: 'LFM2.5 8B A1B',
        family: 'LiquidAI',
        size: '8B MoE',
        device: 'webgpu',
        modelId: 'LiquidAI/LFM2.5-8B-A1B-ONNX',
        dtype: 'q4f16',
        maxNewTokens: 768,
        agentic: true,
        note: 'MoE · 1B active · heavy',
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

const STORAGE_KEY = 'localchat.history.v1'

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

const SYSTEM_PROMPT_BASE = [
    "You are a helpful AI assistant running entirely in the user's browser via on-device inference — no data leaves the device.",
    'Answer any question helpfully and concisely.',
].join('\n')

const SYSTEM_PROMPT_TOOLS = [
    SYSTEM_PROMPT_BASE,
    'You have tools — call them only when they genuinely help:',
    '• calculator — arithmetic expressions',
    '• get_current_datetime — current local date/time',
    '• format_json — validate and pretty-print JSON',
    '• convert_units — length, mass, volume, temperature, area, time',
    '• regex_test — test a regex pattern against text',
    '• encode_decode — base64 / URL / HTML encoding and decoding',
    'Call at most one tool per step. After the result, give a concise final answer.',
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
    const [modelMenuOpen, setModelMenuOpen] = useState(false)

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

    // If WebGPU is unavailable, don't leave the user stranded on a GPU-only
    // default model — fall back to the WASM model so the first send works.
    useEffect(() => {
        if (gpuAvailable !== false || selectedModel.device !== 'webgpu' || streaming) return
        const fallback = MODELS.find(m => m.device === 'wasm')
        if (fallback) setModelId(fallback.id)
    }, [gpuAvailable, selectedModel.device, streaming])

    useEffect(() => {
        if (!hydrated) return
        const t = setTimeout(() => {
            try {
                const toSave = conversations.filter(c => c.messages.length > 0).slice(-100)
                if (!toSave.length) {
                    localStorage.removeItem(STORAGE_KEY)
                    return
                }
                const savedActive = toSave.find(c => c.id === activeId)?.id ?? toSave[toSave.length - 1].id
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversations: toSave, activeId: savedActive }))
            } catch {
                /* storage full or unavailable — keep the session in memory */
            }
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
        // Don't submit mid-IME-composition (Enter commits the candidate instead).
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
        <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-900">
            <div className="px-2 pt-3">
                <button
                    type="button"
                    onClick={newChat}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[14px] font-medium text-slate-700 transition hover:bg-slate-200/60 dark:text-slate-200 dark:hover:bg-slate-800"
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
                        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    New chat
                </button>
            </div>

            {/* History */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
                {sorted.length === 0 ? (
                    <p className="px-2 py-1 text-[13px] text-slate-400 dark:text-slate-500">No conversations yet.</p>
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
                                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                                        c.id === activeId
                                            ? 'bg-slate-200/70 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                            : 'text-slate-600 hover:bg-slate-200/50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                                    }`}
                                >
                                    {streamingId === c.id && (
                                        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                                    )}
                                    <span className="block truncate text-[14px]">{convTitle(c)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )

    const suggestions = agenticActive
        ? ["What's 17% of 240?", 'Convert 5 miles to km', 'Base64-encode "hello world"']
        : ['Explain WebGPU simply', 'Write a haiku about the ocean', 'Ideas for a weekend trip']

    // Shared composer — rendered centered on an empty chat (ChatGPT style) and
    // pinned to the bottom once a conversation has started.
    const composer = (
        <div className="mx-auto w-full max-w-3xl">
            <div className="flex items-end gap-2 rounded-[26px] border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm transition focus-within:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-600">
                <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={streaming ? 'Generating…' : 'Ask anything'}
                    disabled={streaming}
                    rows={1}
                    style={{ resize: 'none' }}
                    className="max-h-44 flex-1 bg-transparent px-2 py-2 text-[15px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-slate-100"
                />
                {streaming ? (
                    <button
                        type="button"
                        onClick={stopGeneration}
                        aria-label="Stop generation"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-white transition hover:opacity-90 dark:bg-white dark:text-slate-900"
                    >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                            <rect x="7" y="7" width="10" height="10" rx="2" />
                        </svg>
                    </button>
                ) : (
                    <button
                        type="button"
                        disabled={!input.trim()}
                        onClick={() => send(input)}
                        aria-label="Send"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-white transition enabled:hover:opacity-90 disabled:opacity-30 dark:bg-white dark:text-slate-900"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                    </button>
                )}
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-300 dark:text-slate-600">
                On-device · no data leaves your device
            </p>
        </div>
    )

    return (
        <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-950">
            {/* Sidebar — desktop */}
            <aside className="hidden w-64 shrink-0 lg:block">{sidebarContent}</aside>

            {/* Sidebar — mobile drawer */}
            {sidebarOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
                    <aside className="absolute left-0 top-0 h-full w-72 overflow-y-auto shadow-xl">
                        {sidebarContent}
                    </aside>
                </div>
            )}

            {/* Main */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* Top bar */}
                <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 py-2 sm:px-4">
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setSidebarOpen(true)}
                            aria-label="Open sidebar"
                            className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:hidden"
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
                        </button>

                        {/* Model selector dropdown */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setModelMenuOpen(o => !o)}
                                aria-haspopup="listbox"
                                aria-expanded={modelMenuOpen}
                                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[16px] font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
                                {selectedModel.name}
                                <svg
                                    viewBox="0 0 24 24"
                                    className={`h-4 w-4 text-slate-400 transition ${modelMenuOpen ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M6 9l6 6 6-6" />
                                </svg>
                            </button>
                            {modelMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-30" onClick={() => setModelMenuOpen(false)} />
                                    <div className="absolute left-0 top-full z-40 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                        {families.map(({ family, models }) => (
                                            <div key={family} className="py-0.5">
                                                <p className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                                    {family}
                                                </p>
                                                {models.map(m => {
                                                    const unavailable = m.device === 'webgpu' && gpuAvailable === false
                                                    const isActive = modelId === m.id
                                                    return (
                                                        <button
                                                            key={m.id}
                                                            type="button"
                                                            disabled={unavailable || streaming}
                                                            onClick={() => {
                                                                switchModel(m.id)
                                                                setModelMenuOpen(false)
                                                            }}
                                                            title={unavailable ? 'Requires WebGPU' : m.modelId}
                                                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                                                                unavailable
                                                                    ? 'cursor-not-allowed opacity-40'
                                                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                                                            }`}
                                                        >
                                                            <span className="min-w-0">
                                                                <span className="flex items-center gap-1.5">
                                                                    <span className="truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">
                                                                        {m.name}
                                                                    </span>
                                                                    {m.agentic && (
                                                                        <span
                                                                            title="Supports tools"
                                                                            className="text-[10px] text-emerald-500"
                                                                        >
                                                                            ⚒
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                {m.note && (
                                                                    <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">
                                                                        {m.note}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="flex shrink-0 items-center gap-1.5">
                                                                <span
                                                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                                                        m.device === 'webgpu'
                                                                            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                                                                            : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                                                                    }`}
                                                                >
                                                                    {m.device === 'webgpu' ? 'GPU' : 'WASM'}
                                                                </span>
                                                                {isActive && (
                                                                    <svg
                                                                        viewBox="0 0 24 24"
                                                                        className="h-4 w-4 text-slate-700 dark:text-slate-200"
                                                                        fill="none"
                                                                        stroke="currentColor"
                                                                        strokeWidth="2.5"
                                                                        strokeLinecap="round"
                                                                        strokeLinejoin="round"
                                                                    >
                                                                        <path d="M20 6 9 17l-5-5" />
                                                                    </svg>
                                                                )}
                                                            </span>
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        ))}
                                        {gpuAvailable === false && (
                                            <p className="px-2.5 py-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                                                WebGPU unavailable — use a WASM model or try Chrome/Edge.
                                            </p>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Tools pill */}
                        {selectedModel.agentic && (
                            <button
                                type="button"
                                onClick={() => setToolsEnabled(v => !v)}
                                aria-pressed={agenticActive}
                                title="Tools: calculator · datetime · JSON · unit converter · regex · encoder"
                                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                                    agenticActive
                                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                                }`}
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
                                    <path d="M14.7 6.3a4 4 0 0 0-5.6 5.6l-6 6a2 2 0 1 0 2.8 2.8l6-6a4 4 0 0 0 5.6-5.6l-2.1 2.1-2.2-2.2 2.1-2.1z" />
                                </svg>
                                Tools
                            </button>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={newChat}
                        aria-label="New chat"
                        className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:hidden"
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
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                    </button>
                </div>

                {messages.length === 0 ? (
                    /* Empty state: centered greeting + composer (ChatGPT style) */
                    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
                        <h2 className="mb-7 text-center text-[28px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">
                            What can I help with?
                        </h2>
                        {composer}
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                            {suggestions.map(s => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => send(s)}
                                    className="rounded-full border border-slate-200 px-3.5 py-1.5 text-[13px] text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                        {status === 'loading' && progress && (
                            <p className="mt-4 text-[13px] text-slate-400 dark:text-slate-500">{progress}</p>
                        )}
                    </div>
                ) : (
                    <>
                        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 sm:px-6">
                            <div className="mx-auto max-w-3xl space-y-5 py-6">
                                {messages.map((m, i) => {
                                    const isLast = i === messages.length - 1
                                    if (m.role === 'tool') return <ToolRow key={i} msg={m} />
                                    const showDots =
                                        m.role === 'assistant' && isLast && streaming && !m.content && !m.reasoning
                                    if (m.role === 'user') {
                                        return (
                                            <div key={i} className="flex justify-end">
                                                <div className="max-w-[75%] whitespace-pre-wrap break-words rounded-3xl bg-slate-100 px-4 py-2.5 text-[15px] leading-relaxed text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                                                    {m.content}
                                                </div>
                                            </div>
                                        )
                                    }
                                    return (
                                        <div key={i} className="space-y-2">
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
                                            {(m.content || showDots) &&
                                                (showDots ? (
                                                    <span className="inline-flex gap-1 py-1">
                                                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.2s] dark:bg-slate-600" />
                                                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.1s] dark:bg-slate-600" />
                                                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 dark:bg-slate-600" />
                                                    </span>
                                                ) : (
                                                    <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-800 dark:text-slate-100">
                                                        {m.content}
                                                    </div>
                                                ))}
                                        </div>
                                    )
                                })}
                                {status === 'loading' && progress && (
                                    <p className="text-center text-[13px] text-slate-400 dark:text-slate-500">
                                        {progress}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="shrink-0 px-4 pb-3 pt-1 sm:px-6">{composer}</div>
                    </>
                )}
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
