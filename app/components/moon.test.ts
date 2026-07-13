import { describe, expect, it } from 'vitest'
import { litMoonPath, moonPhase, moonPhaseName } from './moon'

describe('moonPhase', () => {
    it('is ~0 at the epoch new moon', () => {
        const p = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)))
        expect(p).toBeLessThan(0.01)
    })

    it('is ~0.5 at a known full moon (2026-07-29)', () => {
        // Full moon on 2026-07-29 ~14:36 UTC per almanac tables.
        const p = moonPhase(new Date(Date.UTC(2026, 6, 29, 14, 36)))
        expect(Math.abs(p - 0.5)).toBeLessThan(0.02)
    })

    it('is ~0 at a known new moon far from the epoch (2026-07-14)', () => {
        // New moon on 2026-07-14 ~09:44 UTC.
        const p = moonPhase(new Date(Date.UTC(2026, 6, 14, 9, 44)))
        const dist = Math.min(p, 1 - p)
        expect(dist).toBeLessThan(0.02)
    })

    it('stays in [0, 1) for dates before the epoch', () => {
        const p = moonPhase(new Date(Date.UTC(1969, 6, 20)))
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThan(1)
    })
})

describe('moonPhaseName', () => {
    it('names the cardinal phases', () => {
        expect(moonPhaseName(0)).toBe('new moon')
        expect(moonPhaseName(0.25)).toBe('first quarter')
        expect(moonPhaseName(0.5)).toBe('full moon')
        expect(moonPhaseName(0.75)).toBe('last quarter')
        expect(moonPhaseName(0.999)).toBe('new moon')
    })
})

describe('litMoonPath', () => {
    it('lights the full disc at full moon (both arcs at radius r)', () => {
        expect(litMoonPath(0.5, 12, 12, 8)).toBe('M12 4 A8 8 0 0 0 12 20 A8 8 0 0 0 12 4 Z')
    })

    it('keeps the terminator semi-axis positive at the quarters', () => {
        // cos(2π·0.25) = 0 exactly; the arc rx must stay valid (> 0).
        expect(litMoonPath(0.25, 12, 12, 8)).toContain('A0.05 8')
    })

    it('lights the right limb when waxing and the left when waning', () => {
        expect(litMoonPath(0.1, 12, 12, 8)).toContain('A8 8 0 0 1 12 20') // right semicircle
        expect(litMoonPath(0.9, 12, 12, 8)).toContain('A8 8 0 0 0 12 20') // left semicircle
    })
})
