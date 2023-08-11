'use client'
import { useState } from 'react'
import TextPopover from './TextPopover' // Importing the modified TextPopover component

interface HobbyInteractTextProps {
    text: string
    hobbyItem: { [index: string]: any }
}

const HobbyInteractText: React.FC<HobbyInteractTextProps> = ({ text, hobbyItem }) => {
    const { link, furtherText } = hobbyItem || {}
    const [isOpen, setIsOpen] = useState(false) // Fixed typo in setter name
    const handlehobbyClick = (hobbyItem: { [index: string]: any }) => {
        window.open(link, '_blank')
    }
    const handlehobbyHover = (hobbyItem: { [index: string]: any }) => {
        setIsOpen(true) // Fixed typo in setter name
    }

    return (
        <span
            className="cursor-pointer"
            onMouseEnter={() => {
                handlehobbyHover(hobbyItem)
            }}
            onMouseLeave={() => {
                setIsOpen(false) 
            }}
            onClick={() => {
                handlehobbyClick(hobbyItem)
            }}
        >
            {text}
            <TextPopover isOpen={isOpen} textContent={furtherText} /> {/* Using TextPopover with link as content */}
        </span>
    )
}

export default HobbyInteractText
