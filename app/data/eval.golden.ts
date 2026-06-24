// Golden retrieval set: realistic visitor questions → the chunk id(s) that should
// be retrieved to answer them. A retrieval "hits" if ANY acceptable id appears in
// the top-k. This is the ground truth behind the eval harness:
//   • app/data/eval.test.ts          — always-on structural checks (ids exist, etc.)
//   • app/chat/agent/retrieval-hybrid.e2e.test.ts — real models, recall@k + MRR
//
// Keep questions paraphrased (low surface overlap with the chunk) so they test
// genuine retrieval, and span every tier: curated facts, summary/overview nodes,
// ingested GitHub/blog, and the private-vault coursework/research pass.

export type GoldenCase = { q: string; ids: string[] }

export const GOLDEN: GoldenCase[] = [
    // ── Identity / contact / presence ──
    { q: "What's Teo's full legal name?", ids: ['identity'] },
    { q: 'Which city does he live in?', ids: ['identity'] },
    { q: 'How would I reach out to him?', ids: ['contact', 'socials'] },
    { q: 'Where can I find all his online profiles?', ids: ['socials'] },
    { q: 'Does he keep a journal of technical notes?', ids: ['blog'] },

    // ── Current role / work highlights ──
    { q: 'What does Teo do for a living?', ids: ['role', 'overview-career'] },
    { q: 'Tell me about the transformer he pretrained on billions of fares.', ids: ['fare-model'] },
    { q: 'What agent systems has he shipped at his job?', ids: ['agents'] },
    { q: 'Describe the low-latency data pipeline he built on AWS.', ids: ['priceeye'] },
    { q: 'Has he done any demand prediction with neural nets?', ids: ['forecasting'] },

    // ── Prior experience ──
    { q: 'Tell me about his hospital scan research.', ids: ['nyu-langone', 'vault-nyu-langone-medical-ai-research'] },
    { q: 'What did he do during his internship?', ids: ['tmbier', 'vault-atpco-internship-and-airline-data-work'] },

    // ── Education ──
    { q: 'Where did Teo earn his graduate degree?', ids: ['edu-nyu', 'overview-education'] },
    { q: 'What was his undergraduate major?', ids: ['edu-ucsb', 'overview-education', 'overview-bio'] },
    { q: 'How strong is his pure-math background?', ids: ['math-foundation', 'overview-education'] },
    { q: 'Did he study anything before university?', ids: ['pioneer'] },

    // ── Skills ──
    { q: 'Which deep-learning frameworks does he code in?', ids: ['skills-languages', 'overview-skills'] },
    { q: 'What is his cloud and deployment experience?', ids: ['skills-cloud', 'overview-skills'] },
    { q: 'What kinds of ML problems can he handle?', ids: ['skills-ml', 'overview-skills'] },

    // ── Publications / research ──
    { q: 'Has he published on the pancreas?', ids: ['pub-pancreatitis'] },
    { q: 'Tell me about his crystallography paper.', ids: ['pub-crystallography'] },
    { q: 'Any work on liver cancer recurrence?', ids: ['pub-hcc', 'vault-nyu-langone-medical-ai-research'] },
    { q: 'Did he research how people remember conversations?', ids: ['pub-conversational-memory', 'research-breadth'] },
    {
        q: 'What research has he done in physics?',
        ids: ['research-breadth', 'vault-aifsr-solid-state-physics-vip-work'],
    },

    // ── Projects ──
    { q: 'What is his agentic legal-compliance project?', ids: ['proj-legal'] },
    {
        q: 'Which Go-analysis app did he build in the browser?',
        ids: ['proj-katrain', 'hobby-go', 'vault-web-katrain-browser-go-ai-app'],
    },
    { q: 'Did he make a chess application?', ids: ['proj-web-chess'] },
    { q: 'What is the music-generation project?', ids: ['proj-musicbart'] },
    { q: 'Does he compete on Kaggle?', ids: ['kaggle'] },
    {
        q: 'Does he experiment with local open-weight language models?',
        ids: ['local-llms', 'vault-mini-llm-lab-local-post-training-workbench'],
    },

    // ── Hobbies ──
    { q: 'What sports is he into?', ids: ['hobby-basketball', 'interests', 'overview-bio'] },
    { q: 'Does he track his runs anywhere?', ids: ['hobby-running'] },
    { q: 'What board games does he play?', ids: ['hobby-go', 'hobby-chess', 'interests'] },
    { q: 'What is his chess username?', ids: ['hobby-chess', 'socials'] },

    // ── Vault coursework (the new long-tail) ──
    {
        q: 'Did Teo take real analysis?',
        ids: [
            'vault-ucsb-math-117-real-analysis-coursework',
            'vault-ucsb-math-118a-and-118b-real-analysis-coursework',
            'math-foundation',
            'overview-education',
        ],
    },
    { q: 'Has he studied topology?', ids: ['vault-ucsb-math-145-topology-coursework', 'math-foundation'] },
    {
        q: 'Did he take a reinforcement learning class?',
        ids: ['vault-nyu-ds-ga-3001-reinforcement-learning-coursework', 'grad-ml-coursework'],
    },
    {
        q: 'What did he learn about Bayesian methods in grad school?',
        ids: ['vault-nyu-bayesian-machine-learning-coursework', 'grad-ml-coursework'],
    },
    {
        q: 'Did he study how to interpret language models?',
        ids: ['vault-nyu-interpretability-and-causality-of-language-models-coursework', 'grad-ml-coursework'],
    },

    // ── Ingested (GitHub / blog) ──
    { q: 'What is the mica project on his GitHub?', ids: ['gh-mica'] },

    // ── Global / aggregative (the summary tier earns its keep here) ──
    { q: 'Give me a quick overview of who Teo is.', ids: ['overview-bio', 'identity', 'role'] },
    { q: 'Summarize his career so far.', ids: ['overview-career', 'role'] },
    { q: 'What are his main strengths?', ids: ['overview-skills', 'approach', 'skills-ml'] },
    { q: 'What is his overall research focus?', ids: ['overview-research', 'research-breadth'] },
    {
        q: 'What has he built, broadly?',
        ids: ['overview-projects', 'proj-katrain', 'proj-web-chess', 'proj-musicbart', 'proj-json2vec'],
    },
    { q: 'How does Teo approach problems?', ids: ['approach', 'overview-skills'] },
]
