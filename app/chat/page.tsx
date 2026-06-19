import type { Metadata } from 'next'
import ChatLoader from './ChatLoader'

export const metadata: Metadata = {
    title: 'Chat · Teo Zeng',
    description: 'AI chat powered by LM Studio — runs locally on your machine via the LM Studio server.',
}

export default function Chat() {
    return <ChatLoader />
}
