import './globals.css'
import type { Metadata } from 'next'
import ThemeProvider from './theme-provider'

export const metadata: Metadata = {
    title: 'Teo Zeng',
    description: 'Teo Zeng\'s personal website',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body className={''}>
                <ThemeProvider>{children}</ThemeProvider>
            </body>
        </html>
    )
}
