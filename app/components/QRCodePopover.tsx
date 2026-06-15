'use client'

interface QRCodePopoverProps {
    id: string
    isOpen: boolean
    qrCodeImg: string
    label: string
    onClose: () => void
}

const QRCodePopover = ({ id, isOpen, qrCodeImg, label, onClose }: QRCodePopoverProps) => {
    if (!isOpen) return null
    if (!qrCodeImg) return null
    return (
        <div
            id={id}
            role="dialog"
            aria-label={`${label} QR code`}
            className="fixed left-1/2 top-1/2 z-50 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-3 shadow-xl ring-1 ring-slate-200 sm:absolute sm:left-1/2 sm:top-full sm:mt-2 sm:w-56 sm:-translate-x-1/2 sm:translate-y-0 dark:ring-slate-700"
        >
            <button
                type="button"
                onClick={onClose}
                aria-label={`Close ${label} QR code`}
                className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white/90 text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900 dark:ring-slate-700"
            >
                <svg
                    viewBox="0 0 24 24"
                    aria-hidden
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                >
                    <path d="M6 6l12 12M18 6 6 18" />
                </svg>
            </button>
            <img src={qrCodeImg} alt={`${label} QR code`} className="block w-full rounded-lg" />
        </div>
    )
}

export default QRCodePopover
