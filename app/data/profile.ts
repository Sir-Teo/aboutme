// Single source of truth for the site's content.
// Edit this file to update anything shown on the page.

export type LinkItem = {
    label: string
    href?: string // omit/empty to hide the link
    icon: string
    iconDark?: string // optional light-colored variant shown in dark mode
    qrcode?: string // for QR-only links like WeChat
    handle?: string // for copy-on-click handles with no URL (e.g. Discord)
}

export const profile = {
    name: 'Teo Zeng',
    tagline: 'I am Teo Zeng. I like traveling, running, basketball, researching, and playing video games.',
    avatar: '/user/bearded-collie.jpg',
    // CC BY 2.0 attribution for the avatar photo (shown on hover).
    avatarCredit: 'Bearded Collie — photo by John Haslam (CC BY 2.0)',
}

export const links: LinkItem[] = [
    {
        label: 'GitHub',
        href: 'https://github.com/Sir-Teo',
        icon: '/commonicons/github.svg',
        iconDark: '/commonicons/github-dark.svg',
    },
    {
        label: 'Google Scholar',
        href: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en',
        icon: '/commonicons/google-scholar.svg',
    },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/teozeng/', icon: '/commonicons/linkedin.svg' },
    {
        label: 'Blog',
        href: 'https://github.com/Sir-Teo/blogs',
        icon: '/misc/website.svg',
        iconDark: '/misc/website-dark.svg',
    },
    {
        label: 'Email',
        href: 'mailto:zengwc.teo2016@outlook.com',
        icon: '/misc/email.svg',
        iconDark: '/misc/email-dark.svg',
    },
    { label: 'Instagram', href: 'https://www.instagram.com/sir_teo', icon: '/commonicons/instagram.svg' },
    { label: 'YouTube', href: 'https://www.youtube.com/@teozeng3999', icon: '/commonicons/youtube.svg' },
    { label: 'Bilibili', href: 'https://space.bilibili.com/299736746', icon: '/commonicons/bilibili.svg' },
    { label: 'OGS', href: 'https://online-go.com/user/view/622443', icon: '/commonicons/online-go.svg' },
    { label: 'Discord', handle: 'teozeng', icon: '/commonicons/discord.svg' },
    { label: 'WeChat', qrcode: '/user/wechat_qrcode.jpg', icon: '/commonicons/wechat.svg' },
]
