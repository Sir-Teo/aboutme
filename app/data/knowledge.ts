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
// Sources of truth (all the user's own): the résumé-derived `bio` in profile.ts,
// the GitHub profile (github.com/Sir-Teo), Google Scholar, the research blog
// (sir-teo.github.io/blogs), and a curated, privacy-screened pass over Teo's
// private "knowledgebase" Obsidian vault (~/Developer/knowledgebase — résumé,
// transcripts, project/research/skills MOCs). Only public-appropriate facts make
// it in here, and each is cited to a PUBLIC url (LinkedIn/Scholar/GitHub/Kaggle),
// never the vault. Don't add a fact you can't attribute.

// Auto-ingested chunks (GitHub repos + blog posts), refreshed by `npm run ingest`.
// Kept in a separate committed file so static builds need no network; the lexical
// retriever below stays on the hand-curated set, while the semantic retriever in
// app/chat/agent/retrieval.ts reads ALL_KNOWLEDGE (curated + generated).
import { GENERATED_KNOWLEDGE } from './generated'
import { VAULT_KNOWLEDGE } from './vault'

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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        text: "Teo's profiles: GitHub github.com/Sir-Teo, LinkedIn linkedin.com/in/teozeng, Google Scholar (Weicheng Zeng), Kaggle kaggle.com/sirteo, Devpost devpost.com/zengwc-teo2016, Instagram @sir_teo, YouTube @teozeng3999, Bilibili, Strava, Genshin Impact (UID 646322102), Chess.com (masterteo1205), OGS / online-go, and Discord (teozeng).",
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
            'devpost',
            'genshin',
            'genshin impact',
            'hoyolab',
            'dak.gg',
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },

    {
        id: 'math-foundation',
        topic: 'Mathematical foundation',
        text: "Teo's UC Santa Barbara training gave him a deep proof-based mathematics foundation: real and complex analysis, abstract algebra, number theory, topology, numerical analysis, differential equations (ODEs/PDEs), stochastic processes, and operations research — the rigor under his applied ML and statistical modeling work.",
        keywords: [
            'math',
            'mathematics',
            'applied math',
            'pure math',
            'proof',
            'analysis',
            'real analysis',
            'complex analysis',
            'abstract algebra',
            'number theory',
            'topology',
            'numerical analysis',
            'differential equations',
            'pde',
            'stochastic',
            'operations research',
            'foundation',
            'rigor',
            'theory',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },
    {
        id: 'grad-ml-coursework',
        topic: 'Graduate ML/AI coursework',
        text: "Teo's NYU Data Science M.S. coursework spanned deep learning, reinforcement learning, Bayesian machine learning, statistical learning theory, natural language understanding (NLU/NLP), interpretability and causality of language models, and inference and representation — the academic grounding behind his applied LLM and agent work.",
        keywords: [
            'coursework',
            'courses',
            'classes',
            'graduate',
            'masters',
            'nyu',
            'deep learning',
            'reinforcement learning',
            'rl',
            'bayesian',
            'statistical learning theory',
            'nlu',
            'nlp',
            'interpretability',
            'causality',
            'language models',
            'curriculum',
            'studied',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },
    {
        id: 'pioneer',
        topic: 'Pre-college research',
        text: 'Before UC Santa Barbara, Teo did mentored research through the Pioneer Academics program (designing a domain-specific language for circuit drawing) — an early sign of the research-and-implementation bent that runs through his later work.',
        keywords: [
            'pioneer',
            'pioneer academics',
            'high school',
            'pre-college',
            'early research',
            'dsl',
            'domain-specific language',
            'circuit',
            'before college',
            'background',
            'origin',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
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
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },

    // ─────────────────────────────── Approach & breadth ──────────────────────
    {
        id: 'approach',
        topic: 'Approach & working style',
        text: 'Teo works at the boundary between modeling and implementation: he turns ambiguous business or research questions into models, pipelines, dashboards, and validation systems, then explains them to both technical and non-technical audiences. He pairs statistical reasoning with engineering rather than treating them as separate skills.',
        keywords: [
            'approach',
            'working style',
            'how he works',
            'how he thinks',
            'philosophy',
            'process',
            'strengths',
            'end-to-end',
            'modeling',
            'implementation',
            'engineering',
            'communication',
            'what is he like',
            'mindset',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },
    {
        id: 'kaggle',
        topic: 'Kaggle competitions',
        text: 'Teo is an active Kaggle competitor (kaggle.com/sirteo), working problems across computer vision, NLP, time-series, reinforcement learning, and scientific ML — a steady habit of hands-on benchmarking against real datasets.',
        keywords: [
            'kaggle',
            'competition',
            'competitions',
            'compete',
            'sirteo',
            'benchmark',
            'leaderboard',
            'data science competition',
            'practice',
            'datasets',
        ],
        source: { label: 'Kaggle', url: 'https://www.kaggle.com/sirteo' },
    },
    {
        id: 'local-llms',
        topic: 'Open-weight & on-device LLMs',
        text: "Teo experiments hands-on with open-weight and local LLMs — small-model post-training and inference labs, and close reading of model reports (DeepSeek-R1, Qwen3, Phi). That interest is what powers this site's fully on-device 'Ask AI' assistant, which runs models in the browser with no server.",
        keywords: [
            'local llm',
            'open-weight',
            'open weight',
            'on-device',
            'on device',
            'browser',
            'webgpu',
            'transformers.js',
            'post-training',
            'fine-tuning',
            'deepseek',
            'qwen',
            'phi',
            'ollama',
            'lm studio',
            'this assistant',
            'how does this chat work',
        ],
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo' },
    },
    {
        id: 'research-breadth',
        topic: 'Research breadth',
        text: 'Beyond his headline medical-imaging papers, Teo has worked across research areas: conversational memory and conversational alignment (psycholinguistics/NLP), solid-state physics ML (antiferromagnetic-domain segmentation and generative prediction at AIfSR), and scientific machine learning over dynamical systems and Gaussian processes.',
        keywords: [
            'research',
            'research areas',
            'research breadth',
            'interests',
            'conversational memory',
            'conversational alignment',
            'psycholinguistics',
            'physics',
            'solid-state',
            'antiferromagnetic',
            'aifsr',
            'scientific machine learning',
            'dynamical systems',
            'gaussian process',
            'interdisciplinary',
        ],
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
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
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
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
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
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
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
    },
    {
        id: 'pub-hcc',
        topic: 'Publication — hepatocellular carcinoma (HCC) recurrence',
        text: 'Teo (W. Zeng) co-authored work on hepatocellular carcinoma (HCC / liver cancer) recurrence prediction from imaging using DINOv2 (C-index 0.85), published in the liver-transplantation / hepatology literature. The accompanying code is in his GitHub "HCC" repo.',
        keywords: [
            'publication',
            'paper',
            'papers',
            'hcc',
            'hepatocellular',
            'carcinoma',
            'liver',
            'liver cancer',
            'liver transplantation',
            'recurrence',
            'dinov2',
            'c-index',
            'co-author',
            'medical paper',
        ],
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
    },
    {
        id: 'pub-conversational-memory',
        topic: 'Publication — conversational memory',
        text: 'Teo (W. Zeng) co-authored cognitive-science / psycholinguistics research on conversational memory — how conversational partners shape what people say but not what they later recollect — connected to his idea-unit extraction and conversation-alignment work.',
        keywords: [
            'publication',
            'paper',
            'papers',
            'conversational memory',
            'conversation',
            'psycholinguistics',
            'cognitive science',
            'recollection',
            'memory',
            'idea unit',
            'alignment',
            'co-author',
        ],
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
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
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
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
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo/rag-law' },
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
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo/web-katrain' },
    },
    {
        id: 'proj-web-chess',
        topic: 'Project — Web-Chess',
        text: 'Teo built web-chess, a modern, polished chess application built with React, TypeScript, and Vite.',
        keywords: ['project', 'projects', 'web-chess', 'chess app', 'chess application', 'react', 'typescript', 'vite'],
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo/web-chess' },
    },
    {
        id: 'proj-musicbart',
        topic: 'Project — MusicBART',
        text: 'Teo built MusicBART, a project that generates music using the BART sequence-to-sequence model.',
        keywords: ['project', 'projects', 'musicbart', 'music', 'bart', 'generation', 'generative', 'audio', 'seq2seq'],
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo/MusicBART' },
    },
    {
        id: 'proj-json2vec',
        topic: 'Project — json2vec',
        text: 'Teo built json2vec, which turns nested, ragged data into neural representations with typed schemas for prediction and embedding.',
        keywords: ['project', 'projects', 'json2vec', 'json', 'embedding', 'representation', 'schema', 'neural'],
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo' },
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
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo/visualizing-grades' },
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
        source: { label: 'Strava', url: 'https://www.strava.com/athletes/206183585' },
    },
    {
        id: 'hobby-basketball',
        topic: 'Hobby — basketball & sports',
        text: 'Teo is a basketball fan and player, and enjoys sports in general — his GitHub bio even ends with "and basketball!".',
        keywords: ['basketball', 'sport', 'sports', 'ball', 'nba', 'play', 'athletic'],
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo' },
    },
    {
        id: 'hobby-go',
        topic: 'Hobby — Go / Weiqi',
        text: 'Teo plays the board game Go (Weiqi / Baduk) — he has an OGS profile (online-go.com) and built the Web-KaTrain Go-analysis app.',
        keywords: ['go game', 'weiqi', 'baduk', 'ogs', 'online-go', 'board game', 'katrain', 'igo'],
        source: { label: 'OGS', url: 'https://online-go.com/user/view/622443' },
    },
    {
        id: 'hobby-chess',
        topic: 'Hobby — chess',
        text: 'Teo plays chess on Chess.com (member masterteo1205) and built a web-chess application.',
        keywords: ['chess', 'chess.com', 'masterteo1205', 'board game', 'web-chess'],
        source: { label: 'Chess.com', url: 'https://www.chess.com/member/masterteo1205' },
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

// ─────────────────────────────── Overviews (summary tier) ─────────────────────
// Hierarchical "level-1" summary nodes (a lightweight RAPTOR/GraphRAG idea): global
// questions like "summarize Teo's career" or "who is Teo" otherwise retrieve a few
// scattered leaf facts and the small model has to synthesize them. A single dense
// summary node answers them directly. These live in the SEMANTIC index only (via
// ALL_KNOWLEDGE) — kept out of KNOWLEDGE so they don't perturb the lexical retriever
// (and its top-1 audit) or the homepage pill. Each still cites a public source.
export const OVERVIEW_KNOWLEDGE: KnowledgeChunk[] = [
    {
        id: 'overview-bio',
        topic: 'Who Teo is (overview)',
        text: 'Teo (Weicheng Zeng) is a data scientist and AI/ML engineer in the New York City area. He pairs deep mathematical and statistical training (a UCSB triple major, an NYU M.S. in Data Science) with production engineering — building, validating, deploying and explaining models end to end. Today he works on airline pricing and AI systems at 3Victors / ATPCO, with prior medical-imaging AI research at NYU Langone, several peer-reviewed publications, and a wide open-source and writing footprint. Outside work he is into basketball, running, Go and chess, traveling, and video games.',
        keywords: [
            'who is teo',
            'who is he',
            'introduce',
            'introduction',
            'about teo',
            'summary',
            'overview',
            'tell me about',
            'in general',
            'overall',
            'bio',
            'profile',
            'elevator pitch',
            'background',
            'snapshot',
            'everything',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },
    {
        id: 'overview-career',
        topic: 'Career overview',
        text: "Teo's career spans applied data science, ML research, and AI engineering. Now: Data Scientist at 3Victors / ATPCO (airline pricing — a 5B+-record fare foundation model, LangGraph agent systems, the PriceEye real-time pipeline, demand forecasting). Before: AI Research Associate at NYU Langone Health (medical-imaging AI — brain-tumor segmentation, pancreatitis severity, HCC recurrence) and an AI Software Engineer Intern at T.M. Bier & Associates. The throughline is taking ambiguous problems from model to validated, deployed system.",
        keywords: [
            'career',
            'career summary',
            'work history',
            'experience overview',
            'professional background',
            'summarize career',
            'work experience',
            'jobs',
            'roles',
            'trajectory',
            'resume',
            'cv',
            'employment',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },
    {
        id: 'overview-education',
        topic: 'Education overview',
        text: 'Teo holds an M.S. in Data Science from NYU (2023–2025, GPA 3.90) and a B.S. from UC Santa Barbara (2019–2023, GPA 3.95) — a triple major in Applied Mathematics, Statistics & Data Science, and Psychological & Brain Sciences. His coursework runs from proof-based mathematics (analysis, algebra, topology) through deep learning, reinforcement learning, Bayesian ML, NLP, and the interpretability/causality of language models.',
        keywords: [
            'education',
            'education summary',
            'academic background',
            'schooling',
            'degrees',
            'studied',
            'academics',
            'qualifications',
            'where did he study',
            'university',
            'college',
            'coursework overview',
            'gpa',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },
    {
        id: 'overview-research',
        topic: 'Research overview',
        text: "Teo's research is interdisciplinary, with peer-reviewed work across medical-imaging AI (acute-pancreatitis severity from CT, HCC recurrence with DINOv2, brain-tumor segmentation), deep learning for crystallography, and computational social science (elder-financial-exploitation analysis). He has also worked on conversational-memory psycholinguistics, solid-state-physics ML, and scientific ML over dynamical systems. His full list is on Google Scholar.",
        keywords: [
            'research',
            'research summary',
            'research overview',
            'research areas',
            'what research',
            'publications',
            'papers overview',
            'scholar',
            'academic work',
            'areas of study',
            'research interests',
            'fields',
        ],
        source: { label: 'Google Scholar', url: 'https://scholar.google.com/citations?user=lLhU3igAAAAJ&hl=en' },
    },
    {
        id: 'overview-skills',
        topic: 'Skills overview',
        text: "Teo's skills span machine learning (predictive modeling, NLP, time series, causal inference, computer vision, LLM agents), strong math/statistics foundations, Python (PyTorch, TensorFlow, JAX) plus SQL/R/Java/C++, and cloud/MLOps (AWS, GCP, Docker, CI/CD). He works end to end — from modeling and validation to pipelines, dashboards, and deployment — and experiments hands-on with open-weight, on-device LLMs.",
        keywords: [
            'skills',
            'skills overview',
            'capabilities',
            'what can teo do',
            'strengths',
            'expertise',
            'tech stack',
            'technologies',
            'what is he good at',
            'abilities',
            'toolset',
            'competencies',
        ],
        source: { label: 'LinkedIn', url: 'https://www.linkedin.com/in/teozeng' },
    },
    {
        id: 'overview-projects',
        topic: 'Projects overview',
        text: "Teo's projects range from in-browser AI apps — Web-KaTrain (Go analysis with TensorFlow.js + MCTS), web-chess, MusicBART, json2vec — to an agentic legal/export-compliance consultant (rag-law) and the on-device assistant powering this very site. He is also an active Kaggle competitor across vision, NLP, time-series, and scientific ML. His GitHub (Sir-Teo) has the full set.",
        keywords: [
            'projects',
            'projects overview',
            'what has teo built',
            'portfolio',
            'side projects',
            'github projects',
            'apps',
            'what does he build',
            'open source',
            'things he made',
            'repositories',
            'showcase',
        ],
        source: { label: 'GitHub', url: 'https://github.com/Sir-Teo' },
    },
]

// The full knowledge base the semantic agent grounds on: hand-curated facts, the
// summary/overview tier, everything ingested from Teo's public footprint (GitHub
// repos, blog posts), and the privacy-screened coursework/research/experience pass
// over his private vault (VAULT_KNOWLEDGE). The lexical `retrieve` below and the
// homepage pill deliberately stay on the curated KNOWLEDGE only — instant, no
// embedding, and a stable audit target.
export const ALL_KNOWLEDGE: KnowledgeChunk[] = [
    ...KNOWLEDGE,
    ...OVERVIEW_KNOWLEDGE,
    ...GENERATED_KNOWLEDGE,
    ...VAULT_KNOWLEDGE,
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
