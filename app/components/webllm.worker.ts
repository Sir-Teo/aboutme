// Dedicated worker that hosts an MLC WebLLM engine off the main thread.
//
// WebLLM ships a ready-made worker handler: we just forward messages to it. The
// client side (app/chat/agent/webllm.ts) talks to this worker through
// CreateWebWorkerMLCEngine, which speaks the same protocol.

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()

self.addEventListener('message', (event: MessageEvent) => {
    handler.onmessage(event)
})

export {}
