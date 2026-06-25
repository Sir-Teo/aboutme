'use client'
import {
    forwardRef,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type RefCallback,
    type RefObject,
} from 'react'
import QRCodePopover from './QRCodePopover'
import Terminal from './Terminal'
import { categories, links, type LinkItem } from '../data/profile'

// Keyboard focus ring shared by every chip so tab-navigation is clearly visible
// without affecting the resting (mouse) look.
const FOCUS_RING =
    'rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-slate-950'

// True when the primary pointer can hover (a desktop mouse). On touch devices it
// is false, so the stat cards switch from hover-reveal to tap-reveal.
function useCanHover() {
    const [canHover, setCanHover] = useState(true)
    useEffect(() => {
        const mq = window.matchMedia('(hover: hover)')
        const update = () => setCanHover(mq.matches)
        update()
        mq.addEventListener('change', update)
        return () => mq.removeEventListener('change', update)
    }, [])
    return canHover
}

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
            <div className="space-y-3 sm:space-y-6">
                {/* Chips grouped into a few categories; within each, ordered by rainbow hue. */}
                {categories.map(category => {
                    const items = links.filter(
                        link => link.category === category && (link.href || link.qrcode || link.handle)
                    )
                    if (items.length === 0) return null
                    return (
                        <section key={category} aria-label={category}>
                            <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 sm:mb-2">
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
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2 dark:border-slate-800 sm:pt-4">
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
            className="group inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] text-slate-700 ring-1 ring-slate-200 transition active:scale-[0.97] hover:ring-slate-300 motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:ring-slate-600 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-slate-950 sm:min-h-0 sm:gap-2 sm:text-sm"
        >
            <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4"
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
            className={`group inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] ring-1 transition active:scale-[0.97] motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-slate-950 sm:min-h-0 sm:gap-2 sm:text-sm ${
                active
                    ? 'bg-slate-900 text-slate-100 ring-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-300'
                    : 'bg-white text-slate-700 ring-slate-200 hover:ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:ring-slate-600'
            }`}
        >
            <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4"
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
        <span className="group inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] ring-1 ring-slate-200 transition active:scale-[0.97] hover:ring-slate-300 motion-safe:hover:-translate-y-0.5 dark:bg-slate-800 dark:ring-slate-700 dark:hover:ring-slate-600 sm:min-h-0 sm:gap-2 sm:text-sm">
            <IconMask link={link} className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="text-slate-700 dark:text-slate-200">{link.label}</span>
        </span>
    )
}

type TooltipPosition = {
    left: number
    top: number
}

// Hover/focus card that reveals a handle and any public stats (XP, streak, rating...).
// On touch (`interactive`) it becomes tappable and shows a Visit action.
function StatCard({
    link,
    triggerRef,
    id,
    interactive = false,
    actionHref,
}: {
    link: LinkItem
    triggerRef: RefObject<HTMLElement | null>
    id: string
    interactive?: boolean
    actionHref?: string
}) {
    const cardRef = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState<TooltipPosition | null>(null)

    useLayoutEffect(() => {
        const updatePosition = () => {
            const trigger = triggerRef.current
            const card = cardRef.current
            if (!trigger || !card) return

            const triggerRect = trigger.getBoundingClientRect()
            const cardRect = card.getBoundingClientRect()
            const margin = 12
            const gap = 8
            const availableWidth = Math.max(0, window.innerWidth - margin * 2)
            const cardWidth = Math.min(cardRect.width || 240, availableWidth)
            const cardHeight = cardRect.height || 120
            const preferredTop = triggerRect.top - cardHeight - gap
            const opensAbove = preferredTop >= margin
            const top = opensAbove
                ? preferredTop
                : Math.min(triggerRect.bottom + gap, window.innerHeight - cardHeight - margin)
            const centeredLeft = triggerRect.left + triggerRect.width / 2 - cardWidth / 2
            const left = Math.min(Math.max(centeredLeft, margin), window.innerWidth - cardWidth - margin)

            setPosition({ left, top: Math.max(margin, top) })
        }

        updatePosition()
        const frame = window.requestAnimationFrame(updatePosition)
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition, true)

        return () => {
            window.cancelAnimationFrame(frame)
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition, true)
        }
    }, [triggerRef])

    return (
        <div
            id={id}
            ref={cardRef}
            role="tooltip"
            style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                maxWidth: 'min(16rem, calc(100vw - 1.5rem))',
                visibility: position ? 'visible' : 'hidden',
            }}
            className={`fixed z-50 transition duration-150 ease-out ${interactive ? '' : 'pointer-events-none'} ${
                position ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
            }`}
        >
            <div className="w-max min-w-40 rounded-lg bg-white/95 p-3 text-left shadow-lg ring-1 ring-slate-200 backdrop-blur dark:bg-slate-800/95 dark:ring-slate-700">
                <div className="flex items-center gap-2">
                    <IconMask link={link} className="h-3.5 w-3.5" />
                    <span className="min-w-0 break-words text-sm font-medium text-slate-800 dark:text-slate-100">
                        {link.label}
                    </span>
                </div>
                {link.meta && (
                    <p className="mt-0.5 break-words text-xs text-slate-400 dark:text-slate-500">{link.meta}</p>
                )}
                {link.stats && link.stats.length > 0 && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {link.stats.map(stat => (
                            <div key={stat.label} className="flex min-w-0 flex-col">
                                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                    {stat.label}
                                </dt>
                                <dd className="break-words text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                                    {stat.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                )}
                {actionHref && (
                    <a
                        href={actionHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                        Visit
                        <span aria-hidden>↗</span>
                    </a>
                )}
            </div>
        </div>
    )
}

function LinkChip({ link }: { link: LinkItem }) {
    const [qrOpen, setQrOpen] = useState(false)
    const [cardOpen, setCardOpen] = useState(false)
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'showing'>('idle')
    const qrPopoverId = useId()
    const statCardId = useId()
    const qrWrapRef = useRef<HTMLDivElement>(null)
    const wrapRef = useRef<HTMLDivElement>(null)
    const triggerRef = useRef<HTMLElement | null>(null)
    const copyResetRef = useRef<number | null>(null)
    const canHover = useCanHover()
    // Standard links get a hover/focus stats card; QR chips own their click popover instead.
    const showCard = !link.qrcode && Boolean(link.meta || link.stats?.length)
    const setTriggerRef: RefCallback<HTMLElement> = node => {
        triggerRef.current = node
    }
    // Hover devices: pointer enter/leave drives the card. Touch devices: it is
    // tap-to-open (handled in onClick below) and closed by an outside tap / Escape.
    // Focus opens the card everywhere so keyboard users get it too.
    const triggerCardProps = showCard
        ? {
              'aria-describedby': cardOpen ? statCardId : undefined,
              onFocus: () => setCardOpen(true),
              ...(canHover
                  ? {
                        onBlur: () => setCardOpen(false),
                        onPointerEnter: () => setCardOpen(true),
                        onPointerLeave: () => setCardOpen(false),
                    }
                  : {}),
          }
        : {}

    useEffect(() => {
        return () => {
            if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
        }
    }, [])

    // On touch, a tapped-open stat card is dismissed by tapping outside it or Escape.
    useEffect(() => {
        if (canHover || !cardOpen) return
        const closeOnOutsidePress = (event: PointerEvent) => {
            if (!wrapRef.current?.contains(event.target as Node)) setCardOpen(false)
        }
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setCardOpen(false)
        }
        document.addEventListener('pointerdown', closeOnOutsidePress)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsidePress)
            document.removeEventListener('keydown', closeOnEscape)
        }
    }, [canHover, cardOpen])

    useEffect(() => {
        if (!qrOpen || !link.qrcode) return
        const closeOnOutsidePress = (event: PointerEvent) => {
            if (!qrWrapRef.current?.contains(event.target as Node)) setQrOpen(false)
        }
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setQrOpen(false)
        }
        document.addEventListener('pointerdown', closeOnOutsidePress)
        document.addEventListener('keydown', closeOnEscape)
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsidePress)
            document.removeEventListener('keydown', closeOnEscape)
        }
    }, [qrOpen, link.qrcode])

    // QR-only link (WeChat): click/tap toggles the code; outside click or Escape closes it.
    if (link.qrcode) {
        return (
            <div ref={qrWrapRef} className="relative inline-block">
                <button
                    type="button"
                    onClick={() => setQrOpen(current => !current)}
                    aria-haspopup="dialog"
                    aria-expanded={qrOpen}
                    aria-controls={qrOpen ? qrPopoverId : undefined}
                    aria-label={`Show ${link.label} QR code`}
                    title={`${link.label} QR code`}
                    className={`inline-flex cursor-pointer ${FOCUS_RING}`}
                >
                    <ChipInner link={link} />
                </button>
                <QRCodePopover
                    id={qrPopoverId}
                    isOpen={qrOpen}
                    qrCodeImg={link.qrcode}
                    label={link.label}
                    onClose={() => setQrOpen(false)}
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
            <div ref={wrapRef} className="relative inline-block">
                <button
                    ref={setTriggerRef}
                    type="button"
                    onClick={copy}
                    aria-label={`Copy ${link.label} handle ${handle}`}
                    title={`${handle} - click to copy`}
                    className={`inline-flex cursor-pointer ${FOCUS_RING}`}
                    {...triggerCardProps}
                >
                    <ChipInner link={visibleLink} />
                </button>
                {showCard && cardOpen && (
                    <StatCard id={statCardId} triggerRef={triggerRef} link={link} interactive={!canHover} />
                )}
            </div>
        )
    }

    return (
        <div ref={wrapRef} className="relative inline-block">
            <a
                ref={setTriggerRef}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex ${FOCUS_RING}`}
                // On touch, the first tap reveals the stat card instead of navigating;
                // a second tap (or the card's Visit action) then follows the link.
                onClick={event => {
                    if (!canHover && showCard && !cardOpen) {
                        event.preventDefault()
                        setCardOpen(true)
                    }
                }}
                {...triggerCardProps}
            >
                <ChipInner link={link} />
            </a>
            {showCard && cardOpen && (
                <StatCard
                    id={statCardId}
                    triggerRef={triggerRef}
                    link={link}
                    interactive={!canHover}
                    actionHref={!canHover ? link.href : undefined}
                />
            )}
        </div>
    )
}
