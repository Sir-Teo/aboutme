// Live-data tool tests. github_activity / chess_stats hit public CORS APIs at
// runtime, so correctness hinges on response parsing, failure tolerance, and the
// per-session cache. We mock global.fetch for deterministic coverage of every
// branch (vi.resetModules() gives each case a fresh module-level cache), and add
// an opt-in real-network smoke test (RUN_LIVE=1) for the genuine data path.

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Tool, ToolContext } from './tools'

const ctx: ToolContext = { openLink: () => null, navigate: () => false, setTheme: () => false }

// Fresh module each call → fresh liveCache, so cache state never leaks between cases.
async function freshTool(name: string): Promise<Tool> {
    vi.resetModules()
    const { availableTools } = await import('./tools')
    const tool = availableTools(ctx).find(t => t.name === name)
    if (!tool) throw new Error(`tool ${name} not found`)
    return tool
}

function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as unknown as Response
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('github_activity tool', () => {
    it('summarizes the most recent repos on success', async () => {
        global.fetch = vi.fn(async () =>
            jsonResponse([
                {
                    name: 'web-katrain',
                    language: 'TypeScript',
                    stargazers_count: 18,
                    pushed_at: '2026-06-19T00:00:00Z',
                    description: 'Go analysis',
                },
                {
                    name: 'aboutme',
                    language: 'TypeScript',
                    stargazers_count: 3,
                    pushed_at: '2026-06-21T00:00:00Z',
                    description: 'site',
                },
            ])
        ) as any
        const out = await (await freshTool('github_activity')).run({}, ctx)
        expect(out).toContain('most recently updated')
        expect(out).toContain('web-katrain')
        expect(out).toContain('18★')
        expect(out).toContain('2026-06-19')
        // The request is time-boxed via an AbortController signal.
        expect((global.fetch as any).mock.calls[0][1]).toHaveProperty('signal')
    })

    it('handles an empty repo list', async () => {
        global.fetch = vi.fn(async () => jsonResponse([])) as any
        expect(await (await freshTool('github_activity')).run({}, ctx)).toMatch(/No recent GitHub activity/)
    })

    it('degrades gracefully on an HTTP error', async () => {
        global.fetch = vi.fn(async () => jsonResponse({}, false, 403)) as any
        expect(await (await freshTool('github_activity')).run({}, ctx)).toMatch(/Couldn't reach GitHub.*403/)
    })

    it('degrades gracefully when the network throws', async () => {
        global.fetch = vi.fn(async () => {
            throw new Error('network down')
        }) as any
        expect(await (await freshTool('github_activity')).run({}, ctx)).toMatch(/Couldn't reach GitHub.*network down/)
    })

    it('caches within a session (second call does not re-fetch)', async () => {
        const fetchMock = vi.fn(async () =>
            jsonResponse([
                {
                    name: 'mica',
                    language: 'Rust',
                    stargazers_count: 6,
                    pushed_at: '2025-10-05T00:00:00Z',
                    description: 'lang',
                },
            ])
        )
        global.fetch = fetchMock as any
        const tool = await freshTool('github_activity')
        const a = await tool.run({}, ctx)
        const b = await tool.run({}, ctx)
        expect(a).toBe(b)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

describe('chess_stats tool', () => {
    it('reports available ratings and omits missing ones', async () => {
        // Mirrors the real account: rapid + blitz present, bullet absent.
        global.fetch = vi.fn(async () =>
            jsonResponse({ chess_rapid: { last: { rating: 198 } }, chess_blitz: { last: { rating: 427 } } })
        ) as any
        const out = await (await freshTool('chess_stats')).run({}, ctx)
        expect(out).toContain('Rapid 198')
        expect(out).toContain('Blitz 427')
        expect(out).not.toContain('Bullet')
        expect(out).toContain('masterteo1205')
    })

    it('handles a profile with no rated games', async () => {
        global.fetch = vi.fn(async () => jsonResponse({})) as any
        expect(await (await freshTool('chess_stats')).run({}, ctx)).toMatch(/No current Chess.com ratings/)
    })

    it('degrades gracefully on network failure', async () => {
        global.fetch = vi.fn(async () => {
            throw new Error('timeout')
        }) as any
        expect(await (await freshTool('chess_stats')).run({}, ctx)).toMatch(/Couldn't reach Chess.com.*timeout/)
    })
})

// Opt-in: exercises the genuine endpoints (network required). RUN_LIVE=1 npm test
const live = process.env.RUN_LIVE ? describe : describe.skip
live('live network (real APIs)', () => {
    it("github_activity returns Teo's real recent repos", async () => {
        const out = await (await freshTool('github_activity')).run({}, ctx)
        expect(out).toMatch(/GitHub repositor|Couldn't reach GitHub/)
        if (!out.startsWith("Couldn't")) expect(out).toMatch(/★/)
    }, 15000)

    it('chess_stats returns a real rating line', async () => {
        const out = await (await freshTool('chess_stats')).run({}, ctx)
        expect(out).toMatch(/Chess.com ratings|No current Chess.com|Couldn't reach Chess.com/)
    }, 15000)
})
