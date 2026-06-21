// The on-device model registry for the /chat playground.
//
// The playground is a *showcase* of what runs entirely in the browser. It spans
// three inference runtimes, each picked where it's strongest:
//
//   • 'transformers' — Hugging Face transformers.js (ONNX + WebGPU). Powers the
//      Gemma / Liquid AI ONNX models, all vision/audio, embeddings and rerank.
//   • 'webllm'       — MLC WebLLM (compiled WebGPU kernels). The fastest path for
//      bigger general LLMs (Llama, Qwen3, Phi, Gemma 2, SmolLM2) and the one that
//      gives us grammar-constrained JSON decoding for rock-solid tool calls.
//   • 'chrome'       — Chrome's built-in Prompt API (Gemini Nano). Zero download,
//      runs on the browser's own model; surfaced only when the browser exposes it.
//
// transformers.js 4.2.0 reality (verified against the installed build):
//  • Plain text models load via the 'text-generation' pipeline.
//  • Multimodal models (Gemma 4, LFM2-VL) are NOT in the pipeline registry; they
//    load via their dedicated ConditionalGeneration class + AutoProcessor.
// So each transformers engine declares a `loader` and, for multimodal, the class.

export type EngineModality = 'text' | 'vision' | 'audio'
export type EngineLoader = 'text' | 'multimodal'
export type EngineRuntime = 'transformers' | 'webllm' | 'chrome'

export type Engine = {
    id: string
    // Short label for the model switcher UI.
    label: string
    // Which in-browser runtime executes this engine.
    runtime: EngineRuntime
    // Who makes it — drives the little vendor tag in the switcher.
    vendor:
        | 'Google · Gemma'
        | 'Liquid AI'
        | 'Meta · Llama'
        | 'Alibaba · Qwen'
        | 'Microsoft · Phi'
        | 'Hugging Face'
        | 'Google · Chrome'
    // The model identifier: an HF repo id (transformers) or an MLC model id
    // (webllm). Empty for the Chrome engine, which has no download.
    modelId: string
    // transformers.js: how the worker loads it (see file header).
    loader: EngineLoader
    // For multimodal transformers loaders: the exported model class name.
    modelClass?: string
    // transformers.js quantization. q4f16 keeps f16 activations — smaller + faster.
    dtype: 'q4' | 'q4f16' | 'fp16' | 'q8'
    modality: EngineModality[]
    // Does this model reliably emit JSON tool calls? Gates the agentic tab.
    toolCalling: boolean
    // Does this runtime/model support grammar-constrained JSON decoding? (WebLLM
    // does via XGrammar — the planner uses it for guaranteed-valid tool calls.)
    constrainedJson?: boolean
    // Rough first-download footprint, surfaced in the UI so users aren't surprised.
    sizeLabel: string
    maxNewTokens: number
}

export const ENGINES: Engine[] = [
    // ───────────────────────── transformers.js (ONNX + WebGPU) ─────────────────
    // — Liquid AI (text-generation pipeline; verified end-to-end) —
    {
        id: 'lfm2.5-1.2b',
        label: 'LFM2.5 1.2B',
        runtime: 'transformers',
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
        runtime: 'transformers',
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
        id: 'lfm2-2.6b',
        label: 'LFM2 2.6B (bigger)',
        runtime: 'transformers',
        vendor: 'Liquid AI',
        modelId: 'onnx-community/LFM2-2.6B-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        sizeLabel: '~1.7 GB',
        maxNewTokens: 320,
    },
    {
        id: 'lfm2-8b-a1b',
        label: 'LFM2 8B-A1B (MoE flagship)',
        runtime: 'transformers',
        vendor: 'Liquid AI',
        modelId: 'onnx-community/LFM2-8B-A1B-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        sizeLabel: '~4.7 GB',
        maxNewTokens: 384,
    },
    {
        id: 'lfm2.5-350m',
        label: 'LFM2.5 350M (fast)',
        runtime: 'transformers',
        vendor: 'Liquid AI',
        modelId: 'onnx-community/LFM2.5-350M-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: false,
        sizeLabel: '~290 MB',
        maxNewTokens: 256,
    },
    // — Google · Gemma (text-generation pipeline) —
    {
        id: 'gemma-3-1b',
        label: 'Gemma 3 1B',
        runtime: 'transformers',
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
        runtime: 'transformers',
        vendor: 'Google · Gemma',
        modelId: 'onnx-community/gemma-3-270m-it-ONNX',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: false,
        sizeLabel: '~240 MB',
        maxNewTokens: 256,
    },

    // ───────────────────────── MLC WebLLM (compiled WebGPU) ────────────────────
    // Bigger general-purpose LLMs + grammar-constrained JSON. Model ids are MLC
    // prebuilt ids (verified against web-llm 0.2.84 prebuiltAppConfig).
    {
        id: 'webllm-llama-3.2-3b',
        label: 'Llama 3.2 3B',
        runtime: 'webllm',
        vendor: 'Meta · Llama',
        modelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        constrainedJson: true,
        sizeLabel: '~1.8 GB',
        maxNewTokens: 320,
    },
    {
        id: 'webllm-qwen3-4b',
        label: 'Qwen3 4B',
        runtime: 'webllm',
        vendor: 'Alibaba · Qwen',
        modelId: 'Qwen3-4B-q4f16_1-MLC',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        constrainedJson: true,
        sizeLabel: '~2.5 GB',
        maxNewTokens: 384,
    },
    {
        id: 'webllm-phi-3.5-mini',
        label: 'Phi-3.5 mini',
        runtime: 'webllm',
        vendor: 'Microsoft · Phi',
        modelId: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        constrainedJson: true,
        sizeLabel: '~2.2 GB',
        maxNewTokens: 320,
    },
    {
        id: 'webllm-gemma-2-2b',
        label: 'Gemma 2 2B',
        runtime: 'webllm',
        vendor: 'Google · Gemma',
        modelId: 'gemma-2-2b-it-q4f16_1-MLC',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        constrainedJson: true,
        sizeLabel: '~1.6 GB',
        maxNewTokens: 320,
    },
    {
        id: 'webllm-smollm2-1.7b',
        label: 'SmolLM2 1.7B (fast)',
        runtime: 'webllm',
        vendor: 'Hugging Face',
        modelId: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: true,
        constrainedJson: true,
        sizeLabel: '~1.2 GB',
        maxNewTokens: 256,
    },

    // ───────────────────────── Chrome built-in (Gemini Nano) ───────────────────
    // Zero download — runs on Chrome's own on-device model. Only usable when the
    // browser exposes the Prompt API (LanguageModel); the UI hides it otherwise.
    {
        id: 'chrome-nano',
        label: 'Gemini Nano (Chrome)',
        runtime: 'chrome',
        vendor: 'Google · Chrome',
        modelId: '',
        loader: 'text',
        dtype: 'q4f16',
        modality: ['text'],
        toolCalling: false,
        sizeLabel: 'built-in · 0 MB',
        maxNewTokens: 320,
    },

    // ───────────────────────── Vision (transformers multimodal) ────────────────
    // Gemma 4's ONNX repos ship the full processor config (preprocessor_config.json)
    // that AutoProcessor needs.
    {
        id: 'gemma-4-e2b',
        label: 'Gemma 4 E2B (vision)',
        runtime: 'transformers',
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
        runtime: 'transformers',
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
    {
        id: 'lfm2-vl-1.6b',
        label: 'LFM2-VL 1.6B (vision)',
        runtime: 'transformers',
        vendor: 'Liquid AI',
        modelId: 'onnx-community/LFM2-VL-1.6B-ONNX',
        loader: 'multimodal',
        modelClass: 'Lfm2VlForConditionalGeneration',
        dtype: 'q4f16',
        modality: ['text', 'vision'],
        toolCalling: false,
        sizeLabel: '~1.2 GB',
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

// ─────────────────── Helper models for the non-LLM experiments ────────────────
// Reranker for two-stage RAG (retrieve → rerank). Cross-encoder, scores a
// [query, passage] pair. Loaded as a sequence-classification model.
export const RERANKER_ENGINE = {
    id: 'bge-reranker-base',
    label: 'BGE reranker base',
    modelId: 'onnx-community/bge-reranker-base-ONNX',
    dtype: 'q8' as const,
    sizeLabel: '~280 MB',
}

// Speech-to-text for the voice agent. Whisper is the quality default; Moonshine
// is the very-low-latency option for streaming.
export const STT_ENGINES = [
    {
        id: 'whisper-base',
        label: 'Whisper base',
        modelId: 'onnx-community/whisper-base',
        dtype: 'q4' as const,
        sizeLabel: '~80 MB',
    },
    {
        id: 'moonshine-base',
        label: 'Moonshine base (low-latency)',
        modelId: 'onnx-community/moonshine-base-ONNX',
        dtype: 'q4' as const,
        sizeLabel: '~60 MB',
    },
]

// Text-to-speech for the voice agent. Kokoro-82M, run via kokoro-js (WebGPU/WASM).
export const TTS_ENGINE = {
    id: 'kokoro-82m',
    label: 'Kokoro 82M',
    modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype: 'q8' as const,
    sizeLabel: '~330 MB',
    defaultVoice: 'af_heart',
}

// Pixel-vision "lab" toys — transformers.js pipelines that transform an image.
export type VisionLabTask = 'background-removal' | 'depth-estimation' | 'object-detection'
export const VISION_LAB_TASKS: { id: VisionLabTask; label: string; modelId: string; blurb: string }[] = [
    {
        id: 'background-removal',
        label: 'Remove background',
        modelId: 'briaai/RMBG-1.4',
        blurb: 'Cut the subject out — alpha-matte background removal.',
    },
    {
        id: 'depth-estimation',
        label: 'Depth map',
        modelId: 'onnx-community/depth-anything-v2-small',
        blurb: 'Estimate per-pixel depth (Depth Anything v2).',
    },
    {
        id: 'object-detection',
        label: 'Detect objects',
        modelId: 'Xenova/detr-resnet-50',
        blurb: 'Find and label objects with bounding boxes (DETR).',
    },
]

// In-browser text-to-image. SD-Turbo (single-step) via onnxruntime-web + WebGPU.
export const IMAGE_GEN_ENGINE = {
    id: 'sd-turbo',
    label: 'SD-Turbo',
    modelId: 'schmuell/sd-turbo-ort-web',
    sizeLabel: '~2.5 GB',
}

// Chat defaults to the fast, fully-verified Liquid text model.
export const DEFAULT_ENGINE_ID = 'lfm2.5-1.2b'

export function engineById(id: string): Engine {
    return ENGINES.find(e => e.id === id) ?? ENGINES[0]
}

// Engines usable as the agentic chat brain: any text-capable engine that isn't a
// vision-only multimodal model. Spans all three runtimes. The Chrome engine is
// included but the UI only offers it when the Prompt API is actually present.
export function chatEngines(): Engine[] {
    return ENGINES.filter(e => e.modality.includes('text') && e.loader !== 'multimodal')
}

// Engines usable in the vision tab (multimodal with an image modality).
export function visionEngines(): Engine[] {
    return ENGINES.filter(e => e.loader === 'multimodal' && e.modality.includes('vision'))
}
