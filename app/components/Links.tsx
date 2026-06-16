'use client'
import { forwardRef, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import QRCodePopover from './QRCodePopover'
import Terminal from './Terminal'
import AskAI, { AskAIChip } from './AskAI'
import { links, type LinkItem } from '../data/profile'

export default function Links() {
    const [termOpen, setTermOpen] = useState(false)
    const [aiOpen, setAiOpen] = useState(false)
    const termChipRef = useRef<HTMLButtonElement>(null)
    const aiChipRef = useRef<HTMLButtonElement>(null)
    // Return focus to the launcher when the panel closes (keyboard accessibility).
    const closeTerm = () => {
        setTermOpen(false)
        termChipRef.current?.focus()
    }
    const closeAi = () => {
        setAiOpen(false)
        aiChipRef.current?.focus()
    }
    return (
        <>
            <ul className="flex flex-wrap gap-2">
                {links.map(link => {
                    // Skip links with no destination, QR, or handle.
                    if (!link.href && !link.qrcode && !link.handle) return null
                    return (
                        <li key={link.label}>
                            <LinkChip link={link} />
                        </li>
                    )
                })}
                {/* Ask AI + Terminal launchers — sit as the last chips, each toggling its panel below. */}
                <li>
                    <AskAIChip ref={aiChipRef} active={aiOpen} onClick={() => setAiOpen(o => !o)} />
                </li>
                <li>
                    <TerminalChip ref={termChipRef} active={termOpen} onClick={() => setTermOpen(o => !o)} />
                </li>
            </ul>
            <AskAI open={aiOpen} onClose={closeAi} />
            <Terminal open={termOpen} onClose={closeTerm} />
        </>
    )
}

const TerminalChip = forwardRef<HTMLButtonElement, { active: boolean; onClick: () => void }>(function TerminalChip(
    { active, onClick },
    ref
) {
    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            aria-expanded={active}
            aria-label={active ? 'Close terminal' : 'Open terminal'}
            title="Toggle interactive terminal"
            className={`group inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 transition hover:-translate-y-0.5 ${
                active
                    ? 'bg-slate-900 text-slate-100 ring-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-300'
                    : 'bg-white text-slate-700 ring-slate-200 hover:ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:ring-slate-600'
            }`}
        >
            <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="m7 9 3 3-3 3" />
                <path d="M13 15h4" />
            </svg>
            <span>Terminal</span>
        </button>
    )
})

function ChipInner({ link }: { link: LinkItem }) {
    return (
        <span className="group inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-slate-300 dark:bg-slate-800 dark:ring-slate-700 dark:hover:ring-slate-600">
            <span
                aria-hidden
                className="link-icon h-4 w-4 shrink-0"
                style={
                    {
                        '--ic': link.color,
                        '--icd': link.colorDark,
                        maskImage: `url(${link.icon})`,
                        WebkitMaskImage: `url(${link.icon})`,
                        maskRepeat: 'no-repeat',
                        WebkitMaskRepeat: 'no-repeat',
                        maskPosition: 'center',
                        WebkitMaskPosition: 'center',
                        maskSize: 'contain',
                        WebkitMaskSize: 'contain',
                    } as CSSProperties
                }
            />
            <span className="text-slate-700 dark:text-slate-200">{link.label}</span>
        </span>
    )
}

function LinkChip({ link }: { link: LinkItem }) {
    const [open, setOpen] = useState(false)
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'showing'>('idle')
    const qrPopoverId = useId()
    const qrWrapRef = useRef<HTMLDivElement>(null)
    const copyResetRef = useRef<number | null>(null)

    useEffect(() => {
        return () => {
            if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
        }
    }, [])

    useEffect(() => {
        if (!open || !link.qrcode) return
        const closeOnOutsidePress = (event: PointerEvent) => {
            if (!qrWrapRef.current?.contains(event.target as Node)) setOpen(false)
        }
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', closeOnOutsidePress)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsidePress)
            document.removeEventListener('keydown', closeOnEscape)
        }
    }, [open, link.qrcode])

    // QR-only link (WeChat): click/tap toggles the code; outside click or Escape closes it.
    if (link.qrcode) {
        return (
            <div ref={qrWrapRef} className="relative inline-block">
                <button
                    type="button"
                    onClick={() => setOpen(current => !current)}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-controls={open ? qrPopoverId : undefined}
                    aria-label={`Show ${link.label} QR code`}
                    title={`${link.label} QR code`}
                    className="cursor-pointer"
                >
                    <ChipInner link={link} />
                </button>
                <QRCodePopover
                    id={qrPopoverId}
                    isOpen={open}
                    qrCodeImg={link.qrcode}
                    label={link.label}
                    onClose={() => setOpen(false)}
                />
            </div>
        )
    }

    // Handle-only link (Discord): copy to clipboard on click.
    if (link.handle) {
        const handle = link.handle
        const copy = async () => {
            if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
            try {
                if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
                await navigator.clipboard.writeText(handle)
                setCopyStatus('copied')
            } catch {
                setCopyStatus('showing')
            }
            copyResetRef.current = window.setTimeout(() => setCopyStatus('idle'), 1800)
        }
        const visibleLink =
            copyStatus === 'copied'
                ? { ...link, label: 'Copied!' }
                : copyStatus === 'showing'
                ? { ...link, label: handle }
                : link
        return (
            <button
                type="button"
                onClick={copy}
                aria-label={`Copy ${link.label} handle ${handle}`}
                title={`${handle} - click to copy`}
                className="cursor-pointer"
            >
                <ChipInner link={visibleLink} />
            </button>
        )
    }

    return (
        <a href={link.href} target="_blank" rel="noopener noreferrer">
            <ChipInner link={link} />
        </a>
    )
}
