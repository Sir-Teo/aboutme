'use client'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { profile, links } from '../data/profile'

// An "Ask AI" pill that answers fully in the browser. Capable devices use
// WebGPU model inference; other supported browsers use a WASM model path, with
// the profile-grounded responder kept only as a last-resort fallback.

type Role = 'user' | 'assistant'
// `reasoning` holds the model's streamed chain-of-thought (assistant turns only).
type Msg = { role: Role; content: string; reasoning?: string }

type RuntimeDevice = 'webgpu' | 'wasm' | 'instant'
type RuntimeMode = {
    device: RuntimeDevice
    modelId: string
    dtype: 'q4'
    label: string
    maxNewTokens: number
}

type WorkerChatMessage = { role: 'system' | Role; content: string }
type AskAIWorkerMessage =
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
    reject: (error: Error) => void
}

const WEBGPU_MODE: RuntimeMode = {
    device: 'webgpu',
    modelId: 'LiquidAI/LFM2.5-350M-ONNX',
    dtype: 'q4',
    label: 'WebGPU',
    maxNewTokens: 80,
}

const WASM_MODE: RuntimeMode = {
    device: 'wasm',
    modelId: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    dtype: 'q4',
    label: 'WASM',
    maxNewTokens: 80,
}

const MOBILE_WASM_MODE: RuntimeMode = {
    ...WASM_MODE,
    label: 'WASM Mobile',
    maxNewTokens: 48,
}

const LOW_POWER_WASM_MODE: RuntimeMode = {
    ...WASM_MODE,
    label: 'WASM Lite',
    maxNewTokens: 32,
}

const INSTANT_MODE: RuntimeMode = {
    device: 'instant',
    modelId: 'profile-summary',
    dtype: 'q4',
    label: 'Instant',
    maxNewTokens: 0,
}

const HISTORY_STORAGE_KEY = 'teo.askai.history.v1'
const MAX_HISTORY_CONVERSATIONS = 24
const MAX_MODEL_HISTORY_MESSAGES = 6
const MAX_MODEL_MESSAGE_CHARS = 360
const COMPACT_MODEL_HISTORY_MESSAGES = 4
const COMPACT_MODEL_MESSAGE_CHARS = 260
const WEBGPU_PROBE_TIMEOUT_MS = 1200
const WEBGPU_MIN_MEMORY_GB = 4
const WASM_MIN_MEMORY_GB = 1.5
const MAX_ANSWER_WORDS = 55
const EMPTY_MESSAGES: Msg[] = []

const MODEL_PROFILE_CONTEXT = [
    'Full name: Weicheng Zeng, goes by Teo. Based in the New York City area.',
    'Current role: Data Scientist at 3Victors / ATPCO since Sept 2024, focused on airline pricing, travel data, ML, agent systems, forecasting, and near-real-time pipelines.',
    'Current highlights: airline fare foundation model on 5B+ fare records; LangGraph/Graph RAG and NL-to-SQL agent systems; PriceEye pipeline for 2B+ records/day; multi-horizon demand forecasting.',
    'Education: M.S. Data Science from NYU, 2023-2025, GPA 3.90. B.S. from UC Santa Barbara, 2019-2023, GPA 3.95, triple major in Applied Mathematics, Statistics & Data Science, and Psychological & Brain Sciences.',
    'Research: AI Research Associate at NYU Langone Health, 2024-2025, with work in 4D MRI brain tumor segmentation, acute pancreatitis severity prediction, and HCC recurrence prediction.',
    'Prior experience: AI Software Engineer Intern at T.M. Bier & Associates in 2024, building cost-estimation, causal-inference, forecasting, Docker, Django, and React systems.',
    'Skills: machine learning, NLP, time series, causal inference, anomaly detection, Python, PyTorch, TensorFlow, JAX, scikit-learn, pandas, SQL, R, Java, C++, MATLAB, AWS, GCP, Docker, CI/CD, Django, React.',
    'Publications: co-author on peer-reviewed medical AI and crystallography papers, including HCC recurrence, acute pancreatitis severity from CT, and deep residual networks for crystallography.',
    'Projects: agentic legal consultant for overseas export requirements; Web-Katrain, a browser-based Go app with TensorFlow.js and custom Monte Carlo Tree Search.',
    'Interests: traveling, running, basketball and other sports, research, and video games.',
].join('\n')

// A much shorter grounding block for the WASM path. Small models (135M) can't use
// 250 words of context well, and a long system prompt is re-encoded (prefill) on
// every turn — the dominant per-answer cost on weak/mobile devices. Trimming it
// is the single biggest throughput win there.
const MODEL_PROFILE_CONTEXT_COMPACT = [
    'Weicheng Zeng (goes by Teo) is a New York City area Data Scientist at 3Victors/ATPCO, working on airline pricing, ML, agent systems, and forecasting.',
    'Education: M.S. in Data Science from NYU; B.S. from UC Santa Barbara (triple major in Applied Math, Statistics & Data Science, and Psychological & Brain Sciences).',
    'Past: AI research at NYU Langone Health (medical imaging AI); AI software engineer intern at T.M. Bier.',
    'Skills: ML, NLP, time series, causal inference, Python, PyTorch, SQL, AWS/GCP, Docker, Django, React.',
    'Interests: traveling, running, basketball and other sports, research, and video games.',
].join('\n')

// Prefer WebGPU anywhere the browser and device actually expose a working
// adapter/device. ONNX may still reject a specific model later; the worker then
// falls back to WASM without requiring a browser allowlist here.
// The probe (adapter + device request) is comparatively slow, so cache the
// promise: reopening the panel reuses the first result instead of re-probing.
let webgpuProbe: Promise<boolean> | null = null
function webgpuAvailable(): Promise<boolean> {
    return (webgpuProbe ??= probeWebgpu())
}

async function probeWebgpu(): Promise<boolean> {
    const gpu = (navigator as any).gpu
    if (!gpu?.requestAdapter) return false
    try {
        const adapter: any = await withTimeout(gpu.requestAdapter(), WEBGPU_PROBE_TIMEOUT_MS)
        if (!adapter) return false
        if (typeof adapter.requestDevice === 'function') {
            const devicePromise: Promise<any> = adapter.requestDevice()
            const device: any = await withTimeout(devicePromise, WEBGPU_PROBE_TIMEOUT_MS)
            if (!device) {
                devicePromise.then((lateDevice: any) => lateDevice?.destroy?.()).catch(() => undefined)
                return false
            }
            device?.destroy?.()
        }
        return true
    } catch {
        return false
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
        return await Promise.race([
            promise,
            new Promise<null>(resolve => {
                timeout = setTimeout(() => resolve(null), timeoutMs)
            }),
        ])
    } finally {
        if (timeout) clearTimeout(timeout)
    }
}

function wasmAvailable(): boolean {
    return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function'
}

function likelyMobileBrowser(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || ''
    const platform = navigator.platform || ''
    const ipadDesktopMode = platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1
    return ipadDesktopMode || /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)
}

function deviceMemoryGB(): number | null {
    if (typeof navigator === 'undefined') return null
    const nav = navigator as any
    const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null
    return typeof memory === 'number' && Number.isFinite(memory) && memory > 0 ? memory : null
}

function hasMemoryFor(minGb: number): boolean {
    const memory = deviceMemoryGB()
    return memory === null || memory >= minGb
}

function memoryCappedWasmMode(): RuntimeMode {
    const memory = deviceMemoryGB()
    if (memory !== null && memory < WASM_MIN_MEMORY_GB) return INSTANT_MODE
    if (memory !== null && memory < WEBGPU_MIN_MEMORY_GB) return LOW_POWER_WASM_MODE
    if (likelyMobileBrowser()) return MOBILE_WASM_MODE
    return WASM_MODE
}

async function detectRuntime(): Promise<RuntimeMode | false> {
    // Phones/tablets stay on the lighter WASM model: mobile WebGPU is memory-risky
    // for a 350M model (and these browsers rarely report deviceMemory to gate it),
    // so loading it can crash the tab. Desktops still get WebGPU when available.
    const mobile = likelyMobileBrowser()
    if (!mobile && hasMemoryFor(WEBGPU_MIN_MEMORY_GB) && (await webgpuAvailable())) return WEBGPU_MODE

    if (wasmAvailable()) {
        return memoryCappedWasmMode()
    }

    return INSTANT_MODE
}

// Seed the model with who Teo is so answers stay on-topic and grounded.
// `compact` builds a token-light prompt for the WASM path (see the compact
// context note above); the full prompt is used on the roomier WebGPU path.
function systemPrompt(compact = false): string {
    if (compact) {
        return [
            `You are a friendly assistant on ${profile.name}'s personal website.`,
            `Answer questions about ${profile.name} in one short sentence, 30 words or fewer.`,
            `Refer to him only as Teo or Teo's — never he, him, his, she, or her.`,
            `Only use the facts below; if you don't know, say so.`,
            ``,
            `About Teo:`,
            MODEL_PROFILE_CONTEXT_COMPACT,
            ``,
            `Find Teo: ${linkLine(['LinkedIn', 'GitHub', 'Email']).replace(/\n/g, ' · ')}`,
        ].join('\n')
    }
    const social = links
        .filter(l => l.href)
        .map(l => `- ${l.label}: ${l.href}`)
        .join('\n')
    return [
        `You are a friendly assistant embedded on ${profile.name}'s personal website.`,
        `Answer questions about ${profile.name} concisely and in a warm, first-impression tone.`,
        `Keep every answer to one or two short sentences, 35 words or fewer.`,
        `Do not use he, him, his, she, or her for Teo. Use Teo or Teo's instead.`,
        `Return only the final answer. Do not include hidden reasoning or <think> tags.`,
        `If you don't know something specific, say so rather than inventing facts.`,
        ``,
        `About ${profile.name}:`,
        MODEL_PROFILE_CONTEXT,
        ``,
        `Links where people can find ${profile.name}:`,
        social,
    ].join('\n')
}

function limitWords(text: string, maxWords = MAX_ANSWER_WORDS): string {
    const trimmed = text.trim()
    if (!trimmed) return ''
    const words = trimmed.split(/\s+/)
    if (words.length <= maxWords) return trimmed
    return `${words.slice(0, maxWords).join(' ')}...`
}

function replaceTeoPronouns(text: string): string {
    return text
        .replace(/\b(?:he|she|him)\b/gi, 'Teo')
        .replace(/\bhis\b/gi, "Teo's")
        .replace(
            /\bher\s+(?=profile|work|research|projects?|papers?|background|experience|education|skills?|links?|LinkedIn|GitHub)\b/gi,
            "Teo's "
        )
        .replace(/\bher\b/gi, 'Teo')
}

function completeModelAnswer(text: string): string {
    const limited = replaceTeoPronouns(limitWords(text))
    if (!limited) return ''

    const ellipsized = limited.endsWith('...')
    const candidate = ellipsized ? limited.slice(0, -3).trim() : limited
    if (!ellipsized && /[.!?]$/.test(candidate)) return candidate

    const sentenceEnds = Array.from(candidate.matchAll(/[.!?](?=\s+[A-Z0-9"'(]|$)/g))
    // Index access rather than Array.prototype.at(): `.at()` is a runtime method
    // (not down-levelled by the compiler) and throws on older Safari/WebViews.
    const lastEnd = sentenceEnds[sentenceEnds.length - 1]
    if (lastEnd?.index !== undefined && lastEnd.index >= Math.min(30, candidate.length / 2)) {
        return candidate.slice(0, lastEnd.index + 1)
    }

    return `${candidate.replace(/[\s,;:~-]+$/, '')}.`
}

function limitChars(text: string, maxChars = MAX_MODEL_MESSAGE_CHARS): string {
    const trimmed = text.trim()
    if (trimmed.length <= maxChars) return trimmed
    return `${trimmed.slice(0, maxChars).replace(/\s+\S*$/, '')}...`
}

function compactPromptMode(mode: RuntimeMode): boolean {
    return mode.device === 'wasm'
}

function modelPromptMessages(history: Msg[], mode: RuntimeMode): WorkerChatMessage[] {
    const compact = compactPromptMode(mode)
    const maxMessages = compact ? COMPACT_MODEL_HISTORY_MESSAGES : MAX_MODEL_HISTORY_MESSAGES
    const maxChars = compact ? COMPACT_MODEL_MESSAGE_CHARS : MAX_MODEL_MESSAGE_CHARS
    const modelHistory = history.slice(-maxMessages).map(m => ({
        role: m.role,
        content: limitChars(m.content, maxChars),
    }))
    return [{ role: 'system', content: systemPrompt(compact) }, ...modelHistory]
}

function linkLine(labels: string[]): string {
    return labels
        .map(label => links.find(l => l.label.toLowerCase() === label.toLowerCase()))
        .filter(Boolean)
        .map(l => {
            if (!l) return ''
            if (l.href) return `${l.label}: ${l.href}`
            if (l.handle) return `${l.label}: ${l.handle}`
            return l.label
        })
        .join('\n')
}

function directAnswerFromProfile(question: string): string | null {
    const q = question.toLowerCase()
    if (/(online|link|social|contact|email|github|linkedin|scholar|where.*find)/.test(q)) {
        return [
            'You can find Teo through these public links:',
            linkLine(['LinkedIn', 'GitHub', 'Google Scholar', 'Email', 'Kaggle', 'Blog', 'Strava', 'YouTube']),
        ].join('\n')
    }
    if (/(sport|basketball|run|running|interest|hobby|like)/.test(q)) {
        return 'Teo likes traveling, running, basketball and other sports, research, and video games.'
    }
    if (/(school|education|degree|nyu|ucsb|university|college|gpa)/.test(q)) {
        return 'Teo earned an M.S. in Data Science from NYU and a B.S. from UC Santa Barbara, where Teo triple majored in Applied Mathematics, Statistics & Data Science, and Psychological & Brain Sciences.'
    }
    if (/(work|job|role|company|atpco|3victors|data scientist|career)/.test(q)) {
        return 'Teo is a Data Scientist at 3Victors / ATPCO, working on airline pricing and travel data with machine learning, agent systems, forecasting, and near-real-time data pipelines.'
    }
    if (/(skill|tech|stack|python|ml|machine learning|cloud|sql)/.test(q)) {
        return 'Teo works across machine learning, NLP, time series, causal inference, anomaly detection, Python, SQL, R, Java, C++, MATLAB, AWS, GCP, Docker, Django, and React.'
    }
    if (/(publication|paper|research|medical|imaging|crystallography)/.test(q)) {
        return 'Teo has co-authored peer-reviewed work in medical AI and crystallography, including HCC recurrence prediction, acute pancreatitis severity prediction from CT, and deep residual networks for crystallography.'
    }
    if (/(project|built|agent|legal|go|weiqi|katrain)/.test(q)) {
        return 'Selected projects include an agentic legal consultant for export-requirement analysis and Web-Katrain, a browser-based Go app with TensorFlow.js and custom Monte Carlo Tree Search.'
    }
    if (/(who|about|intro|teo|weicheng)/.test(q)) {
        return 'Teo Zeng, full name Weicheng Zeng, is a New York City area data scientist and machine-learning researcher. Teo works on airline pricing and travel data, has research experience in medical imaging AI, and likes travel, running, basketball, research, and games.'
    }
    return null
}

function fallbackProfileAnswer(): string {
    return `I can answer from Teo's public profile. Try asking about Teo's work, education, projects, skills, publications, interests, or where to find Teo online.`
}

function answerFromProfile(question: string): string {
    return directAnswerFromProfile(question) ?? fallbackProfileAnswer()
}

function errorText(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`
    return String(error)
}

function isChunkLoadFailure(error: unknown): boolean {
    return /ChunkLoadError|Loading chunk \d+ failed|failed to fetch dynamically imported module/i.test(errorText(error))
}

function fallbackAnswerForError(question: string, error: unknown): string {
    const answer = answerFromProfile(question)
    if (!isChunkLoadFailure(error)) return answer
    return `${answer}\n\nThe on-device model hit stale site assets. Refresh once to use the full local AI.`
}

// Some LFM2.5 variants (the "-Thinking" ones) stream a chain-of-thought inside
// <think>…</think> before the answer; plain instruct variants don't. Handle both:
// surface reasoning live (muted) when present, otherwise stream straight to the
// answer. Everything up to </think> is reasoning; everything after is the answer.
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
    // No closing tag yet. If a <think> block was opened it's still reasoning;
    // otherwise this is a non-thinking model and the text is the answer.
    if (raw.includes('<think>')) return { reasoning: clean(raw), answer: '' }
    return { reasoning: '', answer: clean(raw) }
}

const SUGGESTIONS = ['Who is Teo?', 'What sports does Teo like?', 'Where can I find Teo online?']

type Conversation = { id: string; messages: Msg[]; createdAt: number; updatedAt: number }
const uid = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
const createConversation = (messages: Msg[] = []): Conversation => {
    const now = Date.now()
    return { id: uid(), messages, createdAt: now, updatedAt: now }
}
// Title a conversation by its first user message (for the history list).
const convTitle = (c: Conversation) => c.messages.find(m => m.role === 'user')?.content.trim() || 'New chat'
const convPreview = (c: Conversation) => {
    for (let i = c.messages.length - 1; i >= 0; i--) {
        const msg = c.messages[i]
        const text = (msg.content || msg.reasoning || '').trim()
        if (text) return text
    }
    return 'No messages yet'
}

function normalizeStoredConversations(value: unknown): Conversation[] {
    if (!Array.isArray(value)) return []
    return value
        .map((raw: any) => {
            if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) return null
            const messages = raw.messages
                .map((m: any) => {
                    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
                        return null
                    }
                    return {
                        role: m.role,
                        content: m.content,
                        ...(typeof m.reasoning === 'string' ? { reasoning: m.reasoning } : {}),
                    } as Msg
                })
                .filter(Boolean) as Msg[]
            if (messages.length === 0) return null
            const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
            const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt
            return {
                id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
                messages,
                createdAt,
                updatedAt,
            } as Conversation
        })
        .filter(Boolean)
        .slice(-MAX_HISTORY_CONVERSATIONS) as Conversation[]
}

function readStoredHistory(): { conversations: Conversation[]; activeId: string } | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        const conversations = normalizeStoredConversations(parsed?.conversations)
        if (conversations.length === 0) return null
        const activeId =
            typeof parsed?.activeId === 'string' && conversations.some(c => c.id === parsed.activeId)
                ? parsed.activeId
                : conversations[conversations.length - 1].id
        return { conversations, activeId }
    } catch {
        return null
    }
}

export default function AskAI({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [runtime, setRuntime] = useState<RuntimeMode | false | null>(null) // null = unknown yet
    const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const [progress, setProgress] = useState('')
    // Multiple conversations: switching the active one never stops an in-flight
    // generation, since each turn streams into its conversation by id.
    const [conversations, setConversations] = useState<Conversation[]>(() => [createConversation()])
    const [activeId, setActiveId] = useState<string>(() => conversations[0].id)
    const [historyHydrated, setHistoryHydrated] = useState(false)
    const [streaming, setStreaming] = useState(false)
    // Which conversation is currently generating (null when idle). Only one runs
    // at a time because there's a single on-device engine.
    const [streamingId, setStreamingId] = useState<string | null>(null)
    const [showHistory, setShowHistory] = useState(false)
    const [input, setInput] = useState('')

    const workerRef = useRef<Worker | null>(null)
    const generationRef = useRef<ActiveGeneration | null>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    // Whether to keep pinning to the bottom as new tokens stream. Flipped off when
    // the user scrolls up to read history mid-generation, back on when they return.
    const stickRef = useRef(true)

    const active = conversations.find(c => c.id === activeId)
    const messages = active?.messages ?? EMPTY_MESSAGES
    const hasHistory = conversations.some(c => c.messages.length > 0) || conversations.length > 1
    const historyConversations = useMemo(
        () =>
            [...conversations]
                .filter(c => c.messages.length > 0 || (hasHistory && c.id === activeId))
                .sort((a, b) => b.updatedAt - a.updatedAt),
        [activeId, conversations, hasHistory]
    )
    const setConvMessages = useCallback((id: string, msgs: Msg[]) => {
        setConversations(prev => prev.map(c => (c.id === id ? { ...c, messages: msgs, updatedAt: Date.now() } : c)))
    }, [])

    // During streaming we re-render every animation frame, so keep per-frame work
    // linear: a light clean only. The expensive sentence-boundary trimming in
    // `completeModelAnswer` (regex matchAll over the whole growing string) runs
    // once when the turn finalizes (`final`).
    const flushGeneration = useCallback(
        (generation: ActiveGeneration, final = false) => {
            const { reasoning, answer } = parseThinking(generation.raw)
            const content = final ? completeModelAnswer(answer) : replaceTeoPronouns(limitWords(answer))
            const message: Msg = { role: 'assistant', content }
            if (reasoning) message.reasoning = reasoning
            setConvMessages(generation.targetId, [...generation.history, message])
        },
        [setConvMessages]
    )

    const stopGeneration = useCallback(() => {
        const generation = generationRef.current
        if (!generation) return

        if (generation.frame !== null) window.cancelAnimationFrame(generation.frame)
        generation.frame = null

        // Tokens are already streaming: interrupt decoding but keep the worker (and
        // the loaded model) resident, so the next message skips a full reload. The
        // worker's `done` message then finalizes the partial answer through the
        // normal path, which also flips streaming off via `generation.resolve()`.
        if (generation.raw && workerRef.current) {
            workerRef.current.postMessage({ type: 'stop', id: generation.id })
            return
        }

        // Still downloading/initializing the model — that can't be interrupted, so
        // tear the worker down. Cached weights persist, so the next load resumes.
        const { answer } = parseThinking(generation.raw)
        setConvMessages(generation.targetId, [
            ...generation.history,
            { role: 'assistant', content: limitWords(answer) || 'Stopped.' },
        ])
        generationRef.current = null
        workerRef.current?.terminate()
        workerRef.current = null
        setProgress('')
        setStatus('ready')
        setStreaming(false)
        setStreamingId(null)
        generation.resolve()
        inputRef.current?.focus()
    }, [setConvMessages])

    const failActiveGeneration = useCallback((message: string) => {
        const generation = generationRef.current
        if (generation && generation.frame !== null) window.cancelAnimationFrame(generation.frame)
        generationRef.current = null
        generation?.reject(new Error(message))
    }, [])

    const getWorker = useCallback((): Worker | null => {
        if (workerRef.current) return workerRef.current

        let worker: Worker
        try {
            // Module workers are unsupported on older Safari/Firefox/WebViews;
            // construction can throw there. Callers treat null as "no on-device
            // runtime" and degrade to the instant responder.
            worker = new Worker(new URL('./AskAI.worker.ts', import.meta.url), { type: 'module' })
        } catch {
            return null
        }
        worker.onmessage = (event: MessageEvent<AskAIWorkerMessage>) => {
            const message = event.data

            if (message.type === 'progress') {
                setStatus('loading')
                setProgress(message.progress)
                return
            }

            if (message.type === 'fallback') {
                setRuntime(message.mode)
                setStatus('loading')
                setProgress(message.progress)
                return
            }

            if (message.type === 'ready') {
                setRuntime(message.mode)
                setStatus('ready')
                setProgress('')
                return
            }

            if (message.type === 'chunk') {
                const generation = generationRef.current
                if (!generation || generation.id !== message.id) return

                generation.raw += message.chunk
                if (generation.frame === null) {
                    generation.frame = window.requestAnimationFrame(() => {
                        generation.frame = null
                        if (generationRef.current?.id === generation.id) flushGeneration(generation)
                    })
                }
                return
            }

            if (message.type === 'done') {
                const generation = generationRef.current
                if (!generation || generation.id !== message.id) return

                if (generation.frame !== null) window.cancelAnimationFrame(generation.frame)
                generation.frame = null
                flushGeneration(generation, true)
                generationRef.current = null
                setStatus('ready')
                setProgress('')
                generation.resolve()
                return
            }

            if (message.type === 'error') {
                const generation = generationRef.current
                if (generation && (!message.id || generation.id === message.id)) {
                    if (generation.frame !== null) window.cancelAnimationFrame(generation.frame)
                    generationRef.current = null
                    generation.reject(new Error(message.message))
                }
                setStatus('error')
                setProgress('')
            }
        }
        worker.onerror = event => {
            // A worker-script-level failure means this worker is dead — tear it down
            // so the next send doesn't reuse a hung instance.
            setProgress('')
            worker.terminate()
            if (workerRef.current === worker) workerRef.current = null
            if (generationRef.current) {
                // An in-flight turn: reject so `send` falls back to an instant answer.
                setStatus('error')
                failActiveGeneration(event.message || 'Ask AI worker failed.')
                return
            }
            // No active turn (e.g. prewarm) and the model can't run here at all —
            // degrade to the instant responder instead of showing a stuck panel.
            setRuntime(INSTANT_MODE)
            setStatus('ready')
        }
        workerRef.current = worker
        return worker
    }, [failActiveGeneration, flushGeneration])

    // Hydrate saved conversations after mount so localStorage never participates
    // in server/client markup.
    useEffect(() => {
        const saved = readStoredHistory()
        if (saved) {
            setConversations(saved.conversations)
            setActiveId(saved.activeId)
        }
        setHistoryHydrated(true)
    }, [])

    useEffect(() => {
        if (!historyHydrated || typeof window === 'undefined') return
        const handle = window.setTimeout(() => {
            const saved = conversations.filter(c => c.messages.length > 0).slice(-MAX_HISTORY_CONVERSATIONS)
            if (saved.length === 0) {
                window.localStorage.removeItem(HISTORY_STORAGE_KEY)
                return
            }
            const savedActiveId = saved.some(c => c.id === activeId) ? activeId : saved[saved.length - 1].id
            window.localStorage.setItem(
                HISTORY_STORAGE_KEY,
                JSON.stringify({ conversations: saved, activeId: savedActiveId })
            )
        }, 250)
        return () => window.clearTimeout(handle)
    }, [activeId, conversations, historyHydrated])

    useEffect(() => {
        return () => {
            const generation = generationRef.current
            if (generation && generation.frame !== null) window.cancelAnimationFrame(generation.frame)
            workerRef.current?.terminate()
            workerRef.current = null
            generationRef.current = null
        }
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return

        const onChunkLoadFailure = (event: PromiseRejectionEvent) => {
            if (!isChunkLoadFailure(event.reason)) return
            event.preventDefault()
            setRuntime(INSTANT_MODE)
            setStatus('ready')
            setProgress('')
        }

        window.addEventListener('unhandledrejection', onChunkLoadFailure)
        return () => window.removeEventListener('unhandledrejection', onChunkLoadFailure)
    }, [])

    useEffect(() => {
        if (!open || typeof window === 'undefined') return
        const revealPanel = () => {
            const panel = panelRef.current
            if (!panel) return
            const rect = panel.getBoundingClientRect()
            const margin = 12
            const overflowBottom = rect.bottom - window.innerHeight + margin
            const overflowTop = rect.top - margin
            const top = overflowBottom > 0 ? overflowBottom : overflowTop < 0 ? overflowTop : 0

            if (Math.abs(top) > 1) {
                const scrollRoot = document.scrollingElement || document.documentElement
                const nextTop = scrollRoot.scrollTop + top
                scrollRoot.scrollTop = nextTop
                window.scrollTo(0, nextTop)
            }
        }
        const handles = [120, 360, 700].map(delay => window.setTimeout(revealPanel, delay))
        return () => handles.forEach(handle => window.clearTimeout(handle))
    }, [open])

    // Probe the best available runtime the first time the panel opens.
    useEffect(() => {
        if (!open || runtime !== null) return
        let alive = true
        detectRuntime()
            .then(nextRuntime => alive && setRuntime(nextRuntime))
            .catch(() => alive && setRuntime(INSTANT_MODE))
        return () => {
            alive = false
        }
    }, [open, runtime])

    // Once a model runtime is known, warm the worker + weights in the background so
    // the *first* question skips cold-start (download + ONNX session init). Opening
    // the panel is strong intent; the model is cached after the first load anyway.
    // Skipped for the instant (no-model) path and when a worker already exists.
    useEffect(() => {
        if (!open || !runtime || runtime.device === 'instant') return
        if (workerRef.current || status === 'error') return
        const worker = getWorker()
        // No worker support → on-device model can't run; fall back to instant.
        if (worker) worker.postMessage({ type: 'warm', mode: runtime })
        else setRuntime(INSTANT_MODE)
    }, [open, runtime, status, getWorker])

    const onScroll = () => {
        const el = scrollRef.current
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    }

    // Follow the latest tokens only while the user is parked at the bottom, so
    // scrolling up to read earlier messages isn't yanked back during generation.
    useEffect(() => {
        if (!showHistory && stickRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages, progress, showHistory])

    const send = useCallback(
        async (text: string) => {
            const q = text.trim()
            if (!q || streaming) return
            // Stream into the conversation that's active *now*; switching away later
            // won't redirect or stop it, since we update strictly by this id.
            const targetId = activeId
            const base = conversations.find(c => c.id === targetId)?.messages ?? []
            const history = [...base, { role: 'user' as Role, content: q }]
            setInput('')

            setConvMessages(targetId, [...history, { role: 'assistant', content: '' }])
            setStreaming(true)
            setStreamingId(targetId)
            stickRef.current = true // new turn: follow the stream until the user scrolls
            try {
                if (runtime === null) {
                    setStatus('loading')
                    setProgress('Checking on-device runtime...')
                }
                const mode = runtime === null ? await detectRuntime() : runtime
                if (!mode) throw new Error('No supported in-browser ML runtime found.')
                setRuntime(mode)
                if (mode.device === 'instant') {
                    setStatus('ready')
                    setProgress('')
                    setConvMessages(targetId, [
                        ...history,
                        { role: 'assistant', content: limitWords(answerFromProfile(q)) },
                    ])
                    return
                }
                // Only show the spin-up state when a worker actually has to be
                // created. When it's already warm (prewarmed on open, or kept alive
                // after a graceful stop), skip the flash and stream straight away —
                // the worker still posts its own progress if weights are mid-load.
                if (!workerRef.current) {
                    setStatus('loading')
                    setProgress(`${mode.label}: starting worker...`)
                }

                const worker = getWorker()
                // Browser can't run a worker → answer from the profile responder.
                if (!worker) throw new Error('Web Workers are unavailable in this browser.')
                const id = uid()
                const promptMessages = modelPromptMessages(history, mode)

                await new Promise<void>((resolve, reject) => {
                    generationRef.current = {
                        id,
                        targetId,
                        history,
                        raw: '',
                        frame: null,
                        resolve,
                        reject,
                    }
                    worker.postMessage({ type: 'generate', id, mode, messages: promptMessages })
                })
            } catch (error) {
                setRuntime(INSTANT_MODE)
                setStatus('ready')
                setProgress('')
                setConvMessages(targetId, [
                    ...history,
                    { role: 'assistant', content: limitWords(fallbackAnswerForError(q, error)) },
                ])
            } finally {
                setStreaming(false)
                setStreamingId(null)
                inputRef.current?.focus()
            }
        },
        [activeId, conversations, getWorker, runtime, setConvMessages, streaming]
    )

    // Open a fresh conversation (reusing an existing empty one if there is one).
    // Allowed even mid-generation — the running chat keeps streaming in the list.
    const newChat = useCallback(() => {
        setShowHistory(false)
        setInput('')
        if (status === 'error') setStatus(workerRef.current && runtime ? 'ready' : 'idle')
        const empty = conversations.find(c => c.messages.length === 0)
        if (empty) {
            setActiveId(empty.id)
        } else {
            const next = createConversation()
            setConversations(prev => [...prev, next])
            setActiveId(next.id)
        }
        inputRef.current?.focus()
    }, [conversations, runtime, status])

    const openConversation = (id: string) => {
        setActiveId(id)
        setShowHistory(false)
        stickRef.current = true
    }

    return (
        <div
            aria-hidden={!open}
            className={`ask-ai-shell grid transition-all duration-300 ease-out motion-reduce:transition-none ${
                open ? 'mt-3 grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
            } ${open ? 'ask-ai-shell-open' : ''}`}
        >
            <div className="ask-ai-clip min-h-0 overflow-hidden">
                <div
                    ref={panelRef}
                    className="ask-ai-panel relative flex flex-col rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
                >
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
                                <span className="text-slate-400 dark:text-slate-500">
                                    {' '}
                                    · {runtime ? runtime.label : 'private'}, on-device
                                </span>
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            {hasHistory && (
                                <button
                                    type="button"
                                    onClick={() => setShowHistory(h => !h)}
                                    aria-label={showHistory ? 'Back to chat' : 'Chat history'}
                                    aria-pressed={showHistory}
                                    title="Chat history"
                                    tabIndex={open ? 0 : -1}
                                    className={`flex items-center gap-1 rounded px-1.5 py-1 text-[13px] transition ${
                                        showHistory
                                            ? 'text-slate-700 dark:text-slate-200'
                                            : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                                    }`}
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
                                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                                        <path d="M3 3v5h5M12 7v5l3 2" />
                                    </svg>
                                    History
                                    {streaming && (
                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                                    )}
                                </button>
                            )}
                            {(messages.length > 0 || showHistory) && (
                                <button
                                    type="button"
                                    onClick={newChat}
                                    aria-label="Start a new chat"
                                    title="New chat"
                                    tabIndex={open ? 0 : -1}
                                    className="flex items-center gap-1 rounded px-1.5 py-1 text-[13px] text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
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
                        {showHistory ? (
                            <ul className="space-y-1">
                                {historyConversations.map(c => (
                                    <li key={c.id}>
                                        <button
                                            type="button"
                                            onClick={() => openConversation(c.id)}
                                            tabIndex={open ? 0 : -1}
                                            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] transition ${
                                                c.id === activeId
                                                    ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60'
                                            }`}
                                        >
                                            {streamingId === c.id ? (
                                                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                                            ) : (
                                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                                            )}
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium">{convTitle(c)}</span>
                                                <span className="block truncate text-[12px] text-slate-400 dark:text-slate-500">
                                                    {streamingId === c.id ? 'Running…' : convPreview(c)}
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : runtime === false ? (
                            <p className="text-slate-500 dark:text-slate-400">
                                This runs a language model directly in your browser, but this device does not expose a
                                compatible WebGPU or WebAssembly runtime.
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
                    {runtime !== false && !showHistory && (
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
                                placeholder={
                                    streaming
                                        ? streamingId === activeId
                                            ? 'Thinking…'
                                            : 'Busy in another chat…'
                                        : `Ask about ${profile.name.split(' ')[0]}…`
                                }
                                disabled={streaming}
                                spellCheck={false}
                                enterKeyHint="send"
                                aria-label="Ask AI input"
                                tabIndex={open ? 0 : -1}
                                className="flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-slate-100"
                            />
                            {streaming ? (
                                <button
                                    type="button"
                                    onClick={stopGeneration}
                                    aria-label="Stop generation"
                                    title="Stop generation"
                                    tabIndex={open ? 0 : -1}
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose-500 text-white transition hover:bg-rose-600 dark:bg-rose-400 dark:text-rose-950 dark:hover:bg-rose-300"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="currentColor">
                                        <rect x="7" y="7" width="10" height="10" rx="1.5" />
                                    </svg>
                                </button>
                            ) : (
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
                            )}
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
