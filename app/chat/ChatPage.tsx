'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LMStudioClient, Chat, ChatMessage, tool, StructuredPredictionResult } from '@lmstudio/sdk'
import { z } from 'zod'

// ---- Types ----------------------------------------------------------------

type Role = 'user' | 'assistant' | 'system'
type Msg = {
    id: string
    role: Role
    content: string
    toolCalls?: { name: string; args: string; result?: string }[]
    stats?: { tokens: number; ttft: number; stopReason: string }
}
type Conversation = { id: string; title: string; messages: Msg[]; createdAt: number; updatedAt: number }
type ContextOverflowPolicy = 'stopAtLimit' | 'truncateMiddle' | 'rollingWindow'

interface LoadedModel {
    identifier: string
    path: string
    displayName?: string
}

interface Settings {
    temperature: number
    maxTokens: number | false
    contextOverflowPolicy: ContextOverflowPolicy
    draftModel: string
    useTools: boolean
    structuredMode: boolean
    structuredSchema: string
}

// ---- Tools ----------------------------------------------------------------

const calculatorTool = tool({
    name: 'calculator',
    description: 'Evaluate a mathematical expression. Use for arithmetic, percentages, and unit math.',
    parameters: { expression: z.string().describe('A math expression, e.g. "17% of 240" or "sqrt(144)"') },
    implementation: ({ expression }) => {
        try {
            const sanitized = expression
                .replace(/[^0-9+\-*/().%\s]/g, '')
                .replace(/(\d+)%\s*of\s*(\d+(?:\.\d+)?)/gi, '($1/100)*$2')
                .replace(/(\d+(?:\.\d+)?)%/g, '($1/100)')
            const result = Function('"use strict"; return (' + sanitized + ')')()
            return String(result)
        } catch {
            return 'Error: could not evaluate expression'
        }
    },
})

const unitConverterTool = tool({
    name: 'convert_units',
    description: 'Convert a value from one unit to another (distance, weight, temperature, volume, etc.).',
    parameters: {
        value: z.number().describe('The numeric value to convert'),
        from: z.string().describe('Source unit, e.g. "miles", "kg", "fahrenheit"'),
        to: z.string().describe('Target unit, e.g. "km", "lbs", "celsius"'),
    },
    implementation: ({ value, from, to }) => {
        const conversions: Record<string, Record<string, number>> = {
            // distance (base: meters)
            meters: {
                km: 0.001,
                miles: 0.000621371,
                feet: 3.28084,
                inches: 39.3701,
                yards: 1.09361,
                cm: 100,
                mm: 1000,
            },
            km: { meters: 1000, miles: 0.621371, feet: 3280.84, inches: 39370.1, yards: 1093.61, cm: 100000, mm: 1e6 },
            miles: { km: 1.60934, meters: 1609.34, feet: 5280, inches: 63360, yards: 1760 },
            feet: { meters: 0.3048, km: 0.0003048, miles: 0.000189394, inches: 12, yards: 0.333333, cm: 30.48 },
            inches: { feet: 0.0833333, meters: 0.0254, cm: 2.54, mm: 25.4, yards: 0.0277778, miles: 0.0000157828 },
            cm: { meters: 0.01, inches: 0.393701, feet: 0.0328084, mm: 10 },
            mm: { meters: 0.001, cm: 0.1, inches: 0.0393701 },
            // weight (base: kg)
            kg: { lbs: 2.20462, grams: 1000, oz: 35.274, stones: 0.157473 },
            lbs: { kg: 0.453592, grams: 453.592, oz: 16, stones: 0.0714286 },
            grams: { kg: 0.001, lbs: 0.00220462, oz: 0.035274 },
            oz: { grams: 28.3495, lbs: 0.0625, kg: 0.0283495 },
            stones: { kg: 6.35029, lbs: 14 },
            // volume (base: liters)
            liters: { ml: 1000, gallons: 0.264172, cups: 4.22675, pints: 2.11338, quarts: 1.05669, 'fl oz': 33.814 },
            ml: { liters: 0.001, cups: 0.00422675, gallons: 0.000264172, 'fl oz': 0.033814 },
            gallons: { liters: 3.78541, ml: 3785.41, cups: 16, pints: 8, quarts: 4, 'fl oz': 128 },
            cups: { liters: 0.236588, ml: 236.588, gallons: 0.0625, 'fl oz': 8 },
            // speed
            mph: { kph: 1.60934, ms: 0.44704, knots: 0.868976 },
            kph: { mph: 0.621371, ms: 0.277778, knots: 0.539957 },
            knots: { mph: 1.15078, kph: 1.852 },
        }

        const f = from.toLowerCase()
        const t = to.toLowerCase()

        if (f === 'fahrenheit' || f === 'f') {
            if (t === 'celsius' || t === 'c') return String(((value - 32) * 5) / 9)
            if (t === 'kelvin' || t === 'k') return String(((value - 32) * 5) / 9 + 273.15)
        }
        if (f === 'celsius' || f === 'c') {
            if (t === 'fahrenheit' || t === 'f') return String((value * 9) / 5 + 32)
            if (t === 'kelvin' || t === 'k') return String(value + 273.15)
        }
        if (f === 'kelvin' || f === 'k') {
            if (t === 'celsius' || t === 'c') return String(value - 273.15)
            if (t === 'fahrenheit' || t === 'f') return String(((value - 273.15) * 9) / 5 + 32)
        }

        if (f === t) return String(value)
        const row = conversions[f]
        if (row && row[t] !== undefined) return String(value * row[t])
        return `Unknown conversion: ${from} → ${to}`
    },
})

const base64Tool = tool({
    name: 'encode_decode',
    description: 'Base64 encode or decode a string, or URL encode/decode.',
    parameters: {
        text: z.string().describe('The string to process'),
        operation: z.enum(['base64_encode', 'base64_decode', 'url_encode', 'url_decode']),
    },
    implementation: ({ text, operation }) => {
        try {
            if (operation === 'base64_encode') return btoa(text)
            if (operation === 'base64_decode') return atob(text)
            if (operation === 'url_encode') return encodeURIComponent(text)
            if (operation === 'url_decode') return decodeURIComponent(text)
            return 'Unknown operation'
        } catch (e) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
    },
})

const jsonTool = tool({
    name: 'format_json',
    description: 'Parse, validate, and pretty-print a JSON string.',
    parameters: {
        json: z.string().describe('The JSON string to format'),
        indent: z.number().optional().describe('Indentation spaces (default 2)'),
    },
    implementation: ({ json, indent = 2 }) => {
        try {
            const parsed = JSON.parse(json)
            return JSON.stringify(parsed, null, indent)
        } catch (e) {
            return `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
        }
    },
})

const regexTool = tool({
    name: 'regex_test',
    description: 'Test a regular expression against text and return all matches.',
    parameters: {
        text: z.string().describe('The input text'),
        pattern: z.string().describe('The regex pattern'),
        flags: z.string().optional().describe('Regex flags, e.g. "gi"'),
    },
    implementation: ({ text, pattern, flags = 'g' }) => {
        try {
            const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
            const matches = Array.from(text.matchAll(re))
            if (matches.length === 0) return 'No matches found.'
            return matches.map(m => JSON.stringify({ match: m[0], groups: m.slice(1), index: m.index })).join('\n')
        } catch (e) {
            return `Regex error: ${e instanceof Error ? e.message : String(e)}`
        }
    },
})

const dateTimeTool = tool({
    name: 'date_time',
    description: 'Get current date/time or convert between timezones.',
    parameters: {
        timezone: z.string().optional().describe('IANA timezone name, e.g. "America/New_York". Defaults to local.'),
        format: z.enum(['iso', 'locale', 'unix']).optional().describe('Output format (default: iso)'),
    },
    implementation: ({ timezone, format = 'iso' }) => {
        try {
            const now = new Date()
            if (format === 'unix') return String(Math.floor(now.getTime() / 1000))
            if (format === 'locale') {
                return timezone ? now.toLocaleString('en-US', { timeZone: timezone }) : now.toLocaleString()
            }
            if (timezone) return now.toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T')
            return now.toISOString()
        } catch (e) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
    },
})

const ALL_TOOLS = [calculatorTool, unitConverterTool, base64Tool, jsonTool, regexTool, dateTimeTool]

// ---- Helpers ----------------------------------------------------------------

function genId() {
    return Math.random().toString(36).slice(2, 10)
}

function saveConvs(convs: Conversation[]) {
    try {
        localStorage.setItem('lms_conversations', JSON.stringify(convs))
    } catch {}
}

function loadConvs(): Conversation[] {
    try {
        const raw = localStorage.getItem('lms_conversations')
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function titleFromMsg(msg: string) {
    return msg.slice(0, 60).trim() || 'New conversation'
}

const DEFAULT_SETTINGS: Settings = {
    temperature: 0.7,
    maxTokens: false,
    contextOverflowPolicy: 'rollingWindow',
    draftModel: '',
    useTools: true,
    structuredMode: false,
    structuredSchema: '{"answer": "string"}',
}

// ---- Component ----------------------------------------------------------------

export default function ChatPage() {
    // Connection
    const [serverUrl, setServerUrl] = useState('ws://localhost:1234')
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')
    const [statusMsg, setStatusMsg] = useState('')
    const clientRef = useRef<LMStudioClient | null>(null)

    // Models
    const [loadedModels, setLoadedModels] = useState<LoadedModel[]>([])
    const [selectedModelId, setSelectedModelId] = useState('')
    const [loadingModels, setLoadingModels] = useState(false)

    // Conversations
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [activeConvId, setActiveConvId] = useState<string | null>(null)

    // UI state
    const [input, setInput] = useState('')
    const [streaming, setStreaming] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
    const [embeddingText, setEmbeddingText] = useState('')
    const [embeddingResult, setEmbeddingResult] = useState<string | null>(null)
    const [embeddingLoading, setEmbeddingLoading] = useState(false)

    const predictionRef = useRef<{ cancel: () => void } | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    const activeConv = conversations.find(c => c.id === activeConvId) ?? null

    // Load conversations on mount
    useEffect(() => {
        setConversations(loadConvs())
    }, [])

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [activeConv?.messages])

    // Connect to LM Studio
    const connect = useCallback(async () => {
        setStatus('connecting')
        setStatusMsg('Connecting…')
        try {
            const client = new LMStudioClient({ baseUrl: serverUrl })
            // Test connection by listing models
            const models = await client.llm.listLoaded()
            clientRef.current = client
            setLoadedModels(models as LoadedModel[])
            if (models.length > 0) setSelectedModelId((models[0] as LoadedModel).identifier)
            setStatus('connected')
            setStatusMsg(`${models.length} model${models.length !== 1 ? 's' : ''} loaded`)
        } catch (e) {
            setStatus('error')
            setStatusMsg(e instanceof Error ? e.message : 'Connection failed')
            clientRef.current = null
        }
    }, [serverUrl])

    const disconnect = useCallback(() => {
        clientRef.current = null
        setStatus('disconnected')
        setStatusMsg('')
        setLoadedModels([])
        setSelectedModelId('')
    }, [])

    const refreshModels = useCallback(async () => {
        if (!clientRef.current) return
        setLoadingModels(true)
        try {
            const models = await clientRef.current.llm.listLoaded()
            setLoadedModels(models as LoadedModel[])
            if (models.length > 0 && !selectedModelId) setSelectedModelId((models[0] as LoadedModel).identifier)
            setStatusMsg(`${models.length} model${models.length !== 1 ? 's' : ''} loaded`)
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : 'Refresh failed')
        } finally {
            setLoadingModels(false)
        }
    }, [selectedModelId])

    // Conversation management
    const newChat = useCallback(() => {
        const conv: Conversation = {
            id: genId(),
            title: 'New conversation',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }
        setConversations(prev => {
            const next = [conv, ...prev]
            saveConvs(next)
            return next
        })
        setActiveConvId(conv.id)
        setSidebarOpen(false)
        inputRef.current?.focus()
    }, [])

    const deleteConv = useCallback((id: string) => {
        setConversations(prev => {
            const next = prev.filter(c => c.id !== id)
            saveConvs(next)
            return next
        })
        setActiveConvId(prev => (prev === id ? null : prev))
    }, [])

    const updateConv = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
        setConversations(prev => {
            const next = prev.map(c => (c.id === id ? updater(c) : c))
            saveConvs(next)
            return next
        })
    }, [])

    // Send message
    const sendMessage = useCallback(async () => {
        const text = input.trim()
        if (!text || streaming || !clientRef.current || !selectedModelId) return

        let convId = activeConvId
        if (!convId) {
            const conv: Conversation = {
                id: genId(),
                title: titleFromMsg(text),
                messages: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }
            setConversations(prev => {
                const next = [conv, ...prev]
                saveConvs(next)
                return next
            })
            convId = conv.id
            setActiveConvId(convId)
        }

        const userMsg: Msg = { id: genId(), role: 'user', content: text }
        updateConv(convId, c => ({
            ...c,
            title: c.messages.length === 0 ? titleFromMsg(text) : c.title,
            messages: [...c.messages, userMsg],
            updatedAt: Date.now(),
        }))
        setInput('')
        setStreaming(true)

        const assistantId = genId()
        updateConv(convId!, c => ({
            ...c,
            messages: [...c.messages, { id: assistantId, role: 'assistant' as Role, content: '' }],
            updatedAt: Date.now(),
        }))

        try {
            const client = clientRef.current
            const model = await client.llm.model(selectedModelId)

            // Build Chat history from conversation
            const currentConv =
                conversations.find(c => c.id === convId) ?? ({ messages: [userMsg] } as unknown as Conversation)
            const history = [...currentConv.messages, userMsg]
            const chat = Chat.empty()
            chat.append('system', 'You are a helpful assistant.')
            for (const m of history) {
                if (m.role === 'user') chat.append('user', m.content)
                else if (m.role === 'assistant' && m.content) chat.append('assistant', m.content)
            }

            const respondOpts: Record<string, unknown> = {
                temperature: settings.temperature,
                maxTokens: settings.maxTokens,
                contextOverflowPolicy: settings.contextOverflowPolicy,
            }
            if (settings.draftModel) respondOpts['draftModel'] = settings.draftModel

            if (settings.structuredMode) {
                // Structured output
                let schema: z.ZodTypeAny
                try {
                    const parsed = JSON.parse(settings.structuredSchema)
                    const shape: Record<string, z.ZodTypeAny> = {}
                    for (const [k, v] of Object.entries(parsed)) {
                        shape[k] = v === 'number' ? z.number() : v === 'boolean' ? z.boolean() : z.string()
                    }
                    schema = z.object(shape)
                } catch {
                    schema = z.object({ answer: z.string() })
                }
                respondOpts['structured'] = schema
                const result = (await model.respond(
                    chat,
                    respondOpts as Parameters<typeof model.respond>[1]
                )) as unknown as StructuredPredictionResult<unknown>
                const content =
                    typeof result.parsed === 'object'
                        ? JSON.stringify(result.parsed, null, 2)
                        : String(result.parsed ?? result.content)
                updateConv(convId!, c => ({
                    ...c,
                    messages: c.messages.map(m => (m.id === assistantId ? { ...m, content } : m)),
                    updatedAt: Date.now(),
                }))
            } else if (settings.useTools) {
                // Agentic tool use with .act()
                let buffer = ''
                const toolCallLog: { name: string; args: string; result?: string }[] = []

                await model.act(chat, ALL_TOOLS, {
                    ...respondOpts,
                    onMessage: (msg: ChatMessage) => {
                        chat.append(msg)
                    },
                    onPredictionFragment: ({ content }: { content: string }) => {
                        buffer += content
                        updateConv(convId!, c => ({
                            ...c,
                            messages: c.messages.map(m => (m.id === assistantId ? { ...m, content: buffer } : m)),
                            updatedAt: Date.now(),
                        }))
                    },
                } as Parameters<typeof model.act>[2])

                updateConv(convId!, c => ({
                    ...c,
                    messages: c.messages.map(m =>
                        m.id === assistantId
                            ? { ...m, content: buffer, toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined }
                            : m
                    ),
                    updatedAt: Date.now(),
                }))
            } else {
                // Plain streaming
                const prediction = model.respond(chat, respondOpts as Parameters<typeof model.respond>[1])
                predictionRef.current = prediction

                let buffer = ''
                for await (const { content } of prediction) {
                    buffer += content
                    updateConv(convId!, c => ({
                        ...c,
                        messages: c.messages.map(m => (m.id === assistantId ? { ...m, content: buffer } : m)),
                        updatedAt: Date.now(),
                    }))
                }

                const result = await prediction.result()
                const stats = {
                    tokens: result.stats?.predictedTokensCount ?? 0,
                    ttft: result.stats?.timeToFirstTokenSec ?? 0,
                    stopReason: result.stats?.stopReason ?? '',
                }
                updateConv(convId!, c => ({
                    ...c,
                    messages: c.messages.map(m => (m.id === assistantId ? { ...m, stats } : m)),
                    updatedAt: Date.now(),
                }))
            }
        } catch (e) {
            if (e instanceof Error && e.message.toLowerCase().includes('cancel')) {
                // User cancelled
            } else {
                const errMsg = e instanceof Error ? e.message : 'An error occurred'
                updateConv(convId!, c => ({
                    ...c,
                    messages: c.messages.map(m => (m.id === assistantId ? { ...m, content: `Error: ${errMsg}` } : m)),
                    updatedAt: Date.now(),
                }))
            }
        } finally {
            predictionRef.current = null
            setStreaming(false)
        }
    }, [input, streaming, activeConvId, selectedModelId, settings, conversations, updateConv])

    const cancelGeneration = useCallback(() => {
        predictionRef.current?.cancel()
    }, [])

    const computeEmbedding = useCallback(async () => {
        if (!clientRef.current || !embeddingText.trim()) return
        setEmbeddingLoading(true)
        setEmbeddingResult(null)
        try {
            const models = await clientRef.current.embedding.listLoaded()
            if (!models || (models as unknown[]).length === 0) {
                setEmbeddingResult('No embedding models loaded in LM Studio.')
                return
            }
            const embModel = await clientRef.current.embedding.model((models[0] as LoadedModel).identifier)
            const { embedding } = await embModel.embed(embeddingText)
            const preview = (embedding as number[])
                .slice(0, 8)
                .map((v: number) => v.toFixed(4))
                .join(', ')
            setEmbeddingResult(`Dim: ${(embedding as number[]).length} | First 8: [${preview}, …]`)
        } catch (e) {
            setEmbeddingResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
        } finally {
            setEmbeddingLoading(false)
        }
    }, [embeddingText])

    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                sendMessage()
            }
        },
        [sendMessage]
    )

    const statusColor = {
        disconnected: 'bg-slate-400',
        connecting: 'bg-yellow-400 animate-pulse',
        connected: 'bg-green-400',
        error: 'bg-red-400',
    }[status]

    // ---- Sidebar ----------------------------------------------------------------

    const sidebarContent = (
        <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-900">
            <div className="px-2 pt-3">
                <button
                    type="button"
                    onClick={newChat}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[14px] font-medium text-slate-700 transition hover:bg-slate-200/60 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    New chat
                </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
                {sorted.length === 0 ? (
                    <p className="px-2 py-1 text-[13px] text-slate-400">No conversations yet.</p>
                ) : (
                    <ul className="space-y-0.5">
                        {sorted.map(conv => (
                            <li key={conv.id} className="group relative">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveConvId(conv.id)
                                        setSidebarOpen(false)
                                    }}
                                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] leading-snug transition ${
                                        conv.id === activeConvId
                                            ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white'
                                            : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    <span className="block truncate pr-6">{conv.title}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => deleteConv(conv.id)}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                                    aria-label="Delete"
                                >
                                    <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <polyline points="3 6 5 6 21 6" />
                                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                        <path d="M10 11v6" />
                                        <path d="M14 11v6" />
                                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                                    </svg>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )

    // ---- Settings Panel --------------------------------------------------------

    const settingsPanel = settingsOpen && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-3 text-[13px] font-semibold text-slate-700 dark:text-slate-200">Settings</h3>
            <div className="space-y-3">
                <label className="block">
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">
                        Temperature: {settings.temperature}
                    </span>
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        value={settings.temperature}
                        onChange={e => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                        className="mt-1 w-full accent-blue-500"
                    />
                </label>
                <label className="block">
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">Max tokens</span>
                    <div className="mt-1 flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={settings.maxTokens === false}
                            onChange={e => setSettings(s => ({ ...s, maxTokens: e.target.checked ? false : 2048 }))}
                            className="accent-blue-500"
                        />
                        <span className="text-[12px] text-slate-500 dark:text-slate-400">Unlimited</span>
                        {settings.maxTokens !== false && (
                            <input
                                type="number"
                                value={settings.maxTokens}
                                min={1}
                                onChange={e =>
                                    setSettings(s => ({ ...s, maxTokens: parseInt(e.target.value) || 2048 }))
                                }
                                className="w-24 rounded border border-slate-300 px-2 py-0.5 text-[12px] dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                            />
                        )}
                    </div>
                </label>
                <label className="block">
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">Context overflow</span>
                    <select
                        value={settings.contextOverflowPolicy}
                        onChange={e =>
                            setSettings(s => ({ ...s, contextOverflowPolicy: e.target.value as ContextOverflowPolicy }))
                        }
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-[12px] dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    >
                        <option value="rollingWindow">Rolling window</option>
                        <option value="truncateMiddle">Truncate middle</option>
                        <option value="stopAtLimit">Stop at limit</option>
                    </select>
                </label>
                <label className="block">
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">
                        Draft model (speculative decoding)
                    </span>
                    <input
                        type="text"
                        placeholder="e.g. lmstudio-community/draft-model"
                        value={settings.draftModel}
                        onChange={e => setSettings(s => ({ ...s, draftModel: e.target.value }))}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-[12px] dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    />
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={settings.useTools}
                        onChange={e => setSettings(s => ({ ...s, useTools: e.target.checked }))}
                        className="accent-blue-500"
                    />
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">Enable agentic tools</span>
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={settings.structuredMode}
                        onChange={e => setSettings(s => ({ ...s, structuredMode: e.target.checked }))}
                        className="accent-blue-500"
                    />
                    <span className="text-[12px] text-slate-500 dark:text-slate-400">Structured output</span>
                </label>
                {settings.structuredMode && (
                    <label className="block">
                        <span className="text-[12px] text-slate-500 dark:text-slate-400">
                            Schema (JSON: key → type)
                        </span>
                        <textarea
                            value={settings.structuredSchema}
                            onChange={e => setSettings(s => ({ ...s, structuredSchema: e.target.value }))}
                            rows={3}
                            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px] dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                        />
                    </label>
                )}

                {/* Embeddings */}
                <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
                    <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300">Embeddings</span>
                    <textarea
                        value={embeddingText}
                        onChange={e => setEmbeddingText(e.target.value)}
                        placeholder="Text to embed…"
                        rows={2}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-[12px] dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                        type="button"
                        onClick={computeEmbedding}
                        disabled={embeddingLoading || !clientRef.current}
                        className="mt-1 w-full rounded bg-slate-100 px-2 py-1 text-[12px] text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
                    >
                        {embeddingLoading ? 'Computing…' : 'Compute embedding'}
                    </button>
                    {embeddingResult && (
                        <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {embeddingResult}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )

    // ---- Main render -----------------------------------------------------------

    return (
        <div className="flex h-screen overflow-hidden bg-white text-slate-900 dark:bg-slate-950 dark:text-white">
            {/* Mobile sidebar overlay */}
            {sidebarOpen && (
                <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
            )}

            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-slate-200 transition-transform duration-200 dark:border-slate-800 md:relative md:translate-x-0 ${
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
            >
                {sidebarContent}
            </aside>

            {/* Main */}
            <div className="flex min-w-0 flex-1 flex-col">
                {/* Header */}
                <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
                    <button
                        type="button"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
                        onClick={() => setSidebarOpen(s => !s)}
                        aria-label="Toggle sidebar"
                    >
                        <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
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

                    {/* Connection bar */}
                    <div className="flex flex-1 items-center gap-2 overflow-hidden">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
                        {status !== 'connected' ? (
                            <>
                                <input
                                    type="text"
                                    value={serverUrl}
                                    onChange={e => setServerUrl(e.target.value)}
                                    placeholder="ws://localhost:1234"
                                    className="min-w-0 flex-1 rounded border border-slate-300 bg-transparent px-2 py-0.5 text-[13px] focus:outline-none dark:border-slate-600"
                                    onKeyDown={e => e.key === 'Enter' && connect()}
                                />
                                <button
                                    type="button"
                                    onClick={connect}
                                    disabled={status === 'connecting'}
                                    className="shrink-0 rounded-lg bg-blue-500 px-3 py-1 text-[12px] font-medium text-white transition hover:bg-blue-600 disabled:opacity-60"
                                >
                                    {status === 'connecting' ? 'Connecting…' : 'Connect'}
                                </button>
                            </>
                        ) : (
                            <>
                                <select
                                    value={selectedModelId}
                                    onChange={e => setSelectedModelId(e.target.value)}
                                    className="min-w-0 flex-1 truncate rounded border border-slate-300 bg-transparent px-2 py-0.5 text-[13px] focus:outline-none dark:border-slate-600 dark:bg-slate-950"
                                >
                                    {loadedModels.length === 0 && <option value="">No models loaded</option>}
                                    {loadedModels.map(m => (
                                        <option key={m.identifier} value={m.identifier}>
                                            {m.displayName ?? m.identifier}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={refreshModels}
                                    disabled={loadingModels}
                                    className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                                    aria-label="Refresh models"
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className={loadingModels ? 'animate-spin' : ''}
                                    >
                                        <polyline points="23 4 23 10 17 10" />
                                        <polyline points="1 20 1 14 7 14" />
                                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={disconnect}
                                    className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                                    aria-label="Disconnect"
                                >
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            </>
                        )}
                        {statusMsg && (
                            <span className="hidden truncate text-[12px] text-slate-400 sm:block">{statusMsg}</span>
                        )}
                    </div>

                    {/* Settings */}
                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => setSettingsOpen(s => !s)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            aria-label="Settings"
                        >
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                        </button>
                        {settingsPanel}
                    </div>
                </header>

                {/* Messages */}
                <main className="flex-1 overflow-y-auto">
                    {!activeConv || activeConv.messages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
                            {status !== 'connected' ? (
                                <div className="text-center">
                                    <p className="text-[15px] font-medium text-slate-700 dark:text-slate-200">
                                        Connect to LM Studio
                                    </p>
                                    <p className="mt-1 text-[13px] text-slate-400">
                                        Open LM Studio, load a model, then click Connect above.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <p className="text-[15px] font-medium text-slate-700 dark:text-slate-200">
                                        {selectedModelId
                                            ? `Chatting with ${
                                                  loadedModels.find(m => m.identifier === selectedModelId)
                                                      ?.displayName ?? selectedModelId
                                              }`
                                            : 'Select a model above'}
                                    </p>
                                    <div className="flex flex-wrap justify-center gap-2">
                                        {[
                                            "What's 17% of 240?",
                                            'Convert 5 miles to km',
                                            'Base64-encode "hello world"',
                                            'What time is it in Tokyo?',
                                        ].map(s => (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => {
                                                    setInput(s)
                                                    inputRef.current?.focus()
                                                }}
                                                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
                            {activeConv.messages.map(msg => (
                                <div
                                    key={msg.id}
                                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div
                                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                                            msg.role === 'user'
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                                        }`}
                                    >
                                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                                            <div className="mb-2 space-y-1">
                                                {msg.toolCalls.map((tc, i) => (
                                                    <div
                                                        key={i}
                                                        className="rounded bg-slate-200 px-2 py-1 font-mono text-[11px] dark:bg-slate-700"
                                                    >
                                                        <span className="font-semibold">{tc.name}</span>({tc.args})
                                                        {tc.result && (
                                                            <span className="text-slate-500 dark:text-slate-400">
                                                                {' '}
                                                                → {tc.result}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <p className="whitespace-pre-wrap text-[14px] leading-relaxed">
                                            {msg.content ||
                                                (streaming && msg.role === 'assistant' ? (
                                                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                                                ) : null)}
                                        </p>
                                        {msg.stats && (
                                            <p className="mt-1 text-[11px] opacity-50">
                                                {msg.stats.tokens} tokens · {msg.stats.ttft.toFixed(2)}s TTFT ·{' '}
                                                {msg.stats.stopReason}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </main>

                {/* Input */}
                <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
                    <div className="mx-auto flex max-w-2xl items-end gap-2">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={status === 'connected' ? 'Message…' : 'Connect to LM Studio first'}
                            disabled={status !== 'connected' || !selectedModelId}
                            rows={1}
                            style={{ resize: 'none', maxHeight: '8rem', overflowY: 'auto' }}
                            className="flex-1 rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-[14px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-40 dark:border-slate-700"
                            onInput={e => {
                                const el = e.currentTarget
                                el.style.height = 'auto'
                                el.style.height = `${Math.min(el.scrollHeight, 128)}px`
                            }}
                        />
                        {streaming ? (
                            <button
                                type="button"
                                onClick={cancelGeneration}
                                className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500 text-white transition hover:bg-red-600"
                                aria-label="Stop"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="6" width="12" height="12" rx="2" />
                                </svg>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={sendMessage}
                                disabled={!input.trim() || status !== 'connected' || !selectedModelId}
                                className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500 text-white transition hover:bg-blue-600 disabled:opacity-40"
                                aria-label="Send"
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <line x1="22" y1="2" x2="11" y2="13" />
                                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                </svg>
                            </button>
                        )}
                    </div>
                    {settings.useTools && status === 'connected' && (
                        <p className="mt-1.5 text-center text-[11px] text-slate-400">
                            Tools: calculator · unit converter · base64 · JSON · regex · date/time
                        </p>
                    )}
                </footer>
            </div>
        </div>
    )
}
