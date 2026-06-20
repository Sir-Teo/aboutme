import type { Metadata } from 'next'
import Playground from './Playground'
import RegisterSW from './RegisterSW'

export const metadata: Metadata = {
    title: 'Ask AI — Playground',
    description:
        'An in-browser LLM playground: chat, voice, vision and semantic search running entirely on-device with WebGPU — no server, no API key, no data leaving your machine.',
    manifest: '/manifest.webmanifest',
}

// The /chat route is a self-contained playground for in-browser AI. It is kept
// deliberately separate from the homepage (app/page.tsx): the landing page stays
// minimal, while everything experimental lives here.
export default function ChatPage() {
    return (
        <>
            <RegisterSW />
            <Playground />
        </>
    )
}
