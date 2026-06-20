// The agent's tools — the things it can *do* in a browser-only world. Each tool
// is a pure description plus a `run` that may produce an observation string and,
// for action tools, trigger a client-side effect through the injected context.
//
// Tools are surfaced to the model as a JSON protocol (see model.ts): small
// on-device models are far more reliable emitting a constrained JSON object than
// using model-specific native tool tokens, and it keeps the graph engine-agnostic.

import { retrieveSemantic } from './retrieval'

// Side-effecting handlers the React layer provides (DOM/route/theme/memory).
export type ToolContext = {
    // Returns the opened URL (so the model can cite it), or null if unknown.
    openLink: (name: string) => string | null
    navigate: (target: string) => boolean
    setTheme: (theme: 'light' | 'dark') => boolean
    rememberFact?: (fact: string) => Promise<void>
    recallMemory?: (query: string) => Promise<string[]>
}

export type Tool = {
    name: string
    description: string
    // JSON-schema-ish parameter description shown to the model.
    parameters: Record<string, string>
    run: (args: Record<string, any>, ctx: ToolContext) => Promise<string>
}

export const TOOLS: Tool[] = [
    {
        name: 'search_profile',
        description: 'Look up facts about Teo (work, education, research, projects, skills) to ground an answer.',
        parameters: { query: 'what to look up, e.g. "education" or "current job"' },
        run: async args => {
            const chunks = await retrieveSemantic(String(args.query ?? ''), 5)
            if (!chunks.length) return 'No matching facts found.'
            return chunks.map(c => `- ${c.text}`).join('\n')
        },
    },
    {
        name: 'open_link',
        description: "Open one of Teo's links in a new tab (e.g. GitHub, LinkedIn, Email, Google Scholar, Blog).",
        parameters: { name: 'the link label, e.g. "GitHub"' },
        run: async (args, ctx) => {
            const name = String(args.name ?? '')
            const url = ctx.openLink(name)
            // Include the real URL so the final answer cites it instead of inventing one.
            return url ? `Opened ${name}. URL: ${url}` : `No link named "${name}".`
        },
    },
    {
        name: 'navigate',
        description: 'Send the visitor to a part of the site. Targets: "home", "projects", "links".',
        parameters: { target: 'one of: home, projects, links' },
        run: async (args, ctx) => {
            const target = String(args.target ?? '')
            return ctx.navigate(target) ? `Navigating to ${target}.` : `Can't navigate to "${target}".`
        },
    },
    {
        name: 'set_theme',
        description: 'Switch the site between light and dark mode.',
        parameters: { theme: 'either "light" or "dark"' },
        run: async (args, ctx) => {
            const theme = args.theme === 'light' ? 'light' : 'dark'
            return ctx.setTheme(theme) ? `Switched to ${theme} mode.` : "Couldn't change the theme."
        },
    },
    {
        name: 'remember',
        description:
            'Save a durable fact about the visitor for future visits (e.g. their name, role, or a preference).',
        parameters: { fact: 'a short fact to remember, in third person' },
        run: async (args, ctx) => {
            const fact = String(args.fact ?? '').trim()
            if (!fact) return 'Nothing to remember.'
            if (!ctx.rememberFact) return 'Memory is unavailable.'
            await ctx.rememberFact(fact)
            return `Remembered: ${fact}`
        },
    },
    {
        name: 'recall',
        description: 'Recall durable facts previously saved about the visitor.',
        parameters: { query: 'what to recall, e.g. "their name"' },
        run: async (args, ctx) => {
            if (!ctx.recallMemory) return 'Memory is unavailable.'
            const hits = await ctx.recallMemory(String(args.query ?? ''))
            return hits.length ? hits.map(h => `- ${h}`).join('\n') : 'No relevant memories.'
        },
    },
]

// Tools available given the current capabilities (memory tools need a backing ctx).
export function availableTools(ctx: ToolContext): Tool[] {
    return TOOLS.filter(t => {
        if (t.name === 'remember') return !!ctx.rememberFact
        if (t.name === 'recall') return !!ctx.recallMemory
        return true
    })
}
