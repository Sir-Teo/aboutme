import './globals.css'
import type { Metadata } from 'next'
import ThemeToggle from './components/ThemeToggle'

export const metadata: Metadata = {
    title: 'Teo Zeng',
    description: 'Teo Zeng — data scientist and machine-learning researcher in New York.',
}

// Applies the saved (or system) theme before first paint to avoid a flash.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var c=document.documentElement.classList;if(t==='dark'||(!t&&m)){c.add('dark')}else if(t==='pride'){c.add('pride')}}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeInit }} />
            </head>
            <body className="bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
                <ThemeToggle />
                {children}
            </body>
        </html>
    )
}
