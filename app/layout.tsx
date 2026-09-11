import './globals.css'
import type { Metadata, Viewport } from 'next'
import ThemeToggle from './components/ThemeToggle'
import { profile } from './data/profile'

export const metadata: Metadata = {
    metadataBase: new URL(profile.url),
    title: profile.name,
    description: profile.description,
    alternates: { canonical: '/' },
    // The card shown when the site is pasted into Slack, iMessage, LinkedIn, X...
    // The image itself comes from app/opengraph-image.tsx by file convention.
    openGraph: {
        type: 'profile',
        url: profile.url,
        siteName: profile.name,
        title: profile.name,
        description: profile.description,
    },
    twitter: {
        card: 'summary_large_image',
        title: profile.name,
        description: profile.description,
    },
}

// Matches the body background in each theme so mobile browser chrome blends in.
export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#020617' },
    ],
}

// Applies the saved (or system) theme before first paint to avoid a flash.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&m)){document.documentElement.classList.add('dark')}}catch(e){}})();`

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
