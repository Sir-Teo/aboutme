import type { Metadata } from 'next'
import ChatLoader from './ChatLoader'

export const metadata: Metadata = {
    title: 'Local Chat',
    description: 'On-device AI chat powered by WebGPU — runs entirely in your browser, no data sent.',
}

export default function Chat() {
    return <ChatLoader />
}
