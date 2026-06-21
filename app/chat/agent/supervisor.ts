// A multi-agent supervisor graph — a small LangGraph that routes each turn to a
// specialist instead of running one monolithic agent:
//
//   START → route ─┬─▶ researcher  (RAG-grounded answer about Teo)
//                  ├─▶ actor       (performs an action via a tool, then confirms)
//                  └─▶ generalist  (open-ended chat in persona)
//                                   ─▶ END
//
// Everything is injected (llm / tools / grounding / ctx) so it stays engine-
// agnostic and runs entirely in the browser, like the single-agent graph.

import { StateGraph, Annotation, START, END } from '@langchain/langgraph/web'
import type { ChatMessage } from './runtime'
import type { Tool, ToolContext } from './tools'
import type { LLM } from './model'

export type Specialist = 'researcher' | 'actor' | 'generalist'

export type SupervisorParams = {
    llm: LLM
    tools: Tool[]
    ctx: ToolContext
    persona: string
    grounding: (query: string) => Promise<string>
    history: ChatMessage[]
    input: string
    onChunk?: (chunk: string) => void
    onRoute?: (specialist: Specialist, reason: string) => void
    onToolEvent?: (event: { name: string; args: Record<string, any>; observation: string }) => void
}

function firstJson(text: string): any {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
        return JSON.parse(match[0])
    } catch {
        return null
    }
}

const SupervisorState = Annotation.Root({
    route: Annotation<Specialist>({ reducer: (_a, b) => b, default: () => 'generalist' }),
    answer: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
})
type State = typeof SupervisorState.State

export function buildSupervisorGraph(params: SupervisorParams) {
    const { llm, tools, ctx, persona, grounding, history, input, onChunk, onRoute, onToolEvent } = params

    async function route(): Promise<Partial<State>> {
        const system = [
            `You are a router. Pick the best specialist to handle the user's message.`,
            `- "researcher": questions about Teo (work, study, projects, skills).`,
            `- "actor": requests to DO something — open a link, navigate, switch theme.`,
            `- "generalist": small talk or anything else.`,
            ``,
            `Reply with ONE JSON object: {"specialist": "researcher|actor|generalist", "reason": "<short>"}`,
        ].join('\n')
        const reply = await llm(
            [
                { role: 'system', content: system },
                { role: 'user', content: input },
            ],
            { json: true }
        )
        const parsed = firstJson(reply)
        const choice: Specialist =
            parsed?.specialist === 'researcher' || parsed?.specialist === 'actor' ? parsed.specialist : 'generalist'
        onRoute?.(choice, typeof parsed?.reason === 'string' ? parsed.reason : '')
        return { route: choice }
    }

    async function researcher(): Promise<Partial<State>> {
        const grounded = await grounding(input)
        const messages: ChatMessage[] = [
            { role: 'system', content: `${persona}\n\nUse only this context:\n${grounded}` },
            ...history.slice(-4),
            { role: 'user', content: input },
        ]
        const answer = await llm(messages, { onChunk })
        return { answer }
    }

    async function actor(): Promise<Partial<State>> {
        const toolList = tools
            .map(t => {
                const params2 = Object.entries(t.parameters)
                    .map(([k, v]) => `"${k}": <${v}>`)
                    .join(', ')
                return `- ${t.name}: ${t.description} args: {${params2}}`
            })
            .join('\n')
        const planReply = await llm(
            [
                {
                    role: 'system',
                    content: [
                        `Choose ONE tool to satisfy the user's request. Tools:`,
                        toolList,
                        ``,
                        `Reply with ONE JSON object: {"tool": "<name>", "args": { ... }}`,
                    ].join('\n'),
                },
                { role: 'user', content: input },
            ],
            { json: true }
        )
        const decision = firstJson(planReply)
        const tool = decision && tools.find(t => t.name === decision.tool)
        let observation = ''
        if (tool) {
            const args = decision.args && typeof decision.args === 'object' ? decision.args : {}
            observation = await tool.run(args, ctx)
            onToolEvent?.({ name: tool.name, args, observation })
        } else {
            observation = 'No suitable action was found.'
        }
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `${persona}\n\nYou just performed an action. Result: ${observation}\nConfirm it to the user in one short sentence.`,
            },
            { role: 'user', content: input },
        ]
        const answer = await llm(messages, { onChunk })
        return { answer }
    }

    async function generalist(): Promise<Partial<State>> {
        const messages: ChatMessage[] = [
            { role: 'system', content: persona },
            ...history.slice(-4),
            { role: 'user', content: input },
        ]
        const answer = await llm(messages, { onChunk })
        return { answer }
    }

    const graph = new StateGraph(SupervisorState)
        .addNode('route', route)
        .addNode('researcher', researcher)
        .addNode('actor', actor)
        .addNode('generalist', generalist)
        .addEdge(START, 'route')
        .addConditionalEdges('route', (s: State) => s.route, {
            researcher: 'researcher',
            actor: 'actor',
            generalist: 'generalist',
        })
        .addEdge('researcher', END)
        .addEdge('actor', END)
        .addEdge('generalist', END)

    return graph.compile()
}

export async function runSupervisor(params: SupervisorParams): Promise<string> {
    const app = buildSupervisorGraph(params)
    const final = (await app.invoke({}, { recursionLimit: 8 })) as State
    return final.answer
}
