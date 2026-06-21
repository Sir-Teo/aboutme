'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GpuGate from '../GpuGate'
import { profile, links } from '../../data/profile'
import { engineById, type Engine } from '../engines'
import { generate, warm, disposeModel, type ChatMessage } from '../agent/runtime'
import { groundingBlock, warmIndex } from '../agent/retrieval'
import { warmEmbedder } from '../agent/embeddings'
import { availableTools, type ToolContext } from '../agent/tools'
import { runSupervisor, type Specialist } from '../agent/supervisor'

// Multi-agent tab: a supervisor routes each turn to a specialist (researcher /
// actor / generalist) and the chosen one answers. The routing decision is shown
// so you can watch the orchestration. Same on-device models, no server.

type Role = 'user' | 'assistant'
type Msg = { role: Role; content: string; route?: Specialist; reason?: string }

const ENGINE = engineById('lfm2.5-1.2b')
const PERSONA = [
    `You are a helpful assistant on ${profile.name}'s website.`,
    `Answer concisely and warmly. Refer to him as Teo.`,
].join('\n')

const ROUTE_LABEL: Record<Specialist, string> = {
    researcher: 'Researcher',
    actor: 'Actor',
    generalist: 'Generalist',
}

function findLinkHref(name: string): string | undefined {
    const q = name.trim().toLowerCase()
    return links.find(l => l.href && (l.label.toLowerCase() === q || l.label.toLowerCase().includes(q)))?.href
}

function MultiAgentInner({ engine }: { engine: Engine }) {
    const [messages, setMessages] = useState<Msg[]>([])
    const [input, setInput] = useState('')
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('')

    const ctx = useMemo<ToolContext>(
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
                document.documentElement.classList.toggle('dark', theme === 'dark')
                try {
                    localStorage.setItem('theme', theme)
                } catch {}
                return true
            },
        }),
        []
    )

    useEffect(() => {
        warmEmbedder()
        warmIndex()
        warm(engine)
        return () => disposeModel()
    }, [engine])

    const send = useCallback(
        async (text: string) => {
            const q = text.trim()
            if (!q || busy) return
            setInput('')
            const priorHistory: ChatMessage[] = messages.map(m => ({ role: m.role, content: m.content }))
            setMessages(prev => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '' }])
            setBusy(true)
            const idx = messages.length + 1
            const patch = (p: Partial<Msg>) =>
                setMessages(prev => {
                    const next = prev.slice()
                    if (next[idx]?.role === 'assistant') next[idx] = { ...next[idx], ...p }
                    return next
                })
            try {
                setStatus('Routing…')
                await runSupervisor({
                    llm: (msgs, opts) =>
                        generate(engine, msgs, {
                            onProgress: setStatus,
                            onReady: () => setStatus(''),
                            onChunk: opts?.onChunk,
                            json: opts?.json,
                        }),
                    tools: availableTools(ctx),
                    ctx,
                    persona: PERSONA,
                    grounding: q2 => groundingBlock(q2, 5),
                    history: priorHistory,
                    input: q,
                    onRoute: (route, reason) => {
                        setStatus(`Routed to ${ROUTE_LABEL[route]}`)
                        patch({ route, reason })
                    },
                    onChunk: chunk => {
                        setStatus('')
                        setMessages(prev => {
                            const next = prev.slice()
                            const cur = next[idx]
                            if (cur?.role === 'assistant') next[idx] = { ...cur, content: cur.content + chunk }
                            return next
                        })
                    },
                })
            } catch (e) {
                patch({ content: `Error: ${e instanceof Error ? e.message : 'failed'}` })
            } finally {
                setBusy(false)
                setStatus('')
            }
        },
        [busy, messages, ctx, engine]
    )

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <p className="text-[12px] text-slate-400">
                Supervisor → Researcher · Actor · Generalist — multi-agent routing on {ENGINE.label}, on-device
            </p>

            <div className="mt-4 min-h-[10rem] space-y-3">
                {messages.length === 0 ? (
                    <p className="text-[14px] text-slate-400">
                        Try “What does Teo research?”, “Open Teo’s GitHub”, or “Tell me a joke”.
                    </p>
                ) : (
                    messages.map((m, i) =>
                        m.role === 'user' ? (
                            <p key={i} className="text-right">
                                <span className="inline-block rounded-2xl bg-slate-900 px-3.5 py-2 text-left text-[14px] text-slate-50 dark:bg-slate-100 dark:text-slate-900">
                                    {m.content}
                                </span>
                            </p>
                        ) : (
                            <div key={i}>
                                {m.route && (
                                    <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                                        → {ROUTE_LABEL[m.route]}
                                        {m.reason ? ` · ${m.reason}` : ''}
                                    </p>
                                )}
                                <span className="inline-block rounded-2xl bg-slate-100 px-3.5 py-2 text-[14px] leading-relaxed text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                                    {m.content || '…'}
                                </span>
                            </div>
                        )
                    )
                )}
                {status && <p className="text-[12px] text-slate-400">{status}</p>}
            </div>

            <form
                onSubmit={e => {
                    e.preventDefault()
                    void send(input)
                }}
                className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
            >
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder={busy ? status || 'Working…' : 'Ask anything…'}
                    disabled={busy}
                    className="flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-slate-100"
                />
                <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    className="rounded-full bg-slate-900 px-3.5 py-1.5 text-[13px] text-white transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                >
                    Send
                </button>
            </form>
        </div>
    )
}

export default function MultiAgent({ engine }: { engine: Engine }) {
    return (
        <GpuGate>
            <MultiAgentInner engine={engine} />
        </GpuGate>
    )
}
