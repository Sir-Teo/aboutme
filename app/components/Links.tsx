'use client'
import { useState, type CSSProperties } from 'react'
import QRCodePopover from './QRCodePopover'
import { links, type LinkItem } from '../data/profile'

export default function Links() {
    return (
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
        </ul>
    )
}

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
    const [copied, setCopied] = useState(false)

    // QR-only link (WeChat): show the code on hover.
    if (link.qrcode) {
        return (
            <div
                className="relative cursor-pointer"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
            >
                <ChipInner link={link} />
                <QRCodePopover isOpen={open} qrCodeImg={link.qrcode} />
            </div>
        )
    }

    // Handle-only link (Discord): copy to clipboard on click.
    if (link.handle) {
        const copy = () => {
            navigator.clipboard?.writeText(link.handle as string).catch(() => {})
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
        }
        return (
            <button
                type="button"
                onClick={copy}
                aria-label={`Copy ${link.label} handle ${link.handle}`}
                title={`${link.handle} — click to copy`}
                className="cursor-pointer"
            >
                <ChipInner link={copied ? { ...link, label: 'Copied!' } : link} />
            </button>
        )
    }

    return (
        <a href={link.href} target="_blank" rel="noreferrer">
            <ChipInner link={link} />
        </a>
    )
}
