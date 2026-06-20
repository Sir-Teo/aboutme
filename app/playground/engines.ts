// The on-device model registry for the /chat playground.
//
// Unlike the homepage "Ask AI" pill (which keeps a WebGPU→WASM→instant fallback
// ladder so it answers on any device), the playground is a *showcase*: a single
// high-quality WebGPU path and an honest hardware gate when WebGPU is missing.
// Per the project direction it uses only Gemma and Liquid AI models.
//
// transformers.js 4.2.0 reality (verified against the installed build):
//  • Plain text models load via the 'text-generation' pipeline.
//  • Multimodal models (Gemma 4, LFM2.5-VL) are NOT in the pipeline registry;
//    they load via their dedicated ConditionalGeneration class + AutoProcessor.
// So each engine declares a `loader` and, for multimodal, the class name.

export type EngineModality = 'text' | 'vision' | 'audio'
export type EngineLoader = 'text' | 'multimodal'

export type Engine = {
    id: string
    // Short label for the model switcher UI.
    label: string
    // Who makes it — drives the little vendor tag in the switcher.
    vendor: 'Google · Gemma' | 'Liquid AI'
    // HF repo id (ONNX). Streams from the HF CDN on first use, then caches in IndexedDB.
    modelId: string
    // How the worker loads it (see file header).
    loader: EngineLoader
    // For multimodal loaders: the exported transformers.js model class name.
    modelClass?: string
    // Quantization. q4f16 keeps f16 activations — smaller + faster on the GPU.
    dtype: 'q4' | 'q4f16' | 'fp16' | 'q8'
    modality: EngineModality[]
    // Does this model reliably emit JSON tool calls? Gates the agentic tab.
    toolCalling: boolean
    // Rough first-download footprint, surfaced in the UI so users aren't surprised.
    sizeLabel: string
    maxNewTokens: number
}

export const ENGINES: Engine[] = [
    // — Chat / agent (text-generation pipeline; verified end-to-end) —
    {
        id: 'lfm2.5-1.2b',
        label: 'LFM2.5 1.2B',
        vendor: 'Liquid AI',
        modelId: 'LiquidAI/LFM2.5-1.2B-Instruct-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        sizeLabel: '~750 MB',
        maxNewTokens: 256,
    },
    {
        id: 'lfm2.5-1.2b-thinking',
        label: 'LFM2.5 1.2B (thinking)',
        vendor: 'Liquid AI',
        modelId: 'LiquidAI/LFM2.5-1.2B-Thinking-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        sizeLabel: '~750 MB',
        maxNewTokens: 384,
    },
    {
        id: 'lfm2.5-350m',
        label: 'LFM2.5 350M (fast)',
        vendor: 'Liquid AI',
        modelId: 'LiquidAI/LFM2.5-350M-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: false,
        sizeLabel: '~290 MB',
        maxNewTokens: 256,
    },
    {
        id: 'gemma-3-1b',
        label: 'Gemma 3 1B',
        vendor: 'Google · Gemma',
        modelId: 'onnx-community/gemma-3-1b-it-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        sizeLabel: '~900 MB',
        maxNewTokens: 256,
    },
    {
        id: 'gemma-3-270m',
        label: 'Gemma 3 270M (fast)',
        vendor: 'Google · Gemma',
        modelId: 'onnx-community/gemma-3-270m-it-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: false,
        sizeLabel: '~240 MB',
        maxNewTokens: 256,
    },
    // — Vision (multimodal class + AutoProcessor) —
    // Gemma 4's ONNX repos ship the full processor config (preprocessor_config.json)
    // that AutoProcessor needs. (LiquidAI's LFM2.5-VL ONNX export omits it, so it
    // can't load via transformers.js 4.2.0.)
    {
        id: 'gemma-4-e2b',
        label: 'Gemma 4 E2B (vision)',
        vendor: 'Google · Gemma',
        modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
        loader: 'multimodal',
        modelClass: 'Gemma4ForConditionalGeneration',
        dtype: 'q4f16',
        modality: ['text', 'vision', 'audio'],
        toolCalling: true,
        sizeLabel: '~3.2 GB',
        maxNewTokens: 256,
    },
    {
        id: 'gemma-4-e4b',
        label: 'Gemma 4 E4B (vision, larger)',
        vendor: 'Google · Gemma',
        modelId: 'onnx-community/gemma-4-E4B-it-ONNX',
        loader: 'multimodal',
        modelClass: 'Gemma4ForConditionalGeneration',
        dtype: 'q4f16',
        modality: ['text', 'vision', 'audio'],
        toolCalling: true,
        sizeLabel: '~5.0 GB',
        maxNewTokens: 256,
    },
]

// The shared embedding model — Gemma's EmbeddingGemma. One model powers semantic
// RAG, long-term memory, and the semantic-search tab. MRL lets us truncate to a
// smaller vector for speed/footprint.
export const EMBEDDING_ENGINE = {
    id: 'embeddinggemma-300m',
    label: 'EmbeddingGemma 300M',
    vendor: 'Google · Gemma' as const,
    modelId: 'onnx-community/embeddinggemma-300m-ONNX',
    dtype: 'q4' as const,
    // Matryoshka truncation dimension (768 full → 256 keeps quality, quarter size).
    dimensions: 256,
    sizeLabel: '~180 MB',
}

// Chat defaults to the fast, fully-verified Liquid text model.
export const DEFAULT_ENGINE_ID = 'lfm2.5-1.2b'

export function engineById(id: string): Engine {
    return ENGINES.find(e => e.id === id) ?? ENGINES[0]
}

// Engines usable as the agentic chat brain. All text models are offered (the
// tiny ones tool-call less reliably, but comparing them is part of the point).
export function chatEngines(): Engine[] {
    return ENGINES.filter(e => e.loader === 'text')
}

// Engines usable in the vision tab (multimodal with an image modality).
export function visionEngines(): Engine[] {
    return ENGINES.filter(e => e.loader === 'multimodal' && e.modality.includes('vision'))
}
