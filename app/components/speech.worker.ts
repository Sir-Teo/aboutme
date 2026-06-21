// Speech worker for the voice agent: on-device speech-to-text (Whisper /
// Moonshine via transformers.js) and text-to-speech (Kokoro-82M via kokoro-js).
// Both run on WebGPU, off the main thread. Audio is exchanged as raw Float32
// (16 kHz in for STT; the model's native rate out for TTS) so nothing touches a
// server. Mirrors model.worker.ts: lazy load, cache the resident model, stream
// progress.

type SttConfig = { modelId: string; dtype: 'q4' | 'q8' | 'fp16' }
type TtsConfig = { modelId: string; dtype: 'q8' | 'fp16'; voice: string }

type Req =
    | { type: 'warm-stt'; stt: SttConfig }
    | { type: 'warm-tts'; tts: TtsConfig }
    | { type: 'transcribe'; id: string; stt: SttConfig; audio: Float32Array }
    | { type: 'speak'; id: string; tts: TtsConfig; text: string }

type Res =
    | { type: 'progress'; channel: 'stt' | 'tts'; progress: string }
    | { type: 'transcript'; id: string; text: string }
    | { type: 'audio'; id: string; audio: Float32Array; samplingRate: number }
    | { type: 'error'; id?: string; message: string }

const workerSelf = self as unknown as {
    postMessage(message: Res, transfer?: Transferable[]): void
    addEventListener(type: 'message', listener: (event: MessageEvent<Req>) => void): void
}

function post(message: Res, transfer?: Transferable[]) {
    workerSelf.postMessage(message, transfer)
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function fileLabel(file: unknown): string {
    if (typeof file !== 'string' || !file) return 'files'
    return file.split('/').pop() || file
}

function progressText(p: any): string | null {
    const pct = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
    if (p?.status === 'progress' && typeof p.progress === 'number')
        return `Downloading ${fileLabel(p.file)}… ${pct(p.progress)}%`
    if (p?.status === 'initiate' || p?.status === 'download') return `Fetching ${fileLabel(p.file)}…`
    if (p?.status === 'ready' || p?.status === 'done') return 'Warming up…'
    return null
}

// ─────────────────────────────────── STT ─────────────────────────────────────
let asr: { modelId: string; pipe: any } | null = null
let asrLoading: Promise<any> | null = null

async function loadAsr(stt: SttConfig) {
    if (asr?.modelId === stt.modelId) return asr.pipe
    if (asrLoading) return asrLoading
    asrLoading = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers')
        env.allowLocalModels = false
        env.useBrowserCache = true
        if (asr) {
            try {
                await asr.pipe?.dispose?.()
            } catch {
                /* best-effort */
            }
            asr = null
        }
        const pipe = await pipeline('automatic-speech-recognition', stt.modelId, {
            dtype: stt.dtype,
            device: 'webgpu',
            progress_callback: (p: any) => {
                const t = progressText(p)
                if (t) post({ type: 'progress', channel: 'stt', progress: t })
            },
        })
        asr = { modelId: stt.modelId, pipe }
        return pipe
    })()
    try {
        return await asrLoading
    } finally {
        asrLoading = null
    }
}

async function transcribe(req: Extract<Req, { type: 'transcribe' }>) {
    try {
        const pipe = await loadAsr(req.stt)
        const out = await pipe(req.audio, { chunk_length_s: 30, return_timestamps: false })
        const text = (Array.isArray(out) ? out[0]?.text : out?.text) ?? ''
        post({ type: 'transcript', id: req.id, text: String(text).trim() })
    } catch (error) {
        post({ type: 'error', id: req.id, message: errorMessage(error) })
    }
}

// ─────────────────────────────────── TTS ─────────────────────────────────────
let tts: { modelId: string; engine: any } | null = null
let ttsLoading: Promise<any> | null = null

async function loadTts(cfg: TtsConfig) {
    if (tts?.modelId === cfg.modelId) return tts.engine
    if (ttsLoading) return ttsLoading
    ttsLoading = (async () => {
        const { KokoroTTS } = await import('kokoro-js')
        const engine = await KokoroTTS.from_pretrained(cfg.modelId, {
            dtype: cfg.dtype,
            device: 'webgpu',
            progress_callback: (p: any) => {
                const t = progressText(p)
                if (t) post({ type: 'progress', channel: 'tts', progress: t })
            },
        } as any)
        tts = { modelId: cfg.modelId, engine }
        return engine
    })()
    try {
        return await ttsLoading
    } finally {
        ttsLoading = null
    }
}

async function speak(req: Extract<Req, { type: 'speak' }>) {
    try {
        const engine = await loadTts(req.tts)
        const audio: any = await engine.generate(req.text, { voice: req.tts.voice })
        const data: Float32Array = audio.audio instanceof Float32Array ? audio.audio : new Float32Array(audio.audio)
        const samplingRate: number = audio.sampling_rate ?? 24000
        // Copy into a fresh buffer we can transfer (the model may keep its own).
        const out = new Float32Array(data)
        post({ type: 'audio', id: req.id, audio: out, samplingRate }, [out.buffer])
    } catch (error) {
        post({ type: 'error', id: req.id, message: errorMessage(error) })
    }
}

workerSelf.addEventListener('message', event => {
    const req = event.data
    if (req.type === 'warm-stt') void loadAsr(req.stt).catch(() => undefined)
    else if (req.type === 'warm-tts') void loadTts(req.tts).catch(() => undefined)
    else if (req.type === 'transcribe') void transcribe(req)
    else if (req.type === 'speak') void speak(req)
})

export {}
