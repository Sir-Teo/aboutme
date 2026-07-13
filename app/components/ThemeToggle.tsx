'use client'
import { useEffect, useRef, useState } from 'react'
import { litMoonPath, moonPhase, moonPhaseName } from './moon'

// Two themes toggle on click: light ↔ dark. The `dark` class on <html> drives
// styling (Tailwind's dark: variant). The initial theme is applied before paint
// by the inline script in app/layout.tsx.
//
// Two easter eggs live here:
//  - The moon icon shows the actual current lunar phase (see moon.ts).
//  - Toggling rapidly triggers a brief solar eclipse: the moon slides across
//    the sun while the page dips through totality, then everything settles on
//    whatever theme the last click chose. Purely transient — nothing persists.
type Theme = 'light' | 'dark'
const LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark' }

const ECLIPSE_CLICKS = 5
const ECLIPSE_WINDOW_MS = 2000
const ECLIPSE_DURATION_MS = 2600

function readTheme(): Theme {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
    const c = document.documentElement.classList
    c.toggle('dark', theme === 'dark')
    c.remove('pride') // drop any legacy pride class
    try {
        localStorage.setItem('theme', theme)
    } catch {}
}

export default function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>('light')
    const [phase, setPhase] = useState(0.5) // full moon until mounted (avoids hydration mismatch)
    const [eclipsing, setEclipsing] = useState(false)
    const clicksRef = useRef<number[]>([])
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(() => {
        setTheme(readTheme())
        setPhase(moonPhase(new Date()))
        return () => clearTimeout(timerRef.current)
    }, [])

    const cycle = () => {
        if (eclipsing) return
        const next: Theme = theme === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        setTheme(next)

        const now = Date.now()
        clicksRef.current = [...clicksRef.current.filter(t => now - t < ECLIPSE_WINDOW_MS), now]
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (clicksRef.current.length >= ECLIPSE_CLICKS && !reducedMotion) {
            clicksRef.current = []
            setEclipsing(true)
            timerRef.current = setTimeout(() => setEclipsing(false), ECLIPSE_DURATION_MS)
        }
    }

    const title =
        theme === 'dark'
            ? `Dark theme (${moonPhaseName(phase)}) — click to switch`
            : `${LABELS[theme]} theme — click to switch`

    return (
        <>
            {eclipsing && <div aria-hidden className="eclipse-overlay fixed inset-0 z-40" />}
            <button
                type="button"
                onClick={cycle}
                aria-label={`Theme: ${LABELS[theme]}. Click to switch.`}
                title={title}
                className={`fixed right-4 top-4 z-50 grid h-9 w-9 place-items-center rounded-full bg-white/70 ring-1 ring-slate-200 backdrop-blur transition hover:ring-slate-300 dark:bg-slate-800/70 dark:ring-slate-700 dark:hover:ring-slate-600 ${
                    eclipsing ? 'shadow-[0_0_28px_6px_rgba(129,140,248,0.45)]' : ''
                }`}
            >
                {eclipsing ? <EclipseIcon /> : theme === 'dark' ? <MoonIcon phase={phase} /> : <SunIcon />}
            </button>
        </>
    )
}

function SunRays() {
    return (
        <g stroke="#f59e0b" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="2" x2="12" y2="4.4" />
            <line x1="12" y1="19.6" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4.4" y2="12" />
            <line x1="19.6" y1="12" x2="22" y2="12" />
            <line x1="4.9" y1="4.9" x2="6.6" y2="6.6" />
            <line x1="17.4" y1="17.4" x2="19.1" y2="19.1" />
            <line x1="4.9" y1="19.1" x2="6.6" y2="17.4" />
            <line x1="17.4" y1="6.6" x2="19.1" y2="4.9" />
        </g>
    )
}

function SunIcon() {
    return (
        <svg viewBox="0 0 24 24" role="img" aria-hidden className="h-5 w-5">
            <defs>
                <radialGradient id="theme-toggle-sun-core" cx="50%" cy="45%" r="60%">
                    <stop offset="0%" stopColor="#fde68a" />
                    <stop offset="100%" stopColor="#f59e0b" />
                </radialGradient>
            </defs>
            <SunRays />
            <circle cx="12" cy="12" r="4.6" fill="url(#theme-toggle-sun-core)" />
        </svg>
    )
}

function MoonIcon({ phase }: { phase: number }) {
    return (
        <svg viewBox="0 0 24 24" role="img" aria-hidden className="h-5 w-5">
            <defs>
                <linearGradient
                    id="theme-toggle-moon-grad"
                    x1="3"
                    y1="3"
                    x2="21"
                    y2="21"
                    gradientUnits="userSpaceOnUse"
                >
                    <stop offset="0%" stopColor="#e0e7ff" />
                    <stop offset="100%" stopColor="#818cf8" />
                </linearGradient>
            </defs>
            {/* Shadowed disc, then the sunlit portion for today's phase on top. */}
            <circle cx="12" cy="12" r="8" fill="#334155" stroke="#475569" strokeWidth="0.75" />
            <path d={litMoonPath(phase, 12, 12, 8)} fill="url(#theme-toggle-moon-grad)" />
            <circle cx="9.5" cy="10" r="1.3" fill="#1e293b" fillOpacity="0.18" />
            <circle cx="14" cy="14.5" r="0.9" fill="#1e293b" fillOpacity="0.18" />
        </svg>
    )
}

function EclipseIcon() {
    return (
        <svg viewBox="0 0 24 24" role="img" aria-hidden className="h-5 w-5 overflow-visible">
            <defs>
                <radialGradient id="theme-toggle-eclipse-core" cx="50%" cy="45%" r="60%">
                    <stop offset="0%" stopColor="#fde68a" />
                    <stop offset="100%" stopColor="#f59e0b" />
                </radialGradient>
            </defs>
            <SunRays />
            <circle cx="12" cy="12" r="4.6" fill="url(#theme-toggle-eclipse-core)" />
            <circle className="eclipse-corona" cx="12" cy="12" r="5.6" fill="none" stroke="#c7d2fe" strokeWidth="1.5" />
            <circle className="eclipse-moon" cx="12" cy="12" r="5" fill="#1e1b4b" />
        </svg>
    )
}
