'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AgentChat from './AgentChat'
import SemanticSearch from './modules/SemanticSearch'
import VoiceChat from './modules/VoiceChat'
import VisionChat from './modules/VisionChat'
import VisionLab from './modules/VisionLab'
import ImageGen from './modules/ImageGen'
import DocsRag from './modules/DocsRag'
import MultiAgent from './modules/MultiAgent'
import McpLab from './modules/McpLab'
import ModelManager from './ModelManager'
import { chatEngines, engineById, DEFAULT_ENGINE_ID } from './engines'
import { chromeAIAvailable } from './agent/chromeai'

// The playground is a registry of self-contained "experiments", each showcasing
// something an in-browser model can do with no server. New capabilities (voice,
// vision, semantic search …) drop in as additional modules without touching the
// homepage. Only `chat` is wired to a live module today; the rest are scaffolded
// placeholders so the roadmap is visible in the UI.

type ModuleStatus = 'live' | 'soon'

type PlaygroundModule = {
    id: string
    title: string
    blurb: string
    status: ModuleStatus
    // Latest on-device models this experiment targets (Gemma + Liquid AI only).
    models: string
}

const MODULES: PlaygroundModule[] = [
    {
        id: 'chat',
        title: 'Agent chat',
        blurb: 'A profile-grounded agent running entirely in your browser — semantic RAG, tool-calling and persistent memory.',
        status: 'live',
        models: 'Gemma · Liquid · Llama · Qwen3 · Phi · Gemini Nano',
    },
    {
        id: 'voice',
        title: 'Voice agent',
        blurb: 'A full on-device voice loop — Silero VAD turn-taking, Whisper speech-to-text, an LFM2.5 answer and Kokoro speech, all in your browser.',
        status: 'live',
        models: 'Silero VAD · Whisper · LFM2.5 · Kokoro',
    },
    {
        id: 'vision',
        title: 'Vision chat',
        blurb: 'Drop in an image or use your webcam and ask about it — captioning, visual Q&A and OCR on-device.',
        status: 'live',
        models: 'Gemma 4 · LFM2-VL',
    },
    {
        id: 'visionlab',
        title: 'Vision lab',
        blurb: 'Pixel-level computer vision — background removal, depth maps and object detection, all in your browser.',
        status: 'live',
        models: 'RMBG · Depth Anything v2 · DETR',
    },
    {
        id: 'imagegen',
        title: 'Image generation',
        blurb: 'Type a prompt and generate an image on-device with SD-Turbo. Experimental and heavy, but nothing leaves your machine.',
        status: 'live',
        models: 'SD-Turbo · onnxruntime-web',
    },
    {
        id: 'multiagent',
        title: 'Multi-agent',
        blurb: 'A supervisor routes each turn to a specialist — researcher, actor or generalist — and shows its decision. A LangGraph multi-agent system in your browser.',
        status: 'live',
        models: 'LangGraph supervisor · LFM2.5',
    },
    {
        id: 'mcp',
        title: 'MCP tools',
        blurb: 'Connect the browser agent to a live Model Context Protocol server over HTTP, list its tools and call them — the same toolbox cloud agents use.',
        status: 'live',
        models: 'MCP · Streamable HTTP',
    },
    {
        id: 'docs',
        title: 'Chat with a doc',
        blurb: 'Drop in a PDF or text file and ask questions answered only from its contents — parsed, embedded, reranked and answered on-device.',
        status: 'live',
        models: 'EmbeddingGemma · BGE reranker · LFM2.5',
    },
    {
        id: 'search',
        title: 'Semantic search',
        blurb: 'Search the site by meaning, not keywords — embedded and indexed in your browser.',
        status: 'live',
        models: 'EmbeddingGemma · two-stage rerank',
    },
]

export default function Playground() {
    const [active, setActive] = useState<string>('chat')
    const [engineId, setEngineId] = useState<string>(DEFAULT_ENGINE_ID)
    const [chromeOk, setChromeOk] = useState(false)
    const current = MODULES.find(m => m.id === active) ?? MODULES[0]
    const engine = engineById(engineId)

    // Only offer Chrome's built-in engine when the Prompt API is actually present.
    useEffect(() => {
        let alive = true
        chromeAIAvailable().then(ok => alive && setChromeOk(ok))
        return () => {
            alive = false
        }
    }, [])

    // The chat-brain choices (Chrome's built-in engine only when it's available).
    const usableEngines = useMemo(() => chatEngines().filter(e => e.runtime !== 'chrome' || chromeOk), [chromeOk])

    return (
        <main className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
            <header>
                <Link
                    href="/"
                    className="text-[13px] text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
                >
                    ← Teo Zeng
                </Link>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    Ask AI — Playground
                </h1>
                <p className="mt-2 max-w-md text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Exploring the full potential of browser-only AI. Everything here runs on-device with WebGPU — no
                    server, no API key, nothing leaves your machine.
                </p>
            </header>

            <nav className="mt-8 flex flex-wrap gap-2" aria-label="Experiments">
                {MODULES.map(m => {
                    const isActive = m.id === active
                    return (
                        <button
                            key={m.id}
                            type="button"
                            onClick={() => setActive(m.id)}
                            aria-pressed={isActive}
                            className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                                isActive
                                    ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600'
                            }`}
                        >
                            {m.title}
                            {m.status === 'soon' && (
                                <span className={isActive ? 'ml-1.5 opacity-70' : 'ml-1.5 text-slate-400'}>· soon</span>
                            )}
                        </button>
                    )
                })}
            </nav>

            <section className="mt-6">
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {current.blurb}
                        </p>
                        <p className="mt-1 text-[12px] text-slate-400">{current.models}</p>
                    </div>
                    {(current.id === 'chat' || current.id === 'multiagent') && (
                        // Model manager: pick a model to download, see what's cached
                        // on-device, and which one is loaded right now.
                        <div className="shrink-0">
                            <ModelManager engines={usableEngines} activeId={engineId} onPick={setEngineId} />
                        </div>
                    )}
                </div>

                {current.id === 'chat' ? (
                    <AgentChat engine={engine} />
                ) : current.id === 'multiagent' ? (
                    <MultiAgent engine={engine} />
                ) : current.id === 'mcp' ? (
                    <McpLab />
                ) : current.id === 'search' ? (
                    <SemanticSearch />
                ) : current.id === 'voice' ? (
                    <VoiceChat />
                ) : current.id === 'vision' ? (
                    <VisionChat />
                ) : current.id === 'visionlab' ? (
                    <VisionLab />
                ) : current.id === 'imagegen' ? (
                    <ImageGen />
                ) : current.id === 'docs' ? (
                    <DocsRag />
                ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center dark:border-slate-700">
                        <p className="text-[14px] text-slate-500 dark:text-slate-400">
                            {current.title} is on the roadmap.
                        </p>
                        <p className="mt-1 text-[12px] text-slate-400">Coming to the playground soon.</p>
                    </div>
                )}
            </section>
        </main>
    )
}
