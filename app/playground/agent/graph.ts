// The agentic core: a LangGraph StateGraph that runs entirely in the browser.
//
//   START → plan ──(tool?)──▶ tools ──▶ plan
//                  └──(done)──▶ respond → END
//
// `plan` asks the model whether a tool helps; `tools` executes it and records an
// observation; once planning is done `respond` streams the grounded final answer.
// Everything is injected (llm, tools, ctx, grounding) so the graph is engine-
// agnostic and unit-testable in Node with a stub model — no WebGPU required.

import { StateGraph, Annotation, START, END } from '@langchain/langgraph/web'
import type { BaseCheckpointSaver } from '@langchain/langgraph/web'
import type { ChatMessage } from './runtime'
import type { Tool, ToolContext } from './tools'
import { planMessages, parseDecision, answerMessages, type LLM } from './model'

// Cap tool hops so a confused model can't loop forever.
const MAX_TOOL_STEPS = 3

export type ToolEvent = { name: string; args: Record<string, any>; observation: string }

export type RunAgentParams = {
    llm: LLM
    tools: Tool[]
    ctx: ToolContext
    persona: string
    // Base grounding for the final answer (semantic RAG over the knowledge base).
    grounding: (query: string) => Promise<string>
    history: ChatMessage[]
    input: string
    onChunk?: (chunk: string) => void
    onToolEvent?: (event: ToolEvent) => void
    // Optional persistence for short-term memory (P4 wires an IndexedDB saver).
    checkpointer?: BaseCheckpointSaver
    threadId?: string
}

const AgentState = Annotation.Root({
    observations: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
    steps: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
    pending: Annotation<{ name: string; args: Record<string, any> } | null>({
        reducer: (_a, b) => b,
        default: () => null,
    }),
    answer: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
})

type State = typeof AgentState.State

export function buildAgentGraph(params: RunAgentParams) {
    const { llm, tools, ctx, persona, grounding, history, input, onChunk, onToolEvent } = params

    async function plan(state: State): Promise<Partial<State>> {
        if (state.steps >= MAX_TOOL_STEPS) return { pending: null }
        const reply = await llm(planMessages(tools, history, input, state.observations))
        const decision = parseDecision(reply)
        // Reject hallucinated tool names — treat as "done planning".
        if (decision && !tools.some(t => t.name === decision.name)) {
            return { pending: null, steps: state.steps + 1 }
        }
        // Dedupe: small models love to re-issue an identical call. If this exact
        // tool+args already ran, stop planning and go answer.
        if (decision) {
            const signature = `${decision.name}(${JSON.stringify(decision.args)})`
            if (state.observations.some(o => o.startsWith(signature))) {
                return { pending: null, steps: state.steps + 1 }
            }
        }
        return { pending: decision, steps: state.steps + 1 }
    }

    async function runTools(state: State): Promise<Partial<State>> {
        const p = state.pending
        if (!p) return {}
        const tool = tools.find(t => t.name === p.name)
        const observation = tool ? await tool.run(p.args, ctx) : `Unknown tool: ${p.name}`
        onToolEvent?.({ name: p.name, args: p.args, observation })
        return { observations: [`${p.name}(${JSON.stringify(p.args)}) -> ${observation}`], pending: null }
    }

    async function respond(state: State): Promise<Partial<State>> {
        const grounded = await grounding(input)
        const messages = answerMessages(persona, grounded, state.observations, history, input)
        const answer = await llm(messages, { onChunk })
        return { answer }
    }

    const graph = new StateGraph(AgentState)
        .addNode('plan', plan)
        .addNode('tools', runTools)
        .addNode('respond', respond)
        .addEdge(START, 'plan')
        .addConditionalEdges('plan', (s: State) => (s.pending ? 'tools' : 'respond'), {
            tools: 'tools',
            respond: 'respond',
        })
        .addEdge('tools', 'plan')
        .addEdge('respond', END)

    return graph.compile(params.checkpointer ? { checkpointer: params.checkpointer } : undefined)
}

// Run the agent for one user turn and return the final answer text.
export async function runAgent(params: RunAgentParams): Promise<string> {
    const app = buildAgentGraph(params)
    const config = params.threadId
        ? { configurable: { thread_id: params.threadId }, recursionLimit: 16 }
        : { recursionLimit: 16 }
    const final = (await app.invoke({}, config)) as State
    return final.answer
}
