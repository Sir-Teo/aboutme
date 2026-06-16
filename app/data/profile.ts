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

Selected projects:
- An agentic legal consultant (2026-present) for companies assessing overseas export requirements, with hybrid retrieval and citation-grounded compliance reports.
- Web-Katrain (2025): a browser-based Go (Weiqi) app using TensorFlow.js and a custom Monte Carlo Tree Search engine for real-time move analysis and game review.

Interests: traveling, running, basketball and other sports, research, and video games.`

export const links: LinkItem[] = [
    { label: 'YouTube', href: 'https://www.youtube.com/@teozeng3999', icon: '/icons/youtube.svg', color: '#FF0000' },
    {
        label: 'Reddit',
        href: 'https://www.reddit.com/user/Puzzleheaded_Bid_178/',
        icon: '/icons/reddit.svg',
        color: '#FF4500',
    },
    { label: 'Strava', href: 'https://www.strava.com/athletes/206183585', icon: '/icons/strava.svg', color: '#FC4C02' },
    {
        label: 'Chess.com',
        href: 'https://www.chess.com/member/masterteo1205',
        icon: '/icons/chess.svg',
        color: '#81B64C',
    },
    { label: 'WeChat', qrcode: '/user/wechat_qrcode.jpg', icon: '/icons/wechat.svg', color: '#07C160' },
    { label: 'Kaggle', href: 'https://www.kaggle.com/sirteo', icon: '/icons/kaggle.svg', color: '#20BEFF' },
    { label: 'Blog', href: 'https://sir-teo.github.io/blogs/', icon: '/icons/blog.svg', color: '#0EA5E9' },
    {
        label: 'LinkedIn',
        href: 'https://www.linkedin.com/in/teozeng/',
        icon: '/icons/linkedin.svg',
        color: '#0A66C2',
        colorDark: '#4DA3E4',
    },
    {
        label: 'Email',
        href: 'mailto:zengwc.teo2016@outlook.com',
        icon: '/icons/email.svg',
        color: '#0078D4',
        colorDark: '#3FA3F0',
    },
    {
        label: 'Google Scholar',
        href: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en',
        icon: '/icons/googlescholar.svg',
        color: '#4285F4',
    },
    { label: 'Discord', handle: 'teozeng', icon: '/icons/discord.svg', color: '#5865F2', colorDark: '#8b93f8' },
    { label: 'Instagram', href: 'https://www.instagram.com/sir_teo', icon: '/icons/instagram.svg', color: '#E4405F' },
    { label: 'Bilibili', href: 'https://space.bilibili.com/299736746', icon: '/icons/bilibili.svg', color: '#FB7299' },
    {
        label: 'GitHub',
        href: 'https://github.com/Sir-Teo',
        icon: '/icons/github.svg',
        color: '#181717',
        colorDark: '#f0f6fc',
    },
    {
        label: 'OGS',
        href: 'https://online-go.com/user/view/622443',
        icon: '/icons/online-go.svg',
        color: '#1F2937',
        colorDark: '#cbd5e1',
    },
]
