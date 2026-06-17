'use client'

import dynamic from 'next/dynamic'

const ChatPage = dynamic(() => import('./ChatPage'), { ssr: false })

export default function ChatLoader() {
    return <ChatPage />
}
