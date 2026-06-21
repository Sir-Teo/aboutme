// The agent "brain" helpers: turn tools + conversation into prompts, and parse
// the model's JSON tool decision. Kept independent of the model runtime via an
// injected `LLM` function, so the same logic is unit-testable in Node with a stub.

import type { ChatMessage } from './runtime'
import type { Tool } from './tools'

export type LLM = (
    messages: ChatMessage[],
    opts?: { onChunk?: (chunk: string) => void; json?: boolean }
) => Promise<string>

export type ToolDecision = { name: string; args: Record<string, any> } | null

// Ask the model to pick a tool (or none). Constrained JSON keeps small on-device
// models reliable. The system message enumerates tools and the exact schema.
export function planMessages(
    tools: Tool[],
    history: ChatMessage[],
    input: string,
    observations: string[]
): ChatMessage[] {
    const toolList = tools
        .map(t => {
            const params = Object.entries(t.parameters)
                .map(([k, v]) => `"${k}": <${v}>`)
                .join(', ')
            return `- ${t.name}: ${t.description} args: {${params}}`
        })
        .join('\n')

    const seen = observations.length ? `\nObservations so far:\n${observations.join('\n')}\n` : ''

    const system = [
        `You are the planner for an assistant on a personal website.`,
        `Decide if a tool would help answer the user. Available tools:`,
        toolList,
        ``,
        `Reply with ONE JSON object and nothing else:`,
        `- to use a tool: {"tool": "<name>", "args": { ... }}`,
        `- if you already have enough to answer: {"tool": "none"}`,
        `Prefer search_profile before answering questions about Teo.`,
        `Do not call the same tool with the same args twice.`,
        seen,
    ].join('\n')

    return [
        { role: 'system', content: system },
        { role: 'user', content: input },
    ]
}

// Pull the first JSON object out of the model's reply and interpret it.
export function parseDecision(text: string): ToolDecision {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
        const obj = JSON.parse(match[0])
        const tool = typeof obj.tool === 'string' ? obj.tool.trim() : ''
        if (!tool || tool.toLowerCase() === 'none') return null
        return { name: tool, args: obj.args && typeof obj.args === 'object' ? obj.args : {} }
    } catch {
        return null
    }
}

// The final answer prompt: base grounding + any tool observations + recent turns.
export function answerMessages(
    persona: string,
    grounding: string,
    observations: string[],
    history: ChatMessage[],
    input: string
): ChatMessage[] {
    const context = [grounding, observations.length ? `\nLooked up:\n${observations.join('\n')}` : '']
        .filter(Boolean)
        .join('\n')

    const recent = history.slice(-6)
    return [
        { role: 'system', content: `${persona}\n\nContext:\n${context}` },
        ...recent,
        { role: 'user', content: input },
    ]
}
