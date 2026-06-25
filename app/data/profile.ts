// Single source of truth for the site's content.
// Edit this file to update anything shown on the page.

// The few buckets the chips are grouped into on the homepage. Order here is the
// order the sections render in.
export const categories = ['Work & Research', 'Social', 'Play & Hobbies', 'Photography'] as const
export type LinkCategory = (typeof categories)[number]

// A single metric shown in a chip's hover/focus card (e.g. { label: 'Streak', value: '794 days' }).
export type LinkStat = { label: string; value: string }

export type LinkItem = {
    label: string
    href?: string // omit/empty to hide the link
    icon: string // monochrome silhouette in /public/icons; tinted to `color` via CSS mask
    color: string // brand color for the icon
    colorDark?: string // override for dark mode when the brand color is too dark to read
    qrcode?: string // for QR-only links like WeChat
    handle?: string // for copy-on-click handles with no URL (e.g. Discord)
    category: LinkCategory // which grouped section the chip lives in
    meta?: string // short subtitle (handle / id) shown in the hover card
    stats?: LinkStat[] // optional metrics revealed on hover/focus
}

export const profile = {
    name: 'Teo Zeng',
    tagline:
        'I am Teo Zeng. I like traveling, running, any sports with an emphasis on basketball, researching, and playing video games.',
    avatar: '/user/bearded-collie.jpg',
    // CC BY 2.0 attribution for the avatar photo (shown on hover).
    avatarCredit: 'Bearded Collie — photo by John Haslam (CC BY 2.0)',
}

// Background context fed to the on-device "Ask AI" assistant so it can answer
// questions about Teo. Refined from his resume; phone number and personal email
// are intentionally omitted since this is a public-facing assistant.
export const bio = `Full name: Weicheng Zeng, who goes by "Teo". Based in the New York City area.

Education:
- M.S. in Data Science, New York University (2023-2025), GPA 3.90/4.00.
- B.S. from UC Santa Barbara (2019-2023), GPA 3.95/4.00 — a triple major in Applied Mathematics, Statistics & Data Science, and Psychological & Brain Sciences.

Current role: Data Scientist at 3Victors / ATPCO (since Sept 2024), working on airline pricing and travel data. Highlights:
- Pretrained a transformer-based Airline Fare Foundation Model on 5B+ fare records, beating XGBoost baselines by 18% AUPRC, and productionized it with weekly retraining and drift monitoring.
- Built LangGraph-orchestrated AI agent systems (Graph RAG over 2K+ internal docs, NL-to-SQL exploration, auto-visualization, anomaly root-cause analysis) that cut recurring analyst tickets ~80%.
- Architected the near-real-time PriceEye pipeline (2B+ records/day, 300+ airlines) on AWS with sub-5-minute latency.
- Built a multi-horizon demand forecasting system (LSTM/GRU ensemble) at 12% MAPE.

Prior experience:
- AI Research Associate at NYU Langone Health (2024-2025): medical-imaging AI — 4D MRI brain tumor segmentation (nnU-Net/MedSAM, +25% F1), multimodal acute pancreatitis severity prediction (0.95 AUPRC), and hepatocellular carcinoma recurrence prediction with DINOv2 (C-index 0.85).
- AI Software Engineer Intern at T.M. Bier & Associates (2024): cost-estimation models and a causal-inference + forecasting pipeline deployed via a Dockerized Django/React stack.

Skills: machine learning (predictive modeling, NLP, time series, causal inference, anomaly detection), Python (PyTorch, TensorFlow, JAX, scikit-learn, pandas), SQL, R, Java, C++, MATLAB, and cloud/MLOps (AWS, GCP, Docker, CI/CD, Django, React).

Publications: co-author on several peer-reviewed papers in medical AI and crystallography, including HCC recurrence prediction (Liver Transplantation), acute pancreatitis severity from CT (Radiology Advances), and deep residual networks for crystallography (Acta Crystallographica Section D).

Selected projects (github.com/Sir-Teo):
- An agentic legal consultant (2026-present) for companies assessing overseas export requirements, with hybrid retrieval and citation-grounded compliance reports.
- Web-KaTrain (2025): a browser-based Go (Weiqi) app using TensorFlow.js and a custom Monte Carlo Tree Search engine for real-time move analysis and game review.
- web-chess: a polished chess app in React/TypeScript/Vite. MusicBART: music generation with BART. json2vec: nested data into neural representations with typed schemas. resonet: crystallography resolution prediction.

Writing: Teo keeps a technical research notebook at sir-teo.github.io/blogs with 300+ notes across ML, CS, AI systems, statistics, software engineering, applied math, quantitative finance, and more.

Interests: traveling, running, basketball and other sports, the board games Go (Weiqi) and chess, research, and video games.`

// Chips are listed grouped by `category` (sections render in `categories` order),
// and within each group they are ordered by the color of the rainbow — by the hue
// of each brand `color`, with near-neutral (black/slate) brands trailing each group.
// `stats` use real public figures (snapshot June 2026); update as they change.
export const links: LinkItem[] = [
    // ── Work & Research ──────────────────────────────────────────────
    {
        label: 'LeetCode',
        href: 'https://leetcode.com/u/user5137/',
        icon: '/icons/leetcode.svg',
        color: '#FFA116',
        category: 'Work & Research',
        meta: '@user5137',
        stats: [
            { label: 'Solved', value: '155' },
            { label: 'Easy', value: '63' },
            { label: 'Medium', value: '78' },
            { label: 'Hard', value: '14' },
        ],
    },
    {
        label: 'Kaggle',
        href: 'https://www.kaggle.com/sirteo',
        icon: '/icons/kaggle.svg',
        color: '#20BEFF',
        category: 'Work & Research',
        meta: '@sirteo',
        stats: [
            { label: 'Competitions', value: '19' },
            { label: 'Code', value: '3' },
            { label: 'Writeups', value: '2' },
            { label: 'Joined', value: '6y ago' },
        ],
    },
    {
        label: 'Devpost',
        href: 'https://devpost.com/zengwc-teo2016',
        icon: '/icons/devpost.svg',
        color: '#003E54',
        colorDark: '#7dd3fc',
        category: 'Work & Research',
        meta: '@zengwc-teo2016',
        stats: [
            { label: 'Projects', value: '1' },
            { label: 'Hackathons', value: '1' },
            { label: 'Achievements', value: '1' },
            { label: 'Likes', value: '1' },
        ],
    },
    {
        label: 'Blog',
        href: 'https://sir-teo.github.io/blogs/',
        icon: '/icons/blog.svg',
        color: '#0EA5E9',
        category: 'Work & Research',
        meta: 'Research notebook',
        stats: [{ label: 'Notes', value: '300+' }],
    },
    {
        label: 'Email',
        href: 'mailto:zengwc.teo2016@outlook.com',
        icon: '/icons/email.svg',
        color: '#0078D4',
        colorDark: '#3FA3F0',
        category: 'Work & Research',
        meta: 'zengwc.teo2016@outlook.com',
    },
    {
        label: 'LinkedIn',
        href: 'https://www.linkedin.com/in/teozeng/',
        icon: '/icons/linkedin.svg',
        color: '#0A66C2',
        colorDark: '#4DA3E4',
        category: 'Work & Research',
        meta: 'in/teozeng',
        stats: [
            { label: 'Connections', value: '500+' },
            { label: 'Role', value: 'Data Scientist' },
            { label: 'Location', value: 'New York' },
        ],
    },
    {
        label: 'Google Scholar',
        href: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en',
        icon: '/icons/googlescholar.svg',
        color: '#4285F4',
        category: 'Work & Research',
        meta: 'Publications',
        stats: [
            { label: 'Articles', value: '5' },
            { label: 'Citations', value: '7' },
            { label: 'h-index', value: '1' },
            { label: 'i10-index', value: '0' },
        ],
    },
    {
        label: 'GitHub',
        href: 'https://github.com/Sir-Teo',
        icon: '/icons/github.svg',
        color: '#181717',
        colorDark: '#f0f6fc',
        category: 'Work & Research',
        meta: '@Sir-Teo',
        stats: [
            { label: 'Repos', value: '82' },
            { label: 'Followers', value: '25' },
            { label: 'Since', value: '2017' },
        ],
    },

    // ── Social ───────────────────────────────────────────────────────
    {
        label: 'YouTube',
        href: 'https://www.youtube.com/@teozeng3999',
        icon: '/icons/youtube.svg',
        color: '#FF0000',
        category: 'Social',
        meta: '@teozeng3999',
        stats: [
            { label: 'Videos', value: '10' },
            { label: 'Subscribers', value: '5' },
        ],
    },
    {
        label: 'Reddit',
        href: 'https://www.reddit.com/user/Puzzleheaded_Bid_178/',
        icon: '/icons/reddit.svg',
        color: '#FF4500',
        category: 'Social',
        meta: 'u/Puzzleheaded_Bid_178',
        stats: [
            { label: 'Karma', value: '23' },
            { label: 'Post', value: '22' },
            { label: 'Comment', value: '1' },
            { label: 'Cake day', value: 'Aug 2021' },
        ],
    },
    {
        label: 'WeChat',
        qrcode: '/user/wechat_qrcode.jpg',
        icon: '/icons/wechat.svg',
        color: '#07C160',
        category: 'Social',
        meta: 'Scan to add',
    },
    {
        label: 'Discord',
        handle: 'teozeng',
        icon: '/icons/discord.svg',
        color: '#5865F2',
        colorDark: '#8b93f8',
        category: 'Social',
        meta: 'Click to copy',
    },
    {
        label: 'Bilibili',
        href: 'https://space.bilibili.com/299736746',
        icon: '/icons/bilibili.svg',
        color: '#FB7299',
        category: 'Social',
        meta: 'space/299736746',
        stats: [
            { label: 'Videos', value: '51' },
            { label: 'Followers', value: '78' },
            { label: 'Likes', value: '1,053' },
            { label: 'Level', value: '5' },
        ],
    },
    {
        label: 'Instagram',
        href: 'https://www.instagram.com/sir_teo',
        icon: '/icons/instagram.svg',
        color: '#E4405F',
        category: 'Social',
        meta: '@sir_teo',
        stats: [
            { label: 'Posts', value: '78' },
            { label: 'Followers', value: '535' },
            { label: 'Following', value: '577' },
        ],
    },

    // ── Play & Hobbies ───────────────────────────────────────────────
    {
        label: 'Strava',
        href: 'https://www.strava.com/athletes/206183585',
        icon: '/icons/strava.svg',
        color: '#FC4C02',
        category: 'Play & Hobbies',
        meta: 'Boston runner profile',
        stats: [
            { label: 'Activities', value: '124' },
            { label: 'Distance', value: '340.5 mi' },
            { label: 'Time', value: '60h 17m' },
            { label: 'Followers', value: '5' },
        ],
    },
    {
        // Clash of Clans has no official public player page; ClashOfStats hosts
        // the profile by tag.
        label: 'Clash of Clans',
        href: 'https://www.clashofstats.com/players/sir_teo-QP8UV90/summary',
        icon: '/icons/clashofclans.svg',
        color: '#E9A409',
        category: 'Play & Hobbies',
        meta: 'Tag #QP8UV90',
        stats: [
            { label: 'Town Hall', value: '18' },
            { label: 'XP', value: '241' },
            { label: 'Trophies', value: '1,724' },
            { label: 'Best', value: '5,561' },
        ],
    },
    {
        label: 'Genshin Impact',
        href: 'https://dak.gg/genshin/profile/646322102?hl=en',
        icon: '/icons/genshin-impact.svg',
        color: '#C9A86A',
        colorDark: '#F2DFA7',
        category: 'Play & Hobbies',
        meta: 'Teo · America · UID 646322102',
        stats: [
            { label: 'UID', value: '646322102' },
            { label: 'AR', value: '59' },
            { label: 'Achievements', value: '838' },
            { label: 'Characters', value: '64' },
        ],
    },
    {
        label: 'Chess.com',
        href: 'https://www.chess.com/member/masterteo1205',
        icon: '/icons/chess.svg',
        color: '#81B64C',
        category: 'Play & Hobbies',
        meta: '@masterteo1205',
        stats: [
            { label: 'Blitz', value: '427' },
            { label: 'Rapid', value: '198' },
            { label: 'Tactics', value: '1506' },
        ],
    },
    {
        label: 'Duolingo',
        href: 'https://www.duolingo.com/profile/sirteo',
        icon: '/icons/duolingo.svg',
        color: '#58CC02',
        category: 'Play & Hobbies',
        meta: '@sirteo',
        stats: [
            { label: 'Streak', value: '794 days' },
            { label: 'XP', value: '121,768' },
            { label: 'Courses', value: '5' },
        ],
    },
    {
        label: 'PlayStation',
        href: 'https://profile.playstation.com/masterteo1205',
        icon: '/icons/playstation.svg',
        color: '#0070D1',
        colorDark: '#4DA3E4',
        category: 'Play & Hobbies',
        meta: 'PSN: masterteo1205',
    },
    {
        label: 'OGS',
        href: 'https://online-go.com/user/view/622443',
        icon: '/icons/online-go.svg',
        color: '#1F2937',
        colorDark: '#cbd5e1',
        category: 'Play & Hobbies',
        meta: 'Go (Weiqi)',
        stats: [{ label: 'Rating', value: '1708' }],
    },
    {
        label: 'Steam',
        href: 'https://steamcommunity.com/profiles/76561198413328513/',
        icon: '/icons/steam.svg',
        color: '#1B2838',
        colorDark: '#66C0F4',
        category: 'Play & Hobbies',
        meta: 'Master Teo',
        stats: [
            { label: 'Level', value: '47' },
            { label: 'Games', value: '57' },
            { label: 'Badges', value: '11' },
            { label: 'Reviews', value: '17' },
        ],
    },

    // ── Photography ──────────────────────────────────────────────────
    {
        label: 'Gallery',
        href: 'https://sir-teo.github.io/gallery/index.html',
        icon: '/icons/gallery.svg',
        color: '#7C3AED',
        colorDark: '#a78bfa',
        category: 'Photography',
        meta: 'Personal photo gallery',
        stats: [{ label: 'Photos', value: '90+' }],
    },
]
