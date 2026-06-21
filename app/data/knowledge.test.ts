// KB accuracy audit (lexical retriever). For a wide battery of realistic visitor
// questions, assert the correct fact-chunk is surfaced. This guards that the
// knowledge base both *covers* every topic and *retrieves* the right chunk — the
// homepage pill uses this exact retriever, and it's a fast proxy for the
// playground's semantic retriever (audited live in semantic.e2e.test.ts).

import { describe, it, expect } from 'vitest'
import { KNOWLEDGE, retrieve } from './knowledge'

function topIds(query: string, k = 4): string[] {
    return retrieve(query, k).map(c => c.id)
}

// Each case: the chunk id we expect to see, and whether it must be the #1 hit.
const CASES: { q: string; id: string; top1?: boolean }[] = [
    // Identity & contact
    { q: "What is Teo's real name?", id: 'identity', top1: true },
    { q: 'Where does Teo live?', id: 'identity' },
    { q: 'Is Teo based in New York?', id: 'identity' },
    { q: 'How can I contact Teo?', id: 'contact', top1: true },
    { q: "What's his email address?", id: 'contact' },
    { q: 'What are all of his social profiles?', id: 'socials' },
    { q: "What is Teo's GitHub?", id: 'github' },
    { q: 'Does Teo have a blog?', id: 'blog', top1: true },
    { q: 'What does Teo write about?', id: 'blog' },

    // Current role
    { q: 'What does Teo do for work?', id: 'role', top1: true },
    { q: 'Where does Teo work right now?', id: 'role' },
    { q: 'Tell me about the airline fare foundation model', id: 'fare-model', top1: true },
    { q: 'Did he beat XGBoost?', id: 'fare-model' },
    { q: 'What AI agent systems has Teo built at work?', id: 'agents' },
    { q: 'Explain the PriceEye pipeline', id: 'priceeye', top1: true },
    { q: 'Has Teo done demand forecasting?', id: 'forecasting', top1: true },

    // Prior experience
    { q: 'What medical imaging research has Teo done?', id: 'nyu-langone' },
    { q: 'Tell me about his work at NYU Langone', id: 'nyu-langone', top1: true },
    { q: 'What did Teo do at T.M. Bier?', id: 'tmbier', top1: true },
    { q: 'Has Teo had an internship?', id: 'tmbier' },

    // Education
    { q: "What's Teo's master's degree?", id: 'edu-nyu' },
    { q: 'Where did Teo study for grad school?', id: 'edu-nyu' },
    { q: 'What did he study at UC Santa Barbara?', id: 'edu-ucsb', top1: true },
    { q: 'Did Teo do a triple major?', id: 'edu-ucsb' },

    // Skills
    { q: 'What machine learning skills does Teo have?', id: 'skills-ml' },
    { q: 'What programming languages does Teo use?', id: 'skills-languages', top1: true },
    { q: 'Does Teo know PyTorch?', id: 'skills-languages' },
    { q: 'What is his cloud and MLOps experience?', id: 'skills-cloud', top1: true },
    { q: 'Has Teo used AWS?', id: 'skills-cloud' },

    // Publications
    { q: 'What papers has Teo published about pancreatitis?', id: 'pub-pancreatitis', top1: true },
    { q: 'Tell me about his crystallography paper', id: 'pub-crystallography', top1: true },
    { q: 'Did Teo publish anything about elder financial exploitation?', id: 'pub-elder-finance', top1: true },

    // Projects
    { q: 'What is the agentic legal consultant project?', id: 'proj-legal', top1: true },
    { q: 'Tell me about Web-KaTrain', id: 'proj-katrain', top1: true },
    { q: 'Did Teo build a chess app?', id: 'proj-web-chess', top1: true },
    { q: 'What is MusicBART?', id: 'proj-musicbart', top1: true },
    { q: 'What is json2vec?', id: 'proj-json2vec', top1: true },

    // Interests & hobbies
    { q: "What are Teo's hobbies?", id: 'interests', top1: true },
    { q: 'Does Teo run?', id: 'hobby-running', top1: true },
    // basketball/Go/chess each have both a "hobby" chunk and a related project or
    // the interests summary — any is an accurate source, so assert top-k presence.
    { q: 'Does Teo like basketball?', id: 'hobby-basketball' },
    { q: 'Does Teo play Weiqi?', id: 'hobby-go' },
    { q: 'Does Teo play chess?', id: 'hobby-chess' },
    { q: 'Does Teo play video games?', id: 'hobby-gaming', top1: true },
    { q: 'Does Teo travel?', id: 'hobby-travel', top1: true },
]

describe('knowledge base retrieval audit', () => {
    for (const c of CASES) {
        it(`"${c.q}" → ${c.id}${c.top1 ? ' (top-1)' : ''}`, () => {
            const ids = topIds(c.q, 4)
            expect(ids, `top hits were: ${ids.join(', ')}`).toContain(c.id)
            if (c.top1) expect(ids[0]).toBe(c.id)
        })
    }
})

describe('knowledge base integrity', () => {
    it('every chunk has a unique id', () => {
        const ids = KNOWLEDGE.map(c => c.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('every chunk has non-empty text, topic and keywords', () => {
        for (const c of KNOWLEDGE) {
            expect(c.text.length, c.id).toBeGreaterThan(10)
            expect(c.topic.length, c.id).toBeGreaterThan(2)
            expect(c.keywords.length, c.id).toBeGreaterThan(0)
        }
    })

    it('retrieve always returns something, even for an empty/greeting query', () => {
        expect(retrieve('').length).toBeGreaterThan(0)
        expect(retrieve('hello there').length).toBeGreaterThan(0)
    })

    it('does not leak a private phone number', () => {
        // Personal phone is intentionally excluded from the public KB.
        const blob = KNOWLEDGE.map(c => `${c.text} ${c.keywords.join(' ')}`).join(' ')
        expect(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(blob)).toBe(false)
    })
})
