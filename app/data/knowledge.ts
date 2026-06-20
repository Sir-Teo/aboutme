// Retrieval knowledge base for the on-device "Ask AI" assistant.
//
// The chat is fully client-side (no server, no API key), so grounding has to ship
// with the page. Rather than dumping every fact about Teo into the system prompt
// on every turn — which both dilutes a small model's attention and inflates the
// per-answer prefill cost — we split the facts into small, self-contained chunks
// and retrieve only the few most relevant to the current question.
//
// `retrieve` is a dependency-free lexical scorer: good enough for a ~30-chunk
// personal knowledge base and instant (no model download). The interface is kept
// deliberately small (query in, ranked chunks out) so a semantic/embeddings
// backend — Transformers.js embeddings + a WASM vector index — can drop in behind
// it later without touching the chat code.

export type KnowledgeChunk = {
    id: string
    // Short human-readable topic, surfaced for debugging/citations later.
    topic: string
    // The grounding sentence(s) fed to the model when this chunk is retrieved.
    text: string
    // Extra terms that should match this chunk even when absent from `text`
    // (synonyms, abbreviations, related concepts). Weighted above body terms.
    keywords: string[]
}

export const KNOWLEDGE: KnowledgeChunk[] = [
    {
        id: 'identity',
        topic: 'Identity & location',
        text: 'Full name: Weicheng Zeng, who goes by Teo. Based in the New York City area.',
        keywords: [
            'name',
            'who',
            'real name',
            'weicheng',
            'teo',
            'where',
            'live',
            'based',
            'location',
            'nyc',
            'new york',
        ],
    },
    {
        id: 'role',
        topic: 'Current role',
        text: 'Teo is a Data Scientist at 3Victors / ATPCO (since Sept 2024), working on airline pricing and travel data.',
        keywords: [
            'job',
            'work',
            'role',
            'company',
            'employer',
            'current',
            'atpco',
            '3victors',
            'data scientist',
            'career',
            'airline',
            'pricing',
            'travel',
        ],
    },
    {
        id: 'fare-model',
        topic: 'Airline Fare Foundation Model',
        text: 'Teo pretrained a transformer-based Airline Fare Foundation Model on 5B+ fare records, beating XGBoost baselines by 18% AUPRC, then productionized it with weekly retraining and drift monitoring.',
        keywords: [
            'foundation model',
            'transformer',
            'fare',
            'pretrain',
            'xgboost',
            'auprc',
            'retraining',
            'drift',
            'mlops',
        ],
    },
    {
        id: 'agents',
        topic: 'AI agent systems',
        text: 'Teo built LangGraph-orchestrated AI agent systems — Graph RAG over 2K+ internal docs, NL-to-SQL exploration, auto-visualization, and anomaly root-cause analysis — that cut recurring analyst tickets by about 80%.',
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
        ],
    },
    {
        id: 'priceeye',
        topic: 'PriceEye pipeline',
        text: 'Teo architected the near-real-time PriceEye pipeline on AWS (2B+ records/day, 300+ airlines) with sub-5-minute latency.',
        keywords: [
            'priceeye',
            'pipeline',
            'data engineering',
            'streaming',
            'real-time',
            'aws',
            'latency',
            'scale',
            'big data',
        ],
    },
    {
        id: 'forecasting',
        topic: 'Demand forecasting',
        text: 'Teo built a multi-horizon demand forecasting system using an LSTM/GRU ensemble at 12% MAPE.',
        keywords: ['forecast', 'forecasting', 'demand', 'time series', 'lstm', 'gru', 'ensemble', 'mape', 'prediction'],
    },
    {
        id: 'nyu-langone',
        topic: 'Medical-imaging research (NYU Langone)',
        text: 'As an AI Research Associate at NYU Langone Health (2024-2025), Teo worked on medical-imaging AI: 4D MRI brain tumor segmentation (nnU-Net/MedSAM, +25% F1), multimodal acute pancreatitis severity prediction (0.95 AUPRC), and HCC recurrence prediction with DINOv2 (C-index 0.85).',
        keywords: [
            'research',
            'medical',
            'imaging',
            'mri',
            'brain',
            'tumor',
            'segmentation',
            'pancreatitis',
            'hcc',
            'cancer',
            'nnu-net',
            'medsam',
            'dinov2',
            'nyu langone',
            'healthcare',
            'radiology',
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
            'tm bier',
            'cost estimation',
            'causal inference',
            'django',
            'react',
            'docker',
        ],
    },
    {
        id: 'edu-nyu',
        topic: 'Education — NYU',
        text: 'Teo earned an M.S. in Data Science from New York University (2023-2025), GPA 3.90/4.00.',
        keywords: [
            'education',
            'degree',
            'masters',
            'ms',
            'nyu',
            'new york university',
            'data science',
            'gpa',
            'school',
            'grad',
            'graduate',
        ],
    },
    {
        id: 'edu-ucsb',
        topic: 'Education — UC Santa Barbara',
        text: 'Teo earned a B.S. from UC Santa Barbara (2019-2023), GPA 3.95/4.00 — a triple major in Applied Mathematics, Statistics & Data Science, and Psychological & Brain Sciences.',
        keywords: [
            'education',
            'degree',
            'bachelors',
            'bs',
            'ucsb',
            'uc santa barbara',
            'undergrad',
            'triple major',
            'applied math',
            'mathematics',
            'statistics',
            'psychology',
            'brain sciences',
            'gpa',
            'college',
            'school',
        ],
    },
    {
        id: 'skills',
        topic: 'Skills & tech stack',
        text: 'Skills: machine learning (predictive modeling, NLP, time series, causal inference, anomaly detection), Python (PyTorch, TensorFlow, JAX, scikit-learn, pandas), SQL, R, Java, C++, MATLAB, and cloud/MLOps (AWS, GCP, Docker, CI/CD, Django, React).',
        keywords: [
            'skill',
            'skills',
            'tech',
            'stack',
            'language',
            'languages',
            'tools',
            'python',
            'pytorch',
            'tensorflow',
            'jax',
            'sql',
            'java',
            'c++',
            'matlab',
            'aws',
            'gcp',
            'docker',
            'mlops',
            'ml',
            'machine learning',
            'nlp',
            'cloud',
        ],
    },
    {
        id: 'publications',
        topic: 'Publications',
        text: 'Teo is a co-author on peer-reviewed papers in medical AI and crystallography, including HCC recurrence prediction (Liver Transplantation), acute pancreatitis severity from CT (Radiology Advances), and deep residual networks for crystallography (Acta Crystallographica Section D).',
        keywords: [
            'publication',
            'publications',
            'paper',
            'papers',
            'research',
            'peer-reviewed',
            'co-author',
            'crystallography',
            'liver transplantation',
            'radiology',
            'acta',
            'scholar',
            'google scholar',
        ],
    },
    {
        id: 'proj-legal',
        topic: 'Project — agentic legal consultant',
        text: 'Teo is building an agentic legal consultant (2026-present) for companies assessing overseas export requirements, with hybrid retrieval and citation-grounded compliance reports.',
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
        ],
    },
    {
        id: 'proj-katrain',
        topic: 'Project — Web-Katrain',
        text: 'Teo built Web-Katrain (2025), a browser-based Go (Weiqi) app using TensorFlow.js and a custom Monte Carlo Tree Search engine for real-time move analysis and game review.',
        // Note: bare "go" is a stopword (the common verb), so the Go board game is
        // matched via the phrase "go game" plus weiqi/baduk/katrain instead.
        keywords: [
            'project',
            'projects',
            'web-katrain',
            'katrain',
            'go game',
            'weiqi',
            'baduk',
            'board game',
            'tensorflow.js',
            'mcts',
            'monte carlo',
            'browser',
        ],
    },
    {
        id: 'interests',
        topic: 'Interests & hobbies',
        text: 'Teo likes traveling, running, basketball and other sports, research, and playing video games.',
        keywords: [
            'interest',
            'interests',
            'hobby',
            'hobbies',
            'like',
            'likes',
            'fun',
            'travel',
            'traveling',
            'run',
            'running',
            'basketball',
            'sport',
            'sports',
            'video games',
            'gaming',
        ],
    },
]

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
        return [byId('role'), byId('identity'), byId('skills')].slice(0, k)
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
