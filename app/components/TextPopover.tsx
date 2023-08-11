import { Popover } from '@headlessui/react'

interface TextPopoverProps {
    isOpen: boolean
    textContent: string
}

const TextPopover = ({ isOpen, textContent }: TextPopoverProps) => {
    if (!isOpen) return null
    if (!textContent) return null
    return (
        <Popover className="relative top-1">
        <Popover.Panel
            static
            className={`absolute z-10 w-200 overflow-hidden popover-panel`}
            style={{
                backgroundColor: 'white',
                boxShadow: '0px 4px 10px rgba(0, 0, 0, 0.2)',
                width: '300px',     // Width of the popover panel 
                padding: '15px', 
                borderRadius: '10px', 
                transition: 'all 0.3s ease-in-out'
            }}
        >
            <div className="flex-col self-stretch w-full bg-white">
                <div>{textContent}</div>
            </div>
        </Popover.Panel>
    </Popover>
    
    )
}

export default TextPopover
