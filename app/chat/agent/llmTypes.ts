// Shared types for the LLM layer. Kept in their own module so the three runtime
// adapters (transformers worker, WebLLM, Chrome Prompt API) and the dispatcher in
// runtime.ts can all reference them without an import cycle.

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'
export type ChatMessage = { role: ChatRole; content: string }

// A tool definition passed to a chat template for native function-calling.
export type ToolSpec = {
    name: string
    description: string
    parameters: Record<string, unknown>
}

export type GenerateHandlers = {
    onChunk?: (chunk: string) => void
    onProgress?: (progress: string) => void
    onReady?: () => void
    signal?: AbortSignal
    // Ask the runtime for strict JSON output (grammar-constrained where the
    // runtime supports it — WebLLM via XGrammar). The agent planner sets this so
    // tool decisions are guaranteed-valid JSON even on small models.
    json?: boolean
}
