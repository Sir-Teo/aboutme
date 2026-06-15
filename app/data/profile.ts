// Single source of truth for the site's content.
// Edit this file to update anything shown on the page.

export type LinkItem = {
    label: string
    href?: string // omit/empty to hide the link
    icon: string // monochrome silhouette in /public/icons; tinted to `color` via CSS mask
    color: string // brand color for the icon
    colorDark?: string // override for dark mode when the brand color is too dark to read
    qrcode?: string // for QR-only links like WeChat
    handle?: string // for copy-on-click handles with no URL (e.g. Discord)
}

export const profile = {
    name: 'Teo Zeng',
    tagline:
        'I am Teo Zeng. I like traveling, running, any sports with an emphasis on basketball, researching, and playing video games.',
    avatar: '/user/bearded-collie.jpg',
    // CC BY 2.0 attribution for the avatar photo (shown on hover).
    avatarCredit: 'Bearded Collie — photo by John Haslam (CC BY 2.0)',
}

export const links: LinkItem[] = [
    {
        label: 'GitHub',
        href: 'https://github.com/Sir-Teo',
        icon: '/icons/github.svg',
        color: '#181717',
        colorDark: '#f0f6fc',
    },
    {
        label: 'Google Scholar',
        href: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en',
        icon: '/icons/googlescholar.svg',
        color: '#4285F4',
    },
    { label: 'Kaggle', href: 'https://www.kaggle.com/sirteo', icon: '/icons/kaggle.svg', color: '#20BEFF' },
    {
        label: 'LinkedIn',
        href: 'https://www.linkedin.com/in/teozeng/',
        icon: '/icons/linkedin.svg',
        color: '#0A66C2',
        colorDark: '#4DA3E4',
    },
    { label: 'Blog', href: 'https://sir-teo.github.io/blogs/', icon: '/icons/blog.svg', color: '#0EA5E9' },
    {
        label: 'Email',
        href: 'mailto:zengwc.teo2016@outlook.com',
        icon: '/icons/email.svg',
        color: '#0078D4',
        colorDark: '#3FA3F0',
    },
    { label: 'Instagram', href: 'https://www.instagram.com/sir_teo', icon: '/icons/instagram.svg', color: '#E4405F' },
    { label: 'YouTube', href: 'https://www.youtube.com/@teozeng3999', icon: '/icons/youtube.svg', color: '#FF0000' },
    { label: 'Bilibili', href: 'https://space.bilibili.com/299736746', icon: '/icons/bilibili.svg', color: '#FB7299' },
    {
        label: 'Reddit',
        href: 'https://www.reddit.com/user/Puzzleheaded_Bid_178/',
        icon: '/icons/reddit.svg',
        color: '#FF4500',
    },
    { label: 'Strava', href: 'https://www.strava.com/athletes/206183585', icon: '/icons/strava.svg', color: '#FC4C02' },
    {
        label: 'OGS',
        href: 'https://online-go.com/user/view/622443',
        icon: '/icons/online-go.svg',
        color: '#1F2937',
        colorDark: '#cbd5e1',
    },
    {
        label: 'Chess.com',
        href: 'https://www.chess.com/member/masterteo1205',
        icon: '/icons/chess.svg',
        color: '#81B64C',
    },
    { label: 'Discord', handle: 'teozeng', icon: '/icons/discord.svg', color: '#5865F2', colorDark: '#8b93f8' },
    { label: 'WeChat', qrcode: '/user/wechat_qrcode.jpg', icon: '/icons/wechat.svg', color: '#07C160' },
]
