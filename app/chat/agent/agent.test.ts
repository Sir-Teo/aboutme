// Agent E2E (real graph, deterministic LLM). Runs the actual LangGraph agent
// (plan → tools → respond) with the real search_profile tool backed by the
// knowledge base, and a stub LLM standing in for the on-device model. Audits
// that the agent (a) decides to look Teo up, (b) the tool returns the correct
// fact, and (c) that fact is delivered into the answer step's grounding.
//
// This isolates the agent orchestration + KB accuracy from WebGPU/model variance;
// real-model answers are validated separately in the browser.

import { describe, it, expect } from 'vitest'
import { runAgent } from './graph'
import type { Tool, ToolContext } from './tools'
import type { ChatMessage } from './runtime'
import { retrieve } from '../../data/knowledge'

const ctx: ToolContext = {
    openLink: () => null,
    navigate: () => false,
    setTheme: () => false,
}

// The real profile-search tool, lexical-backed (deterministic, no model).
const tools: Tool[] = [
    {
        name: 'search_profile',
        description: 'Look up facts about Teo (work, education, research, projects, skills).',
        parameters: { query: 'what to look up' },
        run: async args => {
            const chunks = retrieve(String(args.query ?? ''), 4)
            return chunks.length ? chunks.map(c => `- ${c.text}`).join('\n') : 'No matching facts found.'
        },
    },
]

// Deterministic stand-in for the on-device LLM. On a planning turn it calls
// search_profile once (then stops); on the answer turn it returns the grounded
// context verbatim so the test can assert the right facts arrived.
function stubLLM(input: string) {
    return async (messages: ChatMessage[], opts?: { onChunk?: (c: string) => void; json?: boolean }) => {
        const system = messages[0]?.content ?? ''
        if (system.includes('planner')) {
            if (system.includes('Observations so far')) return '{"tool": "none"}'
            return JSON.stringify({ tool: 'search_profile', args: { query: input } })
        }
        // Answer turn: stream back the grounded system context.
        opts?.onChunk?.(system)
        return system
    }
}

async function ask(input: string) {
    const observations: string[] = []
    const answer = await runAgent({
        llm: stubLLM(input),
        tools,
        ctx,
        persona: 'You are a helpful assistant on Teo’s site.',
        grounding: async q =>
            retrieve(q, 4)
                .map(c => `- ${c.text}`)
                .join('\n'),
        history: [],
        input,
        onToolEvent: e => observations.push(e.observation),
    })
    return { answer, observations }
}

const CASES: { q: string; expect: RegExp }[] = [
    { q: 'What is Teo’s current job?', expect: /Data Scientist|ATPCO|3Victors/i },
    { q: 'Where did Teo get his master’s degree?', expect: /New York University/i },
    { q: 'What did Teo study at UC Santa Barbara?', expect: /triple major|Applied Mathematics/i },
    { q: 'What is Web-KaTrain?', expect: /Go|Weiqi|TensorFlow\.js/i },
    { q: 'How can I contact Teo?', expect: /zengwc\.teo2016@outlook\.com/i },
    { q: 'What papers has Teo written about pancreatitis?', expect: /pancreatitis|Radiology Advances/i },
    { q: 'What are Teo’s hobbies?', expect: /traveling|running|basketball|video games/i },
    { q: 'What is Teo’s GitHub?', expect: /Sir-Teo|github/i },
]

describe('agent answers grounded facts end-to-end', () => {
    for (const c of CASES) {
        it(`"${c.q}"`, async () => {
            const { answer, observations } = await ask(c.q)
            // The agent used a tool…
            expect(observations.length, 'expected the agent to call a tool').toBeGreaterThan(0)
            // …and the correct fact reached both the observation and the answer.
            const obsBlob = observations.join('\n')
            expect(obsBlob, `tool observations: ${obsBlob}`).toMatch(c.expect)
            expect(answer).toMatch(c.expect)
        }, 20000)
    }

    it('does not hallucinate a tool that does not exist', async () => {
        // If the model names a bogus tool, the graph must not crash or invent output.
        const answer = await runAgent({
            llm: async (messages: ChatMessage[]) => {
                const system = messages[0]?.content ?? ''
                if (system.includes('planner')) return '{"tool": "made_up_tool", "args": {}}'
                return 'ok'
            },
            tools,
            ctx,
            persona: 'persona',
            grounding: async () => 'context',
            history: [],
            input: 'do something weird',
        })
        expect(typeof answer).toBe('string')
    })
})
