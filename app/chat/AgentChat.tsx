'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { profile, links } from '../data/profile'
import type { Source } from '../data/knowledge'
import type { Engine } from './engines'
import { visionEngines, VISION_LAB_TASKS, STT_ENGINES, type VisionLabTask } from './engines'
import { webgpuAvailable, webgpuHelpHint } from '../lib/webgpu'
import { generate, warm, disposeModel, type ChatMessage } from './agent/runtime'
import { describeImage, disposeVisionModel } from './agent/vision'
import { generateImage, disposeImageGen } from './agent/imagegen'
import { runImageOp, disposePixelOps } from './agent/pixelops'
import { ingestDoc, searchDoc, type IngestedDoc } from './agent/docs'
import { transcribe, speak, playPcm, warmSpeech, disposeSpeech } from './agent/speech'
import { connectMcp, disconnectMcp, callMcpTool, type McpTool } from './agent/mcp'
import { groundingWithSources, warmIndex } from './agent/retrieval'
import { warmEmbedder } from './agent/embeddings'
import { runAgent } from './agent/graph'
import { availableTools, type Tool, type ToolContext } from './agent/tools'
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
// Messages are multi-part (frontier-style content blocks): text plus an optional
// attached image (data URL) shown as a thumbnail, plus citation sources.
type Msg = { role: Role; content: string; sources?: Source[]; image?: string }

const SUGGESTIONS = ['What does Teo work on?', 'Where did Teo study?', 'Open Teo’s GitHub']

// The vision model used for image turns — the lightest VLM (~1.2 GB) so swapping
// in for an image question and back out stays affordable on-device.
const VISION_ENGINE = visionEngines().find(e => e.id === 'lfm2-vl-1.6b') ?? visionEngines()[0]
const DESCRIBE_FALLBACK = 'Describe this image in detail.'

// The final answer streams with the cap effectively lifted — a large ceiling so
// long replies (listing projects, blog topics, publications) aren't truncated
// mid-sentence. It's still bounded by the model's context window, the EOS token,
// the Stop button, and the worker's idle watchdog, so generation can't run away.
// Planning turns (json) keep the small per-engine default.
const ANSWER_MAX_TOKENS = 4096

// Render assistant markdown with links that open safely in a new tab.
const MD_COMPONENTS = {
    a: (props: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
}

// One big model resident at a time: before running a heavy model, free the others'
// VRAM. The text LLM, VLM, SD-Turbo and pixel models each exceed what a typical
// GPU holds together, so they swap (reloading from the browser cache on demand).
type BigModel = 'text' | 'vision' | 'imagegen' | 'pixel' | 'none'
function freeBigModelsExcept(keep: BigModel) {
    if (keep !== 'text') disposeModel()
    if (keep !== 'vision') disposeVisionModel()
    if (keep !== 'imagegen') disposeImageGen()
    if (keep !== 'pixel') disposePixelOps()
}

// Image-op buttons offered on an attached image (besides "Ask", which uses the VLM).
const IMAGE_OPS: { task: VisionLabTask; label: string }[] = VISION_LAB_TASKS.map(t => ({
    task: t.id,
    label: t.label,
}))

// The assistant's persona. The base rules are constant; only the voice changes
// with the selected tone (picked from the ⋯ menu). Multilingual is automatic — the
// model always replies in the visitor's own language. Grounding (semantic RAG) and
// tool observations are appended by the agent graph's respond node.
type Tone = 'default' | 'recruiter' | 'researcher' | 'casual'
const TONES: { id: Tone; label: string; line: string }[] = [
    { id: 'default', label: 'Default', line: 'Answer concisely and warmly, in one or two short sentences.' },
    {
        id: 'recruiter',
        label: 'Recruiter',
        line: 'You are addressing a recruiter or hiring manager: lead with impact, skills and concrete results; stay concise and professional.',
    },
    {
        id: 'researcher',
        label: 'Researcher',
        line: 'You are addressing a fellow researcher: emphasize publications, methods and technical depth; be precise.',
    },
    { id: 'casual', label: 'Casual', line: 'Keep it friendly and casual, like chatting with a curious visitor.' },
]

function buildPersona(tone: Tone): string {
    const t = TONES.find(x => x.id === tone) ?? TONES[0]
    return [
        `You are a helpful assistant embedded on ${profile.name}'s personal website.`,
        t.line,
        `Refer to him as Teo, never he/him/his/she/her.`,
        `Reply in the same language the visitor writes in.`,
        `Only use the provided context; if you don't know, say so rather than inventing.`,
    ].join('\n')
}

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
    // Composer "+" attachments. An image is consumed by the next turn (routed to a
    // VLM); a document stays active and grounds answers until removed.
    const [plusOpen, setPlusOpen] = useState(false)
    const [pendingImage, setPendingImage] = useState<string | null>(null)
    const [docInfo, setDocInfo] = useState<{ name: string; chunks: number } | null>(null)
    const [docStatus, setDocStatus] = useState('')
    // Generate-image mode (the next send paints an image instead of chatting).
    const [genMode, setGenMode] = useState(false)
    // Voice: dictation (mic) + speak-answers (Kokoro TTS).
    const [listening, setListening] = useState(false)
    const [speakAnswers, setSpeakAnswers] = useState(false)
    // Overflow (⋯) menu + tone preset, kept out of the main view.
    const [menuOpen, setMenuOpen] = useState(false)
    const [tone, setTone] = useState<Tone>('default')
    const menuRef = useRef<HTMLDivElement | null>(null)
    // MCP: a connected server's tools are merged into the agent's toolset.
    const [mcpOpen, setMcpOpen] = useState(false)
    const [mcpUrl, setMcpUrl] = useState('https://mcp.deepwiki.com/mcp')
    const [mcpTools, setMcpTools] = useState<McpTool[]>([])
    const [mcpStatus, setMcpStatus] = useState('')
    const docRef = useRef<IngestedDoc | null>(null)
    const mcpToolsRef = useRef<McpTool[]>([])
    const speakRef = useRef(false)
    const vadRef = useRef<any>(null)
    const imageInputRef = useRef<HTMLInputElement | null>(null)
    const docInputRef = useRef<HTMLInputElement | null>(null)
    const plusRef = useRef<HTMLDivElement | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    speakRef.current = speakAnswers
    // Sources behind the grounding for the in-flight turn — captured in the
    // grounding closure, attached to the assistant message once the turn settles.
    const turnSources = useRef<Source[]>([])
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
            // Leaving the chat tab: free every runtime's GPU memory (they reload from
            // the browser cache on return — no re-download).
            disposeModel()
            disposeVisionModel()
            disposeImageGen()
            disposePixelOps()
            disposeSpeech()
            try {
                vadRef.current?.pause?.()
                void vadRef.current?.destroy?.()
            } catch {
                /* already gone */
            }
        }
    }, [engine])

    // Close the "+" / "⋯" menus on an outside click.
    useEffect(() => {
        if (!plusOpen && !menuOpen) return
        const onDoc = (e: MouseEvent) => {
            if (plusOpen && plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false)
            if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
    }, [plusOpen, menuOpen])

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

    // Read a chosen image file into a data URL and stage it for the next turn.
    const onImageFile = useCallback((file: File | undefined) => {
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => setPendingImage(String(reader.result))
        reader.readAsDataURL(file)
        setPlusOpen(false)
    }, [])

    // Parse + embed a document into an ephemeral store that grounds later answers.
    const onDocFile = useCallback(async (file: File | undefined) => {
        if (!file) return
        setPlusOpen(false)
        setDocStatus(`Reading ${file.name}…`)
        try {
            const doc = await ingestDoc(file)
            docRef.current = doc
            setDocInfo({ name: doc.name, chunks: doc.chunks })
            setDocStatus('')
        } catch (e) {
            docRef.current = null
            setDocInfo(null)
            setDocStatus(e instanceof Error ? e.message : 'Could not read that document.')
        }
    }, [])

    const removeImage = useCallback(() => setPendingImage(null), [])
    const removeDoc = useCallback(() => {
        docRef.current = null
        setDocInfo(null)
        setDocStatus('')
    }, [])

    // Speak text with Kokoro (best-effort; never breaks a turn).
    const speakText = useCallback(async (text: string) => {
        try {
            warmSpeech(STT_ENGINES[0].id)
            const { audio, samplingRate } = await speak(text)
            await playPcm(audio, samplingRate)
        } catch {
            /* TTS is optional */
        }
    }, [])

    // Wrap any connected MCP server's tools as agent tools the planner can call.
    const mcpAgentTools = useCallback(
        (): Tool[] =>
            mcpToolsRef.current.map(t => ({
                name: t.name,
                description: t.description || `MCP tool ${t.name}`,
                parameters: Object.fromEntries(
                    Object.entries((t.inputSchema?.properties ?? {}) as Record<string, any>).map(([k, v]) => [
                        k,
                        String(v?.description ?? v?.type ?? 'value'),
                    ])
                ),
                run: async (args: Record<string, any>) => callMcpTool(t.name, args),
            })),
        []
    )

    const send = useCallback(
        async (text: string) => {
            const query = text.trim()
            const image = pendingImage
            if ((!query && !image) || streaming || gpu !== 'ready') return
            setInput('')
            setProgress('')
            setPendingImage(null)
            turnSources.current = []

            const priorHistory = messages.map(m => ({ role: m.role, content: m.content } as ChatMessage))
            const userMsg: Msg = { role: 'user', content: query || (image ? '(image)' : ''), image: image ?? undefined }
            setMessages([...messages, userMsg, { role: 'assistant', content: '' }])
            setStreaming(true)

            const controller = new AbortController()
            abortRef.current = controller
            const assistantIndex = messages.length + 1

            let answerText = ''
            const appendToAnswer = (chunk: string) =>
                setMessages(prev => {
                    const next = prev.slice()
                    const cur = next[assistantIndex]
                    if (cur && cur.role === 'assistant') next[assistantIndex] = { ...cur, content: cur.content + chunk }
                    return next
                })
            const onAnswerChunk = (chunk: string) => {
                setProgress('')
                answerText += chunk
                appendToAnswer(chunk)
            }
            const setAnswerImage = (url: string) =>
                setMessages(prev => {
                    const next = prev.slice()
                    const cur = next[assistantIndex]
                    if (cur && cur.role === 'assistant') next[assistantIndex] = { ...cur, image: url }
                    return next
                })

            try {
                // ── Generate-image turn → SD-Turbo paints into the thread ─────────
                if (genMode && query && !image) {
                    setProgress('Loading image generator…')
                    freeBigModelsExcept('imagegen')
                    const url = await generateImage(query, { signal: controller.signal, onProgress: setProgress })
                    setAnswerImage(url)
                    appendToAnswer('Generated on-device with SD-Turbo.')
                    return
                }

                // ── Image turn → on-device VLM (free the other big models first) ──
                if (image) {
                    setProgress('Loading vision model…')
                    freeBigModelsExcept('vision')
                    await describeImage(VISION_ENGINE, image, query || DESCRIBE_FALLBACK, {
                        signal: controller.signal,
                        onProgress: setProgress,
                        onReady: () => setProgress(''),
                        onChunk: onAnswerChunk,
                    })
                    if (speakRef.current && answerText.trim()) await speakText(answerText)
                    return
                }

                // ── Text turn → the agent graph (free the other big models first) ─
                freeBigModelsExcept('text')
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
                            json: opts?.json,
                            // Lift the cap for the answer stream; planning (json) keeps the default.
                            maxNewTokens: opts?.json ? undefined : ANSWER_MAX_TOKENS,
                        }),
                    // Profile/action tools plus any connected MCP server's tools.
                    tools: [...availableTools(toolContext), ...mcpAgentTools()],
                    ctx: toolContext,
                    persona: buildPersona(tone),
                    // Grounding = profile RAG + attached-document excerpts + memory.
                    grounding: async q => {
                        const doc = docRef.current
                        const [{ text: facts, sources }, mems, docExcerpts] = await Promise.all([
                            groundingWithSources(q, 5),
                            recallMemory(q, 3),
                            doc ? searchDoc(doc.store, q, 4) : Promise.resolve<string[]>([]),
                        ])
                        turnSources.current = sources
                        const parts: string[] = []
                        if (docExcerpts.length) {
                            parts.push(
                                `From the attached document "${doc!.name}":\n${docExcerpts
                                    .map(e => `- ${e}`)
                                    .join('\n')}`
                            )
                        }
                        parts.push(facts)
                        if (mems.length) {
                            parts.push(`What you remember about the visitor:\n${mems.map(m => `- ${m}`).join('\n')}`)
                        }
                        return parts.join('\n\n')
                    },
                    history: priorHistory,
                    input: query,
                    threadId: threadId.current,
                    onToolEvent: e => setProgress(`Using ${e.name}…`),
                    onChunk: onAnswerChunk,
                })
                // Turn settled cleanly — attach the grounding's sources as citations.
                if (turnSources.current.length) {
                    setMessages(prev => {
                        const next = prev.slice()
                        const cur = next[assistantIndex]
                        if (cur && cur.role === 'assistant')
                            next[assistantIndex] = { ...cur, sources: turnSources.current }
                        return next
                    })
                }
                if (speakRef.current && answerText.trim()) await speakText(answerText)
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
        [engine, gpu, messages, streaming, toolContext, pendingImage, genMode, tone, mcpAgentTools, speakText]
    )

    const stop = useCallback(() => {
        abortRef.current?.abort()
    }, [])

    // Run a pixel op (background removal / depth / detection) on the attached image,
    // dropping the result straight into the thread.
    const runOp = useCallback(
        async (task: VisionLabTask, label: string) => {
            const image = pendingImage
            if (!image || streaming || gpu !== 'ready') return
            setPendingImage(null)
            setProgress('')
            const userMsg: Msg = { role: 'user', content: label, image }
            setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '' }])
            setStreaming(true)
            const controller = new AbortController()
            abortRef.current = controller
            const assistantIndex = messages.length + 1
            try {
                setProgress(`Loading ${label.toLowerCase()} model…`)
                freeBigModelsExcept('pixel')
                const url = await runImageOp(task, image, { signal: controller.signal, onProgress: setProgress })
                setMessages(prev => {
                    const next = prev.slice()
                    const cur = next[assistantIndex]
                    if (cur && cur.role === 'assistant')
                        next[assistantIndex] = { ...cur, content: `${label}:`, image: url }
                    return next
                })
            } catch (error) {
                setMessages(prev => {
                    const next = prev.slice()
                    const cur = next[assistantIndex]
                    const message = error instanceof Error ? error.message : 'Image op failed.'
                    if (cur && cur.role === 'assistant' && !cur.content)
                        next[assistantIndex] = { ...cur, content: `Error: ${message}` }
                    return next
                })
            } finally {
                setStreaming(false)
                setProgress('')
                abortRef.current = null
            }
        },
        [pendingImage, streaming, gpu, messages]
    )

    // Push-to-talk dictation: one utterance → Whisper → sent as a turn.
    const toggleMic = useCallback(async () => {
        if (listening) {
            try {
                vadRef.current?.pause?.()
            } catch {
                /* already paused */
            }
            setListening(false)
            setProgress('')
            return
        }
        setListening(true)
        setProgress('Starting microphone…')
        try {
            warmSpeech(STT_ENGINES[0].id)
            if (!vadRef.current) {
                const { MicVAD } = await import('@ricky0123/vad-web')
                vadRef.current = await MicVAD.new({
                    model: 'v5',
                    onSpeechEnd: (audio: Float32Array) => {
                        try {
                            vadRef.current?.pause?.()
                        } catch {
                            /* ignore */
                        }
                        setListening(false)
                        setProgress('Transcribing…')
                        void transcribe(audio, STT_ENGINES[0].id).then(textOut => {
                            setProgress('')
                            const t = textOut.trim()
                            if (t) void send(t)
                        })
                    },
                })
            }
            await vadRef.current.start()
            setProgress('Listening… speak, then pause')
        } catch (e) {
            setListening(false)
            setProgress('')
            setDocStatus(e instanceof Error ? e.message : 'Microphone unavailable.')
        }
    }, [listening, send])

    // Connect to an MCP server and merge its tools into the agent's toolset.
    const connectMcpServer = useCallback(async () => {
        const url = mcpUrl.trim()
        if (!url) return
        setMcpStatus('Connecting…')
        try {
            const tools = await connectMcp(url)
            mcpToolsRef.current = tools
            setMcpTools(tools)
            setMcpStatus('')
            setMcpOpen(false)
            setPlusOpen(false)
        } catch (e) {
            setMcpStatus(e instanceof Error ? e.message : 'Could not connect.')
        }
    }, [mcpUrl])

    const disconnectMcpServer = useCallback(() => {
        void disconnectMcp()
        mcpToolsRef.current = []
        setMcpTools([])
        setMcpStatus('')
    }, [])

    const newChat = useCallback(() => {
        if (streaming) abortRef.current?.abort()
        setMessages([])
        setInput('')
        setProgress('')
        setPendingImage(null)
        removeDoc()
        setGenMode(false)
        setPlusOpen(false)
    }, [streaming, removeDoc])

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

    if (gpu === 'checking') {
        return (
            <div className="grid h-full place-items-center text-[13px] text-[var(--c-faint)]">Checking for WebGPU…</div>
        )
    }

    if (gpu === 'unavailable') {
        return (
            <div className="grid h-full place-items-center px-6">
                <div className="max-w-sm text-center">
                    <p className="text-[15px] font-medium text-[var(--c-text)]">WebGPU required</p>
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--c-muted)]">
                        This assistant runs frontier models entirely on your device — that needs WebGPU, which this
                        browser isn’t exposing.
                    </p>
                    <p className="mt-2 text-[12px] text-[var(--c-faint)]">{webgpuHelpHint()}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col">
            {/* Quiet top-right controls: new chat + a single ⋯ overflow menu. */}
            <div className="flex items-center justify-end gap-0.5 px-2 pt-2 sm:px-3">
                {!empty && (
                    <button
                        type="button"
                        onClick={newChat}
                        title="New chat"
                        aria-label="New chat"
                        className="grid h-8 w-8 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-soft)] hover:text-[var(--c-text)]"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            className="h-[18px] w-[18px]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            aria-hidden
                        >
                            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                        </svg>
                    </button>
                )}
                <div ref={menuRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setMenuOpen(o => !o)}
                        aria-expanded={menuOpen}
                        aria-label="More"
                        className="grid h-8 w-8 place-items-center rounded-lg text-[var(--c-muted)] transition hover:bg-[var(--c-soft)] hover:text-[var(--c-text)]"
                    >
                        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
                            <circle cx="5" cy="12" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="19" cy="12" r="1.6" />
                        </svg>
                    </button>
                    {menuOpen && (
                        <div className="absolute right-0 top-9 z-20 w-56 overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-panel)] py-1 text-[13.5px] shadow-lg">
                            <button
                                type="button"
                                onClick={() => setSpeakAnswers(s => !s)}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-[var(--c-text)] transition hover:bg-[var(--c-soft)]"
                            >
                                Speak answers
                                <span className="text-[var(--c-faint)]">{speakAnswers ? 'On' : 'Off'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowMemory(s => !s)
                                    setMenuOpen(false)
                                }}
                                className="flex w-full items-center justify-between px-3 py-2 text-left text-[var(--c-text)] transition hover:bg-[var(--c-soft)]"
                            >
                                Memory
                                <span className="text-[var(--c-faint)]">{memories.length || ''}</span>
                            </button>
                            {!empty && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        exportChat()
                                        setMenuOpen(false)
                                    }}
                                    className="flex w-full px-3 py-2 text-left text-[var(--c-text)] transition hover:bg-[var(--c-soft)]"
                                >
                                    Export transcript
                                </button>
                            )}
                            <div className="my-1 border-t border-[var(--c-border)]" />
                            <p className="px-3 pb-1 pt-1 text-[11px] uppercase tracking-wider text-[var(--c-faint)]">
                                Tone
                            </p>
                            {TONES.map(t => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => setTone(t.id)}
                                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[var(--c-text)] transition hover:bg-[var(--c-soft)]"
                                >
                                    {t.label}
                                    {tone === t.id && <span className="text-[var(--c-accent)]">✓</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {showMemory && (
                <div className="mx-auto mt-1 w-full max-w-3xl px-4 sm:px-6">
                    <div className="rounded-xl border border-[var(--c-border)] bg-[var(--c-panel)] px-3.5 py-3">
                        <div className="flex items-center justify-between">
                            <p className="text-[12px] text-[var(--c-muted)]">
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
                            <p className="mt-2 text-[13px] text-[var(--c-faint)]">
                                Nothing yet. Tell me about yourself and I’ll remember it next time.
                            </p>
                        ) : (
                            <ul className="mt-2 space-y-1">
                                {memories.map(m => (
                                    <li
                                        key={m.id}
                                        className="group flex items-start gap-2 rounded-lg bg-[var(--c-soft)] px-2.5 py-1.5 text-[13px] text-[var(--c-text)]"
                                    >
                                        <span className="min-w-0 flex-1">{m.text}</span>
                                        <button
                                            type="button"
                                            onClick={() => deleteMemory(m.id)}
                                            aria-label="Forget this"
                                            title="Forget this"
                                            className="shrink-0 text-[12px] text-[var(--c-faint)] opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                                        >
                                            Forget
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {/* Conversation */}
            <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto">
                {empty ? (
                    <div className="grid h-full place-items-center px-4">
                        <div className="w-full max-w-2xl text-center">
                            <h2 className="text-[22px] font-semibold tracking-tight text-[var(--c-text)] sm:text-[26px]">
                                Ask me anything about {firstName}
                            </h2>
                            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--c-muted)]">
                                Type or speak · attach an image or document · generate images · connect live tools — all
                                on-device via the <span className="text-[var(--c-text)]">+</span>.
                            </p>
                            <div className="mt-5 flex flex-wrap justify-center gap-2">
                                {SUGGESTIONS.map(s => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => send(s)}
                                        className="rounded-full border border-[var(--c-border)] bg-[var(--c-panel)] px-3.5 py-1.5 text-[13px] text-[var(--c-muted)] transition hover:border-[var(--c-accent)] hover:text-[var(--c-text)]"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="mx-auto max-w-3xl space-y-5 px-4 py-5 text-[15px] sm:px-6">
                        {messages.map((m, i) => {
                            const isLast = i === messages.length - 1
                            const showDots = m.role === 'assistant' && isLast && streaming && !m.content
                            if (m.role === 'user') {
                                return (
                                    <div key={i} className="flex flex-col items-end gap-1.5">
                                        {m.image && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={m.image}
                                                alt="Attached"
                                                className="max-h-56 max-w-[85%] rounded-2xl border border-[var(--c-border)] object-contain"
                                            />
                                        )}
                                        {m.content && m.content !== '(image)' && (
                                            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--c-soft)] px-4 py-2.5 text-[var(--c-text)]">
                                                {m.content}
                                            </div>
                                        )}
                                    </div>
                                )
                            }
                            return (
                                <div key={i} className="text-[var(--c-text)]">
                                    {showDots ? (
                                        <span className="inline-flex gap-1 text-[var(--c-faint)]">
                                            <span className="animate-bounce">•</span>
                                            <span className="animate-bounce [animation-delay:120ms]">•</span>
                                            <span className="animate-bounce [animation-delay:240ms]">•</span>
                                        </span>
                                    ) : (
                                        <>
                                            {m.content && (
                                                <div className="md">
                                                    <ReactMarkdown components={MD_COMPONENTS}>
                                                        {m.content}
                                                    </ReactMarkdown>
                                                </div>
                                            )}
                                            {m.image && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={m.image}
                                                    alt="Result"
                                                    className="mt-2 max-h-[420px] w-auto max-w-full rounded-xl border border-[var(--c-border)]"
                                                />
                                            )}
                                        </>
                                    )}
                                    {m.sources && m.sources.length > 0 && (
                                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                                            <span className="text-[11px] text-[var(--c-faint)]">Sources</span>
                                            {m.sources.map(s => (
                                                <a
                                                    key={s.url}
                                                    href={s.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="rounded-full border border-[var(--c-border)] bg-[var(--c-panel)] px-2 py-0.5 text-[11px] text-[var(--c-muted)] transition hover:border-[var(--c-accent)] hover:text-[var(--c-text)]"
                                                >
                                                    {s.label}
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                        {progress && <p className="text-[13px] text-[var(--c-faint)]">{progress}</p>}
                    </div>
                )}
            </div>

            {/* Composer */}
            <div className="px-3 pb-4 pt-2 sm:px-6">
                {/* Hidden file inputs driven by the + menu. */}
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                        onImageFile(e.target.files?.[0])
                        e.target.value = ''
                    }}
                />
                <input
                    ref={docInputRef}
                    type="file"
                    accept=".pdf,.txt,.md,text/plain,application/pdf"
                    className="hidden"
                    onChange={e => {
                        void onDocFile(e.target.files?.[0])
                        e.target.value = ''
                    }}
                />

                <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--c-border)] bg-[var(--c-panel)] px-3 py-2 shadow-sm transition focus-within:border-[var(--c-accent)]">
                    {/* Attachment chips + modes */}
                    {(pendingImage || docInfo || docStatus || genMode || mcpTools.length > 0 || mcpStatus) && (
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            {pendingImage && (
                                <>
                                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--c-soft)] py-1 pl-1 pr-2 text-[12px] text-[var(--c-text)]">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={pendingImage} alt="" className="h-7 w-7 rounded object-cover" />
                                        Image
                                        <button
                                            type="button"
                                            onClick={removeImage}
                                            aria-label="Remove image"
                                            className="text-[var(--c-faint)] transition hover:text-[var(--c-text)]"
                                        >
                                            ✕
                                        </button>
                                    </span>
                                    {IMAGE_OPS.map(op => (
                                        <button
                                            key={op.task}
                                            type="button"
                                            onClick={() => void runOp(op.task, op.label)}
                                            disabled={streaming}
                                            className="rounded-lg border border-[var(--c-border)] px-2 py-1 text-[12px] text-[var(--c-muted)] transition hover:border-[var(--c-accent)] hover:text-[var(--c-text)] disabled:opacity-40"
                                        >
                                            {op.label}
                                        </button>
                                    ))}
                                </>
                            )}
                            {docInfo && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--c-soft)] px-2 py-1 text-[12px] text-[var(--c-text)]">
                                    <span aria-hidden>📄</span>
                                    <span className="max-w-[14rem] truncate">{docInfo.name}</span>
                                    <span className="text-[var(--c-faint)]">· {docInfo.chunks} chunks</span>
                                    <button
                                        type="button"
                                        onClick={removeDoc}
                                        aria-label="Remove document"
                                        className="text-[var(--c-faint)] transition hover:text-[var(--c-text)]"
                                    >
                                        ✕
                                    </button>
                                </span>
                            )}
                            {genMode && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--c-accent-soft)] px-2 py-1 text-[12px] text-[var(--c-text)]">
                                    🎨 Generate image
                                    <button
                                        type="button"
                                        onClick={() => setGenMode(false)}
                                        aria-label="Exit image mode"
                                        className="text-[var(--c-faint)] transition hover:text-[var(--c-text)]"
                                    >
                                        ✕
                                    </button>
                                </span>
                            )}
                            {mcpTools.length > 0 && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--c-soft)] px-2 py-1 text-[12px] text-[var(--c-text)]">
                                    🛠 MCP · {mcpTools.length} tools
                                    <button
                                        type="button"
                                        onClick={disconnectMcpServer}
                                        aria-label="Disconnect MCP"
                                        className="text-[var(--c-faint)] transition hover:text-[var(--c-text)]"
                                    >
                                        ✕
                                    </button>
                                </span>
                            )}
                            {docStatus && <span className="text-[12px] text-[var(--c-muted)]">{docStatus}</span>}
                            {mcpStatus && <span className="text-[12px] text-rose-500">{mcpStatus}</span>}
                        </div>
                    )}

                    {/* MCP connect panel */}
                    {mcpOpen && (
                        <div className="mb-1.5 flex items-center gap-2">
                            <input
                                value={mcpUrl}
                                onChange={e => setMcpUrl(e.target.value)}
                                placeholder="https://…/mcp"
                                spellCheck={false}
                                className="flex-1 rounded-lg border border-[var(--c-border)] bg-transparent px-2.5 py-1.5 text-[13px] text-[var(--c-text)] outline-none placeholder:text-[var(--c-faint)] focus:border-[var(--c-accent)]"
                            />
                            <button
                                type="button"
                                onClick={() => void connectMcpServer()}
                                className="rounded-lg bg-[var(--c-accent)] px-3 py-1.5 text-[12px] text-[var(--c-accent-fg)] transition hover:opacity-90"
                            >
                                Connect
                            </button>
                            <button
                                type="button"
                                onClick={() => setMcpOpen(false)}
                                aria-label="Cancel"
                                className="px-1 text-[var(--c-faint)] transition hover:text-[var(--c-text)]"
                            >
                                ✕
                            </button>
                        </div>
                    )}

                    <form
                        onSubmit={e => {
                            e.preventDefault()
                            send(input)
                        }}
                        className="flex items-end gap-2"
                    >
                        {/* + menu */}
                        <div ref={plusRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setPlusOpen(o => !o)}
                                aria-label="Add attachment"
                                aria-expanded={plusOpen}
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[var(--c-muted)] transition hover:bg-[var(--c-soft)] hover:text-[var(--c-text)]"
                            >
                                <svg
                                    viewBox="0 0 24 24"
                                    className="h-5 w-5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    aria-hidden
                                >
                                    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                                </svg>
                            </button>
                            {plusOpen && (
                                <div className="absolute bottom-11 left-0 z-20 w-52 overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-panel)] py-1 shadow-lg">
                                    <button
                                        type="button"
                                        onClick={() => imageInputRef.current?.click()}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-[var(--c-text)] transition hover:bg-[var(--c-soft)]"
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            className="h-4 w-4 text-[var(--c-faint)]"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.7"
                                            aria-hidden
                                        >
                                            <rect x="3" y="3" width="18" height="18" rx="2" />
                                            <circle cx="8.5" cy="8.5" r="1.5" />
                                            <path d="M21 15l-5-5L5 21" />
                                        </svg>
                                        Attach image
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => docInputRef.current?.click()}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-[var(--c-text)] transition hover:bg-[var(--c-soft)]"
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            className="h-4 w-4 text-[var(--c-faint)]"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.7"
                                            aria-hidden
                                        >
                                            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                                            <path d="M14 3v5h5" />
                                        </svg>
                                        Attach document
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setGenMode(true)
                                            setPlusOpen(false)
                                        }}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-[var(--c-text)] transition hover:bg-[var(--c-soft)]"
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            className="h-4 w-4 text-[var(--c-faint)]"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.7"
                                            aria-hidden
                                        >
                                            <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
                                            <circle cx="12" cy="12" r="3.2" />
                                        </svg>
                                        Generate image
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setMcpOpen(true)
                                            setPlusOpen(false)
                                        }}
                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-[var(--c-text)] transition hover:bg-[var(--c-soft)]"
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            className="h-4 w-4 text-[var(--c-faint)]"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.7"
                                            aria-hidden
                                        >
                                            <path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6" />
                                        </svg>
                                        Connect tools (MCP)
                                    </button>
                                    <p className="px-3 pb-1 pt-1.5 text-[11px] text-[var(--c-faint)]">
                                        Image → vision · Doc → grounded · Generate → SD-Turbo · MCP → live tools
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Dictation */}
                        <button
                            type="button"
                            onClick={() => void toggleMic()}
                            aria-pressed={listening}
                            aria-label="Dictate"
                            title="Speak your question (on-device Whisper)"
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition ${
                                listening
                                    ? 'animate-pulse bg-rose-500 text-white'
                                    : 'text-[var(--c-muted)] hover:bg-[var(--c-soft)] hover:text-[var(--c-text)]'
                            }`}
                        >
                            <svg
                                viewBox="0 0 24 24"
                                className="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                aria-hidden
                            >
                                <rect x="9" y="3" width="6" height="11" rx="3" />
                                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                            </svg>
                        </button>

                        <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder={
                                streaming
                                    ? 'Thinking…'
                                    : genMode
                                    ? 'Describe an image to generate…'
                                    : pendingImage
                                    ? 'Ask about the image…'
                                    : docInfo
                                    ? `Ask about ${docInfo.name}…`
                                    : `Message ${firstName}’s assistant…`
                            }
                            disabled={streaming}
                            spellCheck={false}
                            enterKeyHint="send"
                            aria-label="Chat input"
                            className="flex-1 bg-transparent py-1.5 text-[15px] text-[var(--c-text)] outline-none placeholder:text-[var(--c-faint)] disabled:opacity-60"
                        />
                        {streaming ? (
                            <button
                                type="button"
                                onClick={stop}
                                aria-label="Stop generation"
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-500 text-white transition hover:bg-rose-600"
                            >
                                <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="currentColor">
                                    <rect x="7" y="7" width="10" height="10" rx="1.5" />
                                </svg>
                            </button>
                        ) : (
                            <button
                                type="submit"
                                disabled={!input.trim() && !pendingImage}
                                aria-label="Send"
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--c-accent)] text-[var(--c-accent-fg)] transition enabled:hover:opacity-90 disabled:opacity-40"
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
            </div>
        </div>
    )
}
