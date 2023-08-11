'use client'
import { Popover } from '@headlessui/react'

interface QRCodePopoverProps {
    isOpen: boolean
    qrCodeImg: string
}

const QRCodePopover = ({ isOpen, qrCodeImg }: QRCodePopoverProps) => {
    if (!isOpen) return null
    if (!qrCodeImg) return null
    return (
        <Popover className="relative top-1">
            <Popover.Panel
                static
                className={`absolute z-10 w-60 overflow-hidden ${/* border border-cyan-50 */ 'popover-panel'}`}
                style={{
                    backgroundColor: 'white',
                    boxShadow: '0px 4px 10px rgba(0, 0, 0, 0.2)',    // Width of the popover panel 
                    padding: '15px', 
                    borderRadius: '10px', 
                    transition: 'all 0.3s ease-in-out'
                }}
            >
                <div className="flex-col self-stretch w-full bg-white">
                    <img src={qrCodeImg} />
                </div>
            </Popover.Panel>
        </Popover>
    )
}

export default QRCodePopover
