'use client'

import { useState } from 'react'
import Link from 'next/link'
import AgentChat from './AgentChat'
import SemanticSearch from './modules/SemanticSearch'
import VoiceChat from './modules/VoiceChat'
import VisionChat from './modules/VisionChat'
import { chatEngines, engineById, DEFAULT_ENGINE_ID } from './engines'

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
        models: 'LFM2.5 & Gemma 3 · 270M–1.2B',
    },
    {
        id: 'voice',
        title: 'Voice chat',
        blurb: 'Speak a question and hear the answer spoken back — the language model runs on-device.',
        status: 'live',
        models: 'Browser STT · LFM2.5',
    },
    {
        id: 'vision',
        title: 'Vision chat',
        blurb: 'Drop in an image or use your webcam and ask about it — captioning, visual Q&A and OCR on-device.',
        status: 'live',
        models: 'Gemma 4 E2B',
    },
    {
        id: 'search',
        title: 'Semantic search',
        blurb: 'Search the site by meaning, not keywords — embedded and indexed in your browser.',
        status: 'live',
        models: 'EmbeddingGemma',
    },
]

export default function Playground() {
    const [active, setActive] = useState<string>('chat')
    const [engineId, setEngineId] = useState<string>(DEFAULT_ENGINE_ID)
    const current = MODULES.find(m => m.id === active) ?? MODULES[0]
    const engine = engineById(engineId)
    const engines = chatEngines()

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
                    {current.id === 'chat' && (
                        // Model switcher: run the same chat on Gemma 4 vs a Liquid AI
                        // specialist. Comparing engines is part of the playground.
                        <label className="shrink-0 text-[12px] text-slate-400">
                            <span className="sr-only">Model</span>
                            <select
                                value={engineId}
                                onChange={e => setEngineId(e.target.value)}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                            >
                                {engines.map(e => (
                                    <option key={e.id} value={e.id}>
                                        {e.label} ({e.sizeLabel})
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                </div>

                {current.id === 'chat' ? (
                    <AgentChat engine={engine} />
                ) : current.id === 'search' ? (
                    <SemanticSearch />
                ) : current.id === 'voice' ? (
                    <VoiceChat />
                ) : current.id === 'vision' ? (
                    <VisionChat />
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
