// Retrieval knowledge base for the on-device "Ask AI" assistant.
//
// The chat is fully client-side (no server, no API key), so grounding has to ship
// with the page. Rather than dumping every fact about Teo into the system prompt
// on every turn — which both dilutes a small model's attention and inflates the
// per-answer prefill cost — we split the facts into small, self-contained chunks
// and retrieve only the few most relevant to the current question.
//
// Two retrievers read this array: the lexical `retrieve` below (instant, no
// download — used on the homepage pill) and the semantic embeddings retriever in
// app/chat/agent/retrieval.ts (used in the playground). Granular, self-contained
// chunks help both: each chunk should answer one question well on its own.
//
// Sources of truth (all the user's own, public): the résumé-derived `bio` in
// profile.ts, the GitHub profile (github.com/Sir-Teo), Google Scholar, and the
// research blog (sir-teo.github.io/blogs). Don't add a fact you can't attribute.

// Auto-ingested chunks (GitHub repos + blog posts), refreshed by `npm run ingest`.
// Kept in a separate committed file so static builds need no network; the lexical
// retriever below stays on the hand-curated set, while the semantic retriever in
// app/chat/agent/retrieval.ts reads ALL_KNOWLEDGE (curated + generated).
import { GENERATED_KNOWLEDGE } from './generated'

// A citable origin for a fact — surfaced under answers so the agent's claims are
// attributable (and hallucinations are visible). Optional: facts with no single
// canonical URL (skills, interests) simply don't show a citation.
export type Source = {
    // Short label for the source pill, e.g. "GitHub", "Blog", "LinkedIn".
    label: string
    url: string
}

export type KnowledgeChunk = {
    id: string
    // Short human-readable topic, surfaced for debugging/citations later.
    topic: string
    // The grounding sentence(s) fed to the model when this chunk is retrieved.
    text: string
    // Extra terms that should match this chunk even when absent from `text`
    // (synonyms, abbreviations, related concepts). Weighted above body terms.
    keywords: string[]
    // Where this fact comes from. Rendered as a citation when the chunk grounds
    // an answer. Generated chunks (GitHub repos, blog posts) always carry one.
    source?: Source
}

export const KNOWLEDGE: KnowledgeChunk[] = [
    // ─────────────────────────────── Identity & contact ───────────────────────
    {
        id: 'identity',
        topic: 'Identity & location',
        text: 'Full name: Weicheng Zeng, who goes by Teo. He is based in the New York City area.',
        keywords: [
            'name',
            'who',
            'real name',
            'full name',
            'weicheng',
            'teo',
            'zeng',
            'where',
            'live',
            'lives',
            'based',
            'location',
            'nyc',
            'new york',
            'city',
        ],
    },
    {
        id: 'contact',
        topic: 'Contact & email',
        text: 'You can reach Teo by email at zengwc.teo2016@outlook.com. The best way to contact him is email or LinkedIn (linkedin.com/in/teozeng).',
        keywords: [
            'contact',
            'email',
            'reach',
            'message',
            'get in touch',
            'outlook',
            'mail',
            'how to contact',
            'hire',
            'connect',
        ],
        source: { label: 'Email', url: 'mailto:zengwc.teo2016@outlook.com' },
    },
    {
        id: 'socials',
        topic: 'Social profiles & handles',
        text: "Teo's profiles: GitHub github.com/Sir-Teo, LinkedIn linkedin.com/in/teozeng, Google Scholar (Weicheng Zeng), Kaggle kaggle.com/sirteo, Instagram @sir_teo, YouTube @teozeng3999, Bilibili, Strava, Chess.com (masterteo1205), OGS / online-go, and Discord (teozeng).",
        keywords: [
            'social',
            'socials',
            'profile',
            'profiles',
            'handle',
            'handles',
            'links',
            'link',
            'github',
            'linkedin',
            'kaggle',
            'instagram',
            'youtube',
            'bilibili',
            'discord',
            'twitter',
            'account',
            'find online',
            'follow',
        ],
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo' },
    },
    {
        id: 'github',
        topic: 'GitHub',
        text: "Teo's GitHub is github.com/Sir-Teo (username Sir-Teo). His profile bio reads: 'I love machine learning and data science and basketball!'",
        keywords: ['github', 'sir-teo', 'code', 'repos', 'repositories', 'open source', 'git'],
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo' },
    },
    {
        id: 'blog',
        topic: 'Research blog',
        text: "Teo writes a technical research notebook at sir-teo.github.io/blogs with 300+ notes spanning machine learning, computer science, AI systems, data systems, statistics, software engineering, applied mathematics, quantitative finance, computer graphics, physics, gaming, and psychology. His style turns each title into a conceptual framework and values ideas that 'show their evidence, their scars, and the places where a reader can push back.'",
        keywords: [
            'blog',
            'blogs',
            'writing',
            'write',
            'notebook',
            'research notebook',
            'notes',
            'posts',
            'articles',
            'website',
            'quantitative finance',
            'quant',
        ],
        source: { label: 'Blog', url: 'https://sir-teo.github.io/blogs' },
    },

    // ─────────────────────────────── Current role ─────────────────────────────
    {
        id: 'role',
        topic: 'Current role',
        text: 'Teo is a Data Scientist at 3Victors / ATPCO (since September 2024), working on airline pricing and travel data.',
        keywords: [
            'job',
            'work',
            'works',
            'working',
            'role',
            'company',
            'employer',
            'current',
            'now',
            'today',
            'atpco',
            '3victors',
            'data scientist',
            'career',
            'airline',
            'pricing',
            'position',
            'title',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },
    {
        id: 'fare-model',
        topic: 'Airline Fare Foundation Model',
        text: 'At ATPCO, Teo pretrained a transformer-based Airline Fare Foundation Model on 5B+ fare records, beating XGBoost baselines by 18% AUPRC, then productionized it with weekly retraining and drift monitoring.',
        keywords: [
            'foundation model',
            'transformer',
            'fare',
            'fares',
            'pretrain',
            'pretrained',
            'xgboost',
            'auprc',
            'retraining',
            'drift',
            'mlops',
            'biggest achievement',
            'proud',
        ],
    },
    {
        id: 'agents',
        topic: 'AI agent systems at work',
        text: 'Teo built LangGraph-orchestrated AI agent systems at work — Graph RAG over 2K+ internal docs, NL-to-SQL exploration, auto-visualization, and anomaly root-cause analysis — that cut recurring analyst tickets by about 80%.',
        keywords: [
            'agent',
            'agents',
            'agentic',
            'langgraph',
            'langchain',
            'graph rag',
            'rag',
            'retrieval',
            'nl-to-sql',
            'text-to-sql',
            'llm',
            'orchestration',
            'automation',
        ],
    },
    {
        id: 'priceeye',
        topic: 'PriceEye pipeline',
        text: 'Teo architected the near-real-time PriceEye data pipeline on AWS (2B+ records per day, 300+ airlines) with sub-5-minute latency.',
        keywords: [
            'priceeye',
            'pipeline',
            'data engineering',
            'streaming',
            'real-time',
            'realtime',
            'aws',
            'latency',
            'scale',
            'big data',
            'throughput',
            'records',
        ],
    },
    {
        id: 'forecasting',
        topic: 'Demand forecasting',
        text: 'Teo built a multi-horizon demand forecasting system using an LSTM/GRU ensemble that reached 12% MAPE.',
        keywords: [
            'forecast',
            'forecasting',
            'demand',
            'time series',
            'lstm',
            'gru',
            'ensemble',
            'mape',
            'prediction',
            'predict',
        ],
    },

    // ───────────────────────────── Prior experience ───────────────────────────
    {
        id: 'nyu-langone',
        topic: 'Medical-imaging research (NYU Langone)',
        text: 'As an AI Research Associate at NYU Langone Health (2024–2025), Teo worked on medical-imaging AI: 4D MRI brain-tumor segmentation (nnU-Net / MedSAM, +25% F1), multimodal acute-pancreatitis severity prediction (0.95 AUPRC), and hepatocellular carcinoma (HCC) recurrence prediction with DINOv2 (C-index 0.85).',
        keywords: [
            'research',
            'researcher',
            'research associate',
            'medical',
            'imaging',
            'mri',
            'brain',
            'tumor',
            'segmentation',
            'pancreatitis',
            'hcc',
            'liver',
            'cancer',
            'nnu-net',
            'medsam',
            'dinov2',
            'nyu langone',
            'langone',
            'healthcare',
            'radiology',
            'hospital',
        ],
    },
    {
        id: 'tmbier',
        topic: 'Earlier industry experience',
        text: 'As an AI Software Engineer Intern at T.M. Bier & Associates (2024), Teo built cost-estimation models and a causal-inference + forecasting pipeline deployed via a Dockerized Django/React stack.',
        keywords: [
            'intern',
            'internship',
            'software engineer',
            'engineer',
            'tm bier',
            'bier',
            'cost estimation',
            'causal inference',
            'django',
            'react',
            'docker',
            'first job',
        ],
    },

    // ─────────────────────────────── Education ────────────────────────────────
    {
        id: 'edu-nyu',
        topic: 'Education — NYU',
        text: 'Teo earned an M.S. in Data Science from New York University (2023–2025) with a 3.90/4.00 GPA.',
        keywords: [
            'education',
            'degree',
            'masters',
            "master's",
            'ms',
            'nyu',
            'new york university',
            'data science',
            'gpa',
            'grad',
            'graduate',
            'study',
            'studied',
            'studies',
        ],
    },
    {
        id: 'edu-ucsb',
        topic: 'Education — UC Santa Barbara',
        text: 'Teo earned a B.S. from UC Santa Barbara (2019–2023) with a 3.95/4.00 GPA — a triple major in Applied Mathematics, Statistics & Data Science, and Psychological & Brain Sciences.',
        keywords: [
            'education',
            'degree',
            'bachelors',
            "bachelor's",
            'bs',
            'ucsb',
            'uc santa barbara',
            'santa barbara',
            'undergrad',
            'undergraduate',
            'triple major',
            'applied math',
            'mathematics',
            'math',
            'statistics',
            'psychology',
            'brain sciences',
            'gpa',
            'college',
        ],
    },

    // ─────────────────────────────── Skills ───────────────────────────────────
    {
        id: 'skills-ml',
        topic: 'Skills — machine learning',
        text: "Teo's machine-learning skills span predictive modeling, NLP, time series, causal inference, anomaly detection, deep learning, computer vision, and LLM agents.",
        keywords: [
            'skill',
            'skills',
            'machine learning',
            'ml',
            'deep learning',
            'nlp',
            'natural language',
            'time series',
            'causal inference',
            'anomaly',
            'computer vision',
            'vision',
            'expertise',
            'good at',
            'specialize',
            'strengths',
        ],
    },
    {
        id: 'skills-languages',
        topic: 'Skills — programming languages & frameworks',
        text: 'Teo programs primarily in Python (PyTorch, TensorFlow, JAX, scikit-learn, pandas) and also works in SQL, R, Java, C++, and MATLAB.',
        keywords: [
            'skill',
            'skills',
            'programming',
            'language',
            'languages',
            'code',
            'python',
            'pytorch',
            'tensorflow',
            'jax',
            'scikit',
            'pandas',
            'sql',
            'r',
            'java',
            'c++',
            'matlab',
            'framework',
        ],
    },
    {
        id: 'skills-cloud',
        topic: 'Skills — cloud & MLOps',
        text: "Teo's cloud and MLOps stack includes AWS, GCP, Docker, CI/CD, Django, and React.",
        keywords: [
            'skill',
            'skills',
            'cloud',
            'mlops',
            'devops',
            'aws',
            'gcp',
            'google cloud',
            'docker',
            'ci/cd',
            'cicd',
            'django',
            'react',
            'deployment',
            'infrastructure',
        ],
    },

    // ─────────────────────────────── Publications ─────────────────────────────
    {
        id: 'pub-pancreatitis',
        topic: 'Publication — acute pancreatitis severity from CT',
        text: 'Teo (W. Zeng) is a co-author of "Deep learning-based prediction of acute pancreatitis severity from abdominal CT with multicenter external validation" in Radiology Advances (2026), with an earlier validation study on medRxiv (2025).',
        keywords: [
            'publication',
            'paper',
            'papers',
            'pancreatitis',
            'ct',
            'abdominal',
            'radiology advances',
            'medrxiv',
            'severity',
            'medical paper',
            'co-author',
            'author',
        ],
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/scholar?q=Weicheng+Zeng+pancreatitis' },
    },
    {
        id: 'pub-crystallography',
        topic: 'Publication — deep learning for crystallography',
        text: 'Teo (W. Zeng) is a co-author of "Deep residual networks for crystallography trained on synthetic data" in Acta Crystallographica Section D / Biological Crystallography (2024). His GitHub "resonet" repo relates to predicting resolution from Holton simulations.',
        keywords: [
            'publication',
            'paper',
            'papers',
            'crystallography',
            'acta',
            'residual',
            'resnet',
            'resonet',
            'synthetic data',
            'biological crystallography',
            'holton',
            'co-author',
            'science',
        ],
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/scholar?q=Weicheng+Zeng+crystallography' },
    },
    {
        id: 'pub-elder-finance',
        topic: 'Publication — elder financial exploitation (social media)',
        text: 'Teo (W. Zeng) co-authored work on public attitudes toward elder family financial exploitation analyzed from social-media data — in the Journal of Family Violence (2026) and Innovation in Aging (2025), bridging data science with psychology and gerontology.',
        keywords: [
            'publication',
            'paper',
            'papers',
            'elder',
            'financial exploitation',
            'social media',
            'family violence',
            'innovation in aging',
            'gerontology',
            'psychology',
            'aging',
            'social science',
        ],
        source: {
            label: 'Google Scholar',
            url: 'https://scholar.google.com/scholar?q=Weicheng+Zeng+elder+financial+exploitation',
        },
    },
    {
        id: 'publications-overview',
        topic: 'Publications overview',
        text: 'Teo is a co-author on several peer-reviewed papers spanning medical AI, crystallography, and computational social science. His Google Scholar profile lists the full set.',
        keywords: [
            'publications',
            'papers',
            'research output',
            'peer-reviewed',
            'google scholar',
            'scholar',
            'how many papers',
            'published',
            'co-author',
            'citations',
        ],
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/scholar?q=Weicheng+Zeng' },
    },

    // ─────────────────────────────── Projects ─────────────────────────────────
    {
        id: 'proj-legal',
        topic: 'Project — agentic legal consultant',
        text: 'Teo is building an agentic legal consultant (2026–present) for companies assessing overseas export requirements, with hybrid retrieval and citation-grounded compliance reports.',
        keywords: [
            'project',
            'projects',
            'legal',
            'consultant',
            'compliance',
            'export',
            'agentic',
            'hybrid retrieval',
            'citation',
            'side project',
            'building',
            'current project',
        ],
    },
    {
        id: 'proj-katrain',
        topic: 'Project — Web-KaTrain',
        text: 'Teo built Web-KaTrain (web-katrain, 2025): a browser-based Go (Weiqi) app with in-browser KataGo-style analysis using TensorFlow.js and a custom Monte Carlo Tree Search engine for real-time move analysis and game review.',
        keywords: [
            'project',
            'projects',
            'web-katrain',
            'katrain',
            'katago',
            'go game',
            'weiqi',
            'baduk',
            'board game',
            'tensorflow.js',
            'tfjs',
            'mcts',
            'monte carlo',
            'browser',
        ],
    },
    {
        id: 'proj-web-chess',
        topic: 'Project — Web-Chess',
        text: 'Teo built web-chess, a modern, polished chess application built with React, TypeScript, and Vite.',
        keywords: ['project', 'projects', 'web-chess', 'chess app', 'chess application', 'react', 'typescript', 'vite'],
    },
    {
        id: 'proj-musicbart',
        topic: 'Project — MusicBART',
        text: 'Teo built MusicBART, a project that generates music using the BART sequence-to-sequence model.',
        keywords: ['project', 'projects', 'musicbart', 'music', 'bart', 'generation', 'generative', 'audio', 'seq2seq'],
    },
    {
        id: 'proj-json2vec',
        topic: 'Project — json2vec',
        text: 'Teo built json2vec, which turns nested, ragged data into neural representations with typed schemas for prediction and embedding.',
        keywords: ['project', 'projects', 'json2vec', 'json', 'embedding', 'representation', 'schema', 'neural'],
    },
    {
        id: 'proj-misc',
        topic: 'Other projects',
        text: 'Other Teo projects include resonet (predicting crystallography resolution from Holton simulations) and visualizing-grades (a grade-visualization tool for UCSB students).',
        keywords: [
            'project',
            'projects',
            'resonet',
            'visualizing-grades',
            'grades',
            'ucsb tool',
            'side projects',
            'other',
        ],
    },

    // ─────────────────────────────── Interests & hobbies ──────────────────────
    {
        id: 'interests',
        topic: 'Interests & hobbies',
        text: 'Teo likes traveling, running, basketball and other sports, research, and playing video games. He is also into the board games Go (Weiqi) and chess.',
        keywords: [
            'interest',
            'interests',
            'hobby',
            'hobbies',
            'like',
            'likes',
            'enjoy',
            'fun',
            'free time',
            'outside work',
            'passion',
            'pastime',
        ],
    },
    {
        id: 'hobby-running',
        topic: 'Hobby — running',
        text: 'Teo enjoys running and tracks his activity on Strava (strava.com/athletes/206183585).',
        keywords: ['running', 'run', 'runner', 'strava', 'cardio', 'exercise', 'fitness', 'marathon'],
    },
    {
        id: 'hobby-basketball',
        topic: 'Hobby — basketball & sports',
        text: 'Teo is a basketball fan and player, and enjoys sports in general — his GitHub bio even ends with "and basketball!".',
        keywords: ['basketball', 'sport', 'sports', 'ball', 'nba', 'play', 'athletic'],
    },
    {
        id: 'hobby-go',
        topic: 'Hobby — Go / Weiqi',
        text: 'Teo plays the board game Go (Weiqi / Baduk) — he has an OGS profile (online-go.com) and built the Web-KaTrain Go-analysis app.',
        keywords: ['go game', 'weiqi', 'baduk', 'ogs', 'online-go', 'board game', 'katrain', 'igo'],
    },
    {
        id: 'hobby-chess',
        topic: 'Hobby — chess',
        text: 'Teo plays chess on Chess.com (member masterteo1205) and built a web-chess application.',
        keywords: ['chess', 'chess.com', 'masterteo1205', 'board game', 'web-chess'],
    },
    {
        id: 'hobby-gaming',
        topic: 'Hobby — video games',
        text: 'Teo enjoys playing video games in his free time.',
        keywords: ['video games', 'gaming', 'games', 'gamer', 'play games'],
    },
    {
        id: 'hobby-travel',
        topic: 'Hobby — traveling',
        text: 'Teo likes traveling.',
        keywords: ['travel', 'traveling', 'trips', 'explore', 'places', 'countries'],
    },
]

// The full knowledge base the semantic agent grounds on: hand-curated facts plus
// everything ingested from Teo's public footprint (GitHub repos, blog posts). The
// lexical `retrieve` below and the homepage pill deliberately stay on the curated
// KNOWLEDGE only — instant, no embedding, and a stable audit target.
export const ALL_KNOWLEDGE: KnowledgeChunk[] = [...KNOWLEDGE, ...GENERATED_KNOWLEDGE]

// Lightweight English stopwords — dropped from queries so scoring keys off
// content words. Kept small on purpose; the goal is signal, not NLP rigor.
const STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'the',
    'of',
    'to',
    'in',
    'on',
    'for',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'do',
    'does',
    'did',
    'has',
    'have',
    'had',
    'what',
    'whats',
    'which',
    'who',
    'whom',
    'whose',
    'when',
    'where',
    'why',
    'how',
    'tell',
    'me',
    'about',
    'his',
    'her',
    'he',
    'she',
    'they',
    'them',
    'it',
    'this',
    'that',
    'these',
    'those',
    'with',
    'as',
    'at',
    'by',
    'or',
    'i',
    'you',
    'your',
    'teo',
    'teos',
    'can',
    'could',
    'would',
    'should',
    'please',
    'know',
    'any',
    'some',
    'there',
    'into',
    'from',
    'over',
    'go',
    'get',
    'tell',
])

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9+#.\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
}

function queryTerms(query: string): string[] {
    return tokenize(query).filter(t => t.length > 1 && !STOPWORDS.has(t))
}

// Per-chunk searchable text (body + topic) cached once, since the KB is static.
const chunkBodyTerms: Map<string, Set<string>> = new Map()
const chunkKeywordTerms: Map<string, Set<string>> = new Map()

for (const chunk of KNOWLEDGE) {
    chunkBodyTerms.set(chunk.id, new Set(tokenize(`${chunk.topic} ${chunk.text}`)))
    chunkKeywordTerms.set(chunk.id, new Set(chunk.keywords.flatMap(tokenize)))
}

const KEYWORD_WEIGHT = 2.5
const BODY_WEIGHT = 1
// Multi-word keywords (e.g. "machine learning") that appear verbatim in the query
// are strong signals; reward them on top of the per-token score.
const PHRASE_BONUS = 3

function scoreChunk(chunk: KnowledgeChunk, terms: string[], normalizedQuery: string): number {
    const body = chunkBodyTerms.get(chunk.id)!
    const keys = chunkKeywordTerms.get(chunk.id)!
    let score = 0
    for (const term of terms) {
        if (keys.has(term)) score += KEYWORD_WEIGHT
        else if (body.has(term)) score += BODY_WEIGHT
    }
    for (const keyword of chunk.keywords) {
        if (keyword.includes(' ') && normalizedQuery.includes(keyword)) score += PHRASE_BONUS
    }
    return score
}

// Return the `k` most relevant chunks for `query`, best first. Falls back to a
// small default set when the query has no usable signal (empty/greeting) so the
// model always has something to ground on.
export function retrieve(query: string, k = 4): KnowledgeChunk[] {
    const terms = queryTerms(query)
    if (terms.length === 0) {
        return [byId('role'), byId('identity'), byId('skills-ml')].slice(0, k)
    }

    const normalizedQuery = ` ${tokenize(query).join(' ')} `
    const ranked = KNOWLEDGE.map(chunk => ({ chunk, score: scoreChunk(chunk, terms, normalizedQuery) }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)

    if (ranked.length === 0) {
        // No keyword hit at all — return the identity/role basics rather than nothing.
        return [byId('identity'), byId('role')].slice(0, k)
    }

    return ranked.slice(0, k).map(entry => entry.chunk)
}

function byId(id: string): KnowledgeChunk {
    const chunk = KNOWLEDGE.find(c => c.id === id)
    if (!chunk) throw new Error(`Unknown knowledge chunk: ${id}`)
    return chunk
}
