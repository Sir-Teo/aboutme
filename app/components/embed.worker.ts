// EmbeddingGemma feature-extraction worker. One shared embedder powers semantic
// RAG, long-term memory, and the semantic-search tab — all on-device via WebGPU.
//
// EmbeddingGemma expects task-specific prompt prefixes (asymmetric retrieval):
// queries and documents are embedded with different instructions. We apply them
// here so callers just say which kind of text they're embedding.

type EmbedKind = 'query' | 'document'

type EmbedRequest =
    | { type: 'warm'; modelId: string; dtype: string }
    | { type: 'embed'; id: string; modelId: string; dtype: string; texts: string[]; kind: EmbedKind; dims: number }
    | { type: 'rerank'; id: string; modelId: string; dtype: string; query: string; passages: string[] }

type EmbedResponse =
    | { type: 'progress'; progress: string }
    | { type: 'ready' }
    | { type: 'embeddings'; id: string; vectors: number[][] }
    | { type: 'scores'; id: string; scores: number[] }
    | { type: 'error'; id?: string; message: string }

const workerSelf = self as unknown as {
    postMessage(message: EmbedResponse): void
    addEventListener(type: 'message', listener: (event: MessageEvent<EmbedRequest>) => void): void
}

let extractor: any = null
let loading: Promise<any> | null = null

function post(message: EmbedResponse) {
    workerSelf.postMessage(message)
}

// Official EmbeddingGemma retrieval prompts.
function withPrefix(text: string, kind: EmbedKind): string {
    return kind === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}`
}

function truncateNormalize(vector: number[], dims: number): number[] {
    const sliced = vector.slice(0, dims)
    let norm = 0
    for (const v of sliced) norm += v * v
    norm = Math.sqrt(norm) || 1
    return sliced.map(v => v / norm)
}

async function load(modelId: string, dtype: string) {
    if (extractor) return extractor
    if (loading) return loading
    loading = (async () => {
        const { env, pipeline } = await import('@huggingface/transformers')
        env.allowLocalModels = false
        env.useBrowserCache = true
        post({ type: 'progress', progress: 'Loading embedder…' })
        extractor = await pipeline('feature-extraction', modelId, {
            dtype: dtype as any,
            device: 'webgpu',
            progress_callback: (p: any) => {
                if (p?.status === 'progress' && typeof p.progress === 'number') {
                    post({ type: 'progress', progress: `Downloading embedder… ${Math.round(p.progress)}%` })
                }
            },
        })
        post({ type: 'ready' })
        return extractor
    })()
    try {
        return await loading
    } finally {
        loading = null
    }
}

async function embed(request: Extract<EmbedRequest, { type: 'embed' }>) {
    try {
        const model = await load(request.modelId, request.dtype)
        const inputs = request.texts.map(t => withPrefix(t, request.kind))
        const output = await model(inputs, { pooling: 'mean', normalize: true })
        const list: number[][] = output.tolist()
        const vectors = list.map(v => truncateNormalize(v, request.dims))
        post({ type: 'embeddings', id: request.id, vectors })
    } catch (error) {
        post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) })
    }
}

// ──────────────────────────────── reranking ──────────────────────────────────
// Two-stage RAG: a cross-encoder re-scores [query, passage] pairs far more
// accurately than the bi-encoder's cosine alone. Loaded lazily, separate model.
let reranker: { tokenizer: any; model: any } | null = null
let rerankLoading: Promise<any> | null = null

async function loadReranker(modelId: string, dtype: string) {
    if (reranker) return reranker
    if (rerankLoading) return rerankLoading
    rerankLoading = (async () => {
        const { env, AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers')
        env.allowLocalModels = false
        env.useBrowserCache = true
        post({ type: 'progress', progress: 'Loading reranker…' })
        const tokenizer = await AutoTokenizer.from_pretrained(modelId)
        const model = await AutoModelForSequenceClassification.from_pretrained(modelId, {
            dtype: dtype as any,
            device: 'webgpu',
            progress_callback: (p: any) => {
                if (p?.status === 'progress' && typeof p.progress === 'number')
                    post({ type: 'progress', progress: `Downloading reranker… ${Math.round(p.progress)}%` })
            },
        })
        reranker = { tokenizer, model }
        return reranker
    })()
    try {
        return await rerankLoading
    } finally {
        rerankLoading = null
    }
}

function sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x))
}

async function rerank(request: Extract<EmbedRequest, { type: 'rerank' }>) {
    try {
        const { tokenizer, model } = await loadReranker(request.modelId, request.dtype)
        const queries = request.passages.map(() => request.query)
        const inputs = tokenizer(queries, { text_pair: request.passages, padding: true, truncation: true })
        const { logits } = await model(inputs)
        const raw: number[] = logits.tolist().map((row: number[]) => row[0])
        post({ type: 'scores', id: request.id, scores: raw.map(sigmoid) })
    } catch (error) {
        post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) })
    }
}

workerSelf.addEventListener('message', event => {
    const request = event.data
    if (request.type === 'warm') {
        void load(request.modelId, request.dtype).catch(() => undefined)
        return
    }
    if (request.type === 'embed') void embed(request)
    else if (request.type === 'rerank') void rerank(request)
})

export {}
