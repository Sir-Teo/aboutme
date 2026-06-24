'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AgentChat from './AgentChat'
import ModelManager from './ModelManager'
import { chatEngines, engineById, DEFAULT_ENGINE_ID } from './engines'
import { chromeAIAvailable } from './agent/chromeai'

// One unified surface: a single on-device chat that does everything through its
// composer "+" — text, vision (attach an image), documents (attach a file),
// image generation, image ops, live MCP tools — plus voice in/out. No tabs; the
// standalone lab modules remain in the codebase but the chat now subsumes them.

export default function Playground() {
    const [engineId, setEngineId] = useState(DEFAULT_ENGINE_ID)
    const [chromeOk, setChromeOk] = useState(false)
    const engine = engineById(engineId)

    // Only offer Chrome's built-in engine when the Prompt API is actually present.
    useEffect(() => {
        let alive = true
        chromeAIAvailable().then(ok => alive && setChromeOk(ok))
        return () => {
            alive = false
        }
    }, [])

    const usableEngines = useMemo(() => chatEngines().filter(e => e.runtime !== 'chrome' || chromeOk), [chromeOk])

    return (
        <div className="chat-theme flex h-[100dvh] flex-col bg-[var(--c-bg)] text-[var(--c-text)]">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--c-border)] px-4 pr-16 sm:px-6">
                <Link
                    href="/"
                    className="flex items-center gap-1.5 text-[13px] text-[var(--c-muted)] transition-colors hover:text-[var(--c-text)]"
                >
                    <span aria-hidden>←</span> Teo Zeng
                </Link>
                <span className="text-[var(--c-faint)]">·</span>
                <span className="text-[15px] font-semibold tracking-tight">Ask AI</span>
                <div className="ml-auto">
                    <ModelManager engines={usableEngines} activeId={engineId} onPick={setEngineId} />
                </div>
            </header>

            <div className="min-h-0 flex-1">
                <AgentChat engine={engine} />
            </div>
        </div>
    )
}
