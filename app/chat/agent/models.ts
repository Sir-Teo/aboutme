// Model download bookkeeping for the model manager UI: which engines are cached
// on disk, marking new downloads, and deleting a cached model to reclaim space.
//
// Detection is per-runtime:
//   • webllm        → WebLLM's own hasModelInCache / deleteModelAllInfoInCache.
//   • transformers  → probe the Cache Storage bucket transformers.js writes to.
//   • chrome        → the built-in model needs no download; "available" ⇒ ready.
// We also keep a localStorage marker set when an engine finishes loading, as a
// fast, reliable record that survives even if a cache probe is imperfect.

import type { Engine } from '../engines'
import { chromeAIAvailable } from './chromeai'

const LS_KEY = 'playground:models:downloaded'
const TRANSFORMERS_CACHE = 'transformers-cache'

export type DownloadState = 'downloaded' | 'absent'

function readMarkers(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set()
    try {
        const raw = localStorage.getItem(LS_KEY)
        return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
        return new Set()
    }
}
function writeMarkers(set: Set<string>) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set)))
    } catch {
        /* storage full / disabled — detection just falls back to cache probing */
    }
}

export function markDownloaded(engineId: string) {
    const set = readMarkers()
    if (!set.has(engineId)) {
        set.add(engineId)
        writeMarkers(set)
    }
}

async function transformersCached(modelId: string): Promise<boolean> {
    if (typeof caches === 'undefined' || !modelId) return false
    try {
        const cache = await caches.open(TRANSFORMERS_CACHE)
        const keys = await cache.keys()
        return keys.some(req => req.url.includes(modelId))
    } catch {
        return false
    }
}

// Is this engine's weights already on the device (no re-download needed)?
export async function isDownloaded(engine: Engine): Promise<boolean> {
    if (readMarkers().has(engine.id)) return true
    if (engine.runtime === 'chrome') return chromeAIAvailable()
    if (engine.runtime === 'webllm') {
        try {
            const { hasModelInCache, prebuiltAppConfig } = await import('@mlc-ai/web-llm')
            return await hasModelInCache(engine.modelId, prebuiltAppConfig)
        } catch {
            return false
        }
    }
    return transformersCached(engine.modelId)
}

// Compute download state for a list of engines in one pass (for the manager UI).
export async function downloadStates(engines: Engine[]): Promise<Record<string, DownloadState>> {
    const entries = await Promise.all(
        engines.map(async e => [e.id, (await isDownloaded(e)) ? 'downloaded' : 'absent'] as const)
    )
    return Object.fromEntries(entries)
}

// Remove a cached model from disk and clear its marker.
export async function deleteDownload(engine: Engine): Promise<void> {
    const set = readMarkers()
    set.delete(engine.id)
    writeMarkers(set)

    if (engine.runtime === 'webllm') {
        try {
            const { deleteModelAllInfoInCache, prebuiltAppConfig } = await import('@mlc-ai/web-llm')
            await deleteModelAllInfoInCache(engine.modelId, prebuiltAppConfig)
        } catch {
            /* best-effort */
        }
        return
    }
    if (engine.runtime === 'transformers' && typeof caches !== 'undefined' && engine.modelId) {
        try {
            const cache = await caches.open(TRANSFORMERS_CACHE)
            const keys = await cache.keys()
            await Promise.all(keys.filter(req => req.url.includes(engine.modelId)).map(req => cache.delete(req)))
        } catch {
            /* best-effort */
        }
    }
    // chrome: built-in model, nothing to delete.
}
