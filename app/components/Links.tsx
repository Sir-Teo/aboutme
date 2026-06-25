'use client'
import { forwardRef, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import QRCodePopover from './QRCodePopover'
import Terminal from './Terminal'
import { categories, links, type LinkItem } from '../data/profile'

export default function Links() {
    const [termOpen, setTermOpen] = useState(false)
    const termChipRef = useRef<HTMLButtonElement>(null)
    // Return focus to the launcher when the panel closes (keyboard accessibility).
    const closeTerm = () => {
        setTermOpen(false)
        termChipRef.current?.focus()
    }
    return (
        <>
            {/* overflow-x-clip keeps a right-edge chip's hover card from ever causing a
                horizontal scrollbar, while overflow-y stays visible so cards pop upward. */}
            <div className="space-y-7 overflow-x-clip">
                {/* Chips grouped into a few categories; within each, ordered by rainbow hue. */}
                {categories.map(category => {
                    const items = links.filter(
                        link => link.category === category && (link.href || link.qrcode || link.handle)
                    )
                    if (items.length === 0) return null
                    return (
                        <section key={category} aria-label={category}>
                            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
                                {category}
                            </h2>
                            <ul className="flex flex-wrap gap-2">
                                {items.map(link => (
                                    <li key={link.label}>
                                        <LinkChip link={link} />
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )
                })}
                {/* Assistant launchers — Ask AI links to the full chat page; Terminal opens an in-page panel. */}
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-5 dark:border-slate-800">
                    <AskAIChip />
                    <TerminalChip ref={termChipRef} active={termOpen} onClick={() => setTermOpen(o => !o)} />
                </div>
            </div>
            <Terminal open={termOpen} onClose={closeTerm} />
        </>
    )
}

// Links to the standalone /chat page rather than opening an in-page panel.
function AskAIChip() {
    return (
        <a
            href="/chat"
            aria-label="Open Ask AI chat"
            title="Ask an on-device AI about Teo"
            className="group inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:ring-slate-600"
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
                <path d="M12 3a4 4 0 0 1 4 4 4 4 0 0 1 0 8 4 4 0 0 1-8 0 4 4 0 0 1 0-8 4 4 0 0 1 4-4Z" />
                <path d="M12 7v.01M9 11h6" />
            </svg>
            <span>Ask AI</span>
        </a>
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

// The brand icon as a CSS-mask silhouette tinted to the link's --ic / --icd color.
function IconMask({ link, className = 'h-4 w-4' }: { link: LinkItem; className?: string }) {
    return (
        <span
            aria-hidden
            className={`link-icon shrink-0 ${className}`}
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
    )
}

function ChipInner({ link }: { link: LinkItem }) {
    return (
        <span className="group inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-slate-300 dark:bg-slate-800 dark:ring-slate-700 dark:hover:ring-slate-600">
            <IconMask link={link} />
            <span className="text-slate-700 dark:text-slate-200">{link.label}</span>
        </span>
    )
}

// Hover/focus card that reveals a handle and any public stats (XP, streak, rating…).
// Opens upward, anchored to the chip; the pb-2 acts as a hover bridge so it doesn't flicker.
function StatCard({ link }: { link: LinkItem }) {
    return (
        <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-0 z-20 translate-y-1 pb-2 opacity-0 transition duration-150 ease-out group-hover/chip:pointer-events-auto group-hover/chip:translate-y-0 group-hover/chip:opacity-100 group-focus-within/chip:pointer-events-auto group-focus-within/chip:translate-y-0 group-focus-within/chip:opacity-100"
        >
            <div className="w-max max-w-[15rem] rounded-xl bg-white/95 p-3 text-left shadow-lg ring-1 ring-slate-200 backdrop-blur dark:bg-slate-800/95 dark:ring-slate-700">
                <div className="flex items-center gap-2">
                    <IconMask link={link} className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{link.label}</span>
                </div>
                {link.meta && (
                    <p className="mt-0.5 break-words text-xs text-slate-400 dark:text-slate-500">{link.meta}</p>
                )}
                {link.stats && link.stats.length > 0 && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {link.stats.map(stat => (
                            <div key={stat.label} className="flex flex-col">
                                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                    {stat.label}
                                </dt>
                                <dd className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                                    {stat.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        </div>
    )
}

function LinkChip({ link }: { link: LinkItem }) {
    const [open, setOpen] = useState(false)
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'showing'>('idle')
    const qrPopoverId = useId()
    const qrWrapRef = useRef<HTMLDivElement>(null)
    const copyResetRef = useRef<number | null>(null)
    // Standard links get a hover/focus stats card; QR chips own their click popover instead.
    const showCard = !link.qrcode && Boolean(link.meta || link.stats?.length)

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
            <div className="group/chip relative inline-block">
                <button
                    type="button"
                    onClick={copy}
                    aria-label={`Copy ${link.label} handle ${handle}`}
                    title={`${handle} - click to copy`}
                    className="cursor-pointer"
                >
                    <ChipInner link={visibleLink} />
                </button>
                {showCard && <StatCard link={link} />}
            </div>
        )
    }

    return (
        <div className="group/chip relative inline-block">
            <a href={link.href} target="_blank" rel="noopener noreferrer">
                <ChipInner link={link} />
            </a>
            {showCard && <StatCard link={link} />}
        </div>
    )
}
