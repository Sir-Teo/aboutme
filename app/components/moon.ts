// Lunar phase math for the theme toggle's moon icon.
// Phase is a fraction of the synodic month: 0 = new moon, 0.5 = full, →1 new again.

const SYNODIC_DAYS = 29.53058867
// A known new moon: 2000-01-06 18:14 UTC. Good to within a few hours for
// decades either side, which is plenty for a 20px icon.
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14)

export function moonPhase(date: Date): number {
    const days = (date.getTime() - NEW_MOON_EPOCH_MS) / 86_400_000
    const cycles = days / SYNODIC_DAYS
    return cycles - Math.floor(cycles)
}

export function moonPhaseName(phase: number): string {
    const names = [
        'new moon',
        'waxing crescent',
        'first quarter',
        'waxing gibbous',
        'full moon',
        'waning gibbous',
        'last quarter',
        'waning crescent',
    ]
    // Center each of the 8 buckets on its named instant (new = phase 0 ± 1/16).
    return names[Math.floor(((phase + 1 / 16) % 1) * 8)]
}

// SVG path for the sunlit part of a moon disc of radius r centered at (cx, cy).
// One semicircle along the lit limb, then back along the terminator — a
// half-ellipse whose semi-minor axis shrinks to 0 at the quarters.
export function litMoonPath(phase: number, cx: number, cy: number, r: number): string {
    const w = Math.cos(2 * Math.PI * phase) // +1 new → −1 full → +1 new
    const rx = Math.max(0.05, Math.abs(w) * r)
    const waxing = phase < 0.5
    const limbSweep = waxing ? 1 : 0 // lit limb: right when waxing, left when waning
    const termSweep = waxing === w > 0 ? 0 : 1 // terminator bows toward the darker side
    const top = `${cx} ${cy - r}`
    const bottom = `${cx} ${cy + r}`
    return `M${top} A${r} ${r} 0 0 ${limbSweep} ${bottom} A${rx} ${r} 0 0 ${termSweep} ${top} Z`
}
