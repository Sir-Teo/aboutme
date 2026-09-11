import { ImageResponse } from 'next/og'
import { profile } from './data/profile'

// The link-preview card. Generated once at build time and emitted as a static
// PNG by the export, so it costs nothing at runtime. Deliberately typographic —
// same restraint as the page itself.
// `output: export` requires metadata routes to opt in to static generation.
export const dynamic = 'force-static'

export const alt = `${profile.name} — ${profile.jobTitle}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    background: '#ffffff',
                    padding: '80px',
                }}
            >
                <div style={{ display: 'flex', fontSize: 92, fontWeight: 600, color: '#0f172a', letterSpacing: -2 }}>
                    {profile.name}
                </div>
                <div style={{ display: 'flex', marginTop: 20, fontSize: 36, color: '#64748b' }}>
                    {profile.jobTitle} · {profile.location}
                </div>
                <div style={{ display: 'flex', width: '100%', height: 1, background: '#e2e8f0', margin: '44px 0 0' }} />
                <div style={{ display: 'flex', marginTop: 28, fontSize: 28, color: '#94a3b8' }}>
                    {profile.url.replace('https://', '')}
                </div>
            </div>
        ),
        size
    )
}
