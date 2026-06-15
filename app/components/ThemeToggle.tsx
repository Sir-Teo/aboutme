'use client'
import { useEffect, useState } from 'react'

// Three themes cycle on click: light → dark → pride. The `dark`/`pride` classes
// on <html> drive styling (Tailwind's dark: variant + custom rules in globals.css).
// The initial theme is applied before paint by the inline script in app/layout.tsx.
type Theme = 'light' | 'dark' | 'pride'
const ORDER: Theme[] = ['light', 'dark', 'pride']
const LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', pride: 'Pride' }

function readTheme(): Theme {
    const c = document.documentElement.classList
    if (c.contains('dark')) return 'dark'
    if (c.contains('pride')) return 'pride'
    return 'light'
}

function applyTheme(theme: Theme) {
    const c = document.documentElement.classList
    c.remove('dark', 'pride')
    if (theme !== 'light') c.add(theme)
    try {
        localStorage.setItem('theme', theme)
    } catch (e) {}
}

export default function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>('light')

    useEffect(() => {
        setTheme(readTheme())
    }, [])

    const cycle = () => {
        const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
        applyTheme(next)
        setTheme(next)
    }

    return (
        <button
            type="button"
            onClick={cycle}
            aria-label={`Theme: ${LABELS[theme]}. Click to switch.`}
            title={`${LABELS[theme]} theme — click to switch`}
            className="fixed right-4 top-4 z-50 grid h-9 w-9 place-items-center rounded-full bg-white/70 ring-1 ring-slate-200 backdrop-blur transition hover:ring-slate-300 dark:bg-slate-800/70 dark:ring-slate-700 dark:hover:ring-slate-600"
        >
            {theme === 'dark' ? <MoonIcon /> : theme === 'pride' ? <RainbowIcon /> : <SunIcon />}
        </button>
    )
}

function SunIcon() {
    return (
        <svg viewBox="0 0 24 24" role="img" aria-hidden className="h-5 w-5">
            <defs>
                <radialGradient id="sunCore" cx="50%" cy="45%" r="60%">
                    <stop offset="0%" stopColor="#fde68a" />
                    <stop offset="100%" stopColor="#f59e0b" />
                </radialGradient>
            </defs>
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
            <circle cx="12" cy="12" r="4.6" fill="url(#sunCore)" />
        </svg>
    )
}

function MoonIcon() {
    return (
        <svg viewBox="0 0 24 24" role="img" aria-hidden className="h-5 w-5">
            <defs>
                <linearGradient id="moonGrad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#e0e7ff" />
                    <stop offset="100%" stopColor="#818cf8" />
                </linearGradient>
            </defs>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="url(#moonGrad)" />
            <circle cx="16.5" cy="6.2" r="0.8" fill="#fcd34d" />
            <circle cx="19.4" cy="9.6" r="0.5" fill="#fde68a" />
        </svg>
    )
}

// Six concentric arcs in the pride flag colors, drawn outer → inner.
function RainbowIcon() {
    const arcs: Array<[string, number]> = [
        ['#e40303', 9.4],
        ['#ff8c00', 7.9],
        ['#ffed00', 6.4],
        ['#008026', 4.9],
        ['#004dff', 3.4],
        ['#750787', 1.9],
    ]
    const cy = 18
    return (
        <svg viewBox="0 0 24 24" role="img" aria-hidden className="h-5 w-5" fill="none" strokeLinecap="round">
            {arcs.map(([color, r]) => (
                <path
                    key={color}
                    d={`M${12 - r} ${cy} A${r} ${r} 0 0 1 ${12 + r} ${cy}`}
                    stroke={color}
                    strokeWidth="1.4"
                />
            ))}
        </svg>
    )
}
