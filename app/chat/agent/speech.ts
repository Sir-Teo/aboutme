// Promise wrapper around speech.worker.ts — on-device STT (Whisper/Moonshine) and
// TTS (Kokoro). Owns the worker lifecycle and request ids so the voice module
// just awaits transcribe()/speak().

import { STT_ENGINES, TTS_ENGINE } from '../engines'

type SttConfig = { modelId: string; dtype: 'q4' | 'q8' | 'fp16' }
type TtsConfig = { modelId: string; dtype: 'q8' | 'fp16'; voice: string }

type Res =
    | { type: 'progress'; channel: 'stt' | 'tts'; progress: string }
    | { type: 'transcript'; id: string; text: string }
    | { type: 'audio'; id: string; audio: Float32Array; samplingRate: number }
    | { type: 'error'; id?: string; message: string }

let worker: Worker | null = null
let nextId = 0
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void }
const pending = new Map<string, Pending>()
const sttProgress = new Set<(p: string) => void>()
const ttsProgress = new Set<(p: string) => void>()

export function onSttProgress(fn: (p: string) => void): () => void {
    sttProgress.add(fn)
    return () => sttProgress.delete(fn)
}
export function onTtsProgress(fn: (p: string) => void): () => void {
    ttsProgress.add(fn)
    return () => ttsProgress.delete(fn)
}

function ensureWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('../../components/speech.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<Res>) => {
        const msg = event.data
        if (msg.type === 'progress') {
            ;(msg.channel === 'stt' ? sttProgress : ttsProgress).forEach(fn => fn(msg.progress))
            return
        }
        if (msg.type === 'transcript') {
            pending.get(msg.id)?.resolve(msg.text)
            pending.delete(msg.id)
            return
        }
        if (msg.type === 'audio') {
            pending.get(msg.id)?.resolve({ audio: msg.audio, samplingRate: msg.samplingRate })
            pending.delete(msg.id)
            return
        }
        if (msg.type === 'error' && msg.id) {
            pending.get(msg.id)?.reject(new Error(msg.message))
            pending.delete(msg.id)
        }
    }
    return worker
}

function sttConfig(id: string): SttConfig {
    const e = STT_ENGINES.find(s => s.id === id) ?? STT_ENGINES[0]
    return { modelId: e.modelId, dtype: e.dtype }
}
function ttsConfig(voice: string): TtsConfig {
    return { modelId: TTS_ENGINE.modelId, dtype: TTS_ENGINE.dtype, voice }
}

export function warmSpeech(sttId: string, voice: string = TTS_ENGINE.defaultVoice) {
    const w = ensureWorker()
    w.postMessage({ type: 'warm-stt', stt: sttConfig(sttId) })
    w.postMessage({ type: 'warm-tts', tts: ttsConfig(voice) })
}

export function transcribe(audio: Float32Array, sttId: string): Promise<string> {
    const w = ensureWorker()
    const id = `t${nextId++}`
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        // Transfer the audio buffer to avoid a copy.
        w.postMessage({ type: 'transcribe', id, stt: sttConfig(sttId), audio }, [audio.buffer])
    })
}

export function speak(
    text: string,
    voice: string = TTS_ENGINE.defaultVoice
): Promise<{ audio: Float32Array; samplingRate: number }> {
    const w = ensureWorker()
    const id = `s${nextId++}`
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        w.postMessage({ type: 'speak', id, tts: ttsConfig(voice), text })
    })
}

export function disposeSpeech() {
    worker?.terminate()
    worker = null
    pending.clear()
}

// ───────────────────────── Web Audio playback (main thread) ───────────────────
let audioCtx: AudioContext | null = null

export async function playPcm(audio: Float32Array, samplingRate: number): Promise<void> {
    if (typeof window === 'undefined') return
    audioCtx ??= new (window.AudioContext || (window as any).webkitAudioContext)()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    const buffer = audioCtx.createBuffer(1, audio.length, samplingRate)
    buffer.copyToChannel(audio, 0)
    const source = audioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(audioCtx.destination)
    return new Promise<void>(resolve => {
        source.onended = () => resolve()
        source.start()
    })
}
