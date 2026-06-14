'use client'
import { useEffect, useState } from 'react'

// Toggles the `dark` class on <html> and persists the choice. The initial
// theme is applied before paint by the inline script in app/layout.tsx.
export default function ThemeToggle() {
    const [dark, setDark] = useState(false)

    useEffect(() => {
        setDark(document.documentElement.classList.contains('dark'))
    }, [])

    const toggle = () => {
        const next = !document.documentElement.classList.contains('dark')
        document.documentElement.classList.toggle('dark', next)
        try {
            localStorage.setItem('theme', next ? 'dark' : 'light')
        } catch (e) {}
        setDark(next)
    }

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label="Toggle dark mode"
            className="fixed right-4 top-4 z-50 grid h-9 w-9 place-items-center rounded-full bg-white/70 text-base leading-none ring-1 ring-slate-200 backdrop-blur transition hover:ring-slate-300 dark:bg-slate-800/70 dark:ring-slate-700 dark:hover:ring-slate-600"
        >
            {dark ? '☀️' : '🌙'}
        </button>
    )
}
