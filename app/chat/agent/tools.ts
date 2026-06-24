// The agent's tools — the things it can *do* in a browser-only world. Each tool
// is a pure description plus a `run` that may produce an observation string and,
// for action tools, trigger a client-side effect through the injected context.
//
// Tools are surfaced to the model as a JSON protocol (see model.ts): small
// on-device models are far more reliable emitting a constrained JSON object than
// using model-specific native tool tokens, and it keeps the graph engine-agnostic.

import { retrieveHybrid } from './retrieval'

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

// ─────────────────────────── live data (CORS-enabled) ────────────────────────
// Unlike the baked knowledge base, these tools hit public APIs at runtime so the
// agent can answer with up-to-the-minute facts — entirely from the browser, no
// server. Both APIs send `Access-Control-Allow-Origin: *`. Results are cached for
// the session and every call is time-boxed + failure-tolerant so a flaky network
// degrades to a graceful note rather than breaking the turn.
const liveCache = new Map<string, string>()

async function fetchJson(url: string, timeoutMs = 6000): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json()
    } finally {
        clearTimeout(timer)
    }
}

async function fetchGithubActivity(): Promise<string> {
    const key = 'github-activity'
    const cached = liveCache.get(key)
    if (cached) return cached
    try {
        const repos = await fetchJson('https://api.github.com/users/Sir-Teo/repos?per_page=5&sort=pushed&type=owner')
        if (!Array.isArray(repos) || repos.length === 0) return 'No recent GitHub activity found.'
        const lines = repos.slice(0, 5).map((r: any) => {
            const lang = r.language ? ` (${r.language})` : ''
            const updated = r.pushed_at ? String(r.pushed_at).slice(0, 10) : 'unknown'
            return `- ${r.name}${lang}: updated ${updated}, ${r.stargazers_count || 0}★ — ${
                r.description || 'no description'
            }`
        })
        const out = `Teo's most recently updated GitHub repositories:\n${lines.join('\n')}`
        liveCache.set(key, out)
        return out
    } catch (error) {
        return `Couldn't reach GitHub just now (${error instanceof Error ? error.message : 'network error'}).`
    }
}

async function fetchChessStats(): Promise<string> {
    const key = 'chess-stats'
    const cached = liveCache.get(key)
    if (cached) return cached
    try {
        const stats = await fetchJson('https://api.chess.com/pub/player/masterteo1205/stats')
        const rating = (b: any, label: string) => (b?.last?.rating ? `${label} ${b.last.rating}` : null)
        const parts = [
            rating(stats?.chess_rapid, 'Rapid'),
            rating(stats?.chess_blitz, 'Blitz'),
            rating(stats?.chess_bullet, 'Bullet'),
        ].filter(Boolean)
        const out = parts.length
            ? `Teo's current Chess.com ratings (masterteo1205): ${parts.join(', ')}.`
            : 'No current Chess.com ratings are available.'
        liveCache.set(key, out)
        return out
    } catch (error) {
        return `Couldn't reach Chess.com just now (${error instanceof Error ? error.message : 'network error'}).`
    }
}

export const TOOLS: Tool[] = [
    {
        name: 'search_profile',
        description: 'Look up facts about Teo (work, education, research, projects, skills) to ground an answer.',
        parameters: { query: 'what to look up, e.g. "education" or "current job"' },
        run: async args => {
            // Hybrid (dense + BM25 → RRF → rerank) — the same path the final answer
            // grounds on, so the tool surfaces the strongest facts, not just the
            // bi-encoder's first guess.
            const chunks = await retrieveHybrid(String(args.query ?? ''), 8)
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
    {
        name: 'github_activity',
        description:
            "Fetch Teo's LATEST GitHub activity live (his most recently updated repositories, with dates and stars). Use ONLY for current/recent activity — what Teo is working on now, his newest repos — not for general project questions, which search_profile already covers.",
        parameters: {},
        run: async () => fetchGithubActivity(),
    },
    {
        name: 'chess_stats',
        description:
            "Fetch Teo's CURRENT Chess.com ratings live (rapid, blitz, bullet). Use ONLY when the visitor asks about his present chess rating or how strong he is at chess right now.",
        parameters: {},
        run: async () => fetchChessStats(),
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
