'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import GpuGate from '../GpuGate'
import { profile } from '../../data/profile'
import { engineById, STT_ENGINES } from '../engines'
import { generate, warm, disposeModel } from '../agent/runtime'
import { groundingBlock, warmIndex } from '../agent/retrieval'
import { warmEmbedder } from '../agent/embeddings'
import { warmSpeech, transcribe, speak, playPcm, onSttProgress, onTtsProgress, disposeSpeech } from '../agent/speech'

// Real-time voice agent — a fully on-device speech loop:
//   • Turn-taking: Silero VAD (@ricky0123/vad-web) detects when you start/stop.
//   • Speech-to-text: Whisper / Moonshine (transformers.js, WebGPU).
//   • Answer: a Liquid LFM2.5 model, grounded in the profile RAG (WebGPU).
//   • Text-to-speech: Kokoro-82M (kokoro-js, WebGPU), played via Web Audio.
// Nothing leaves the device — mic audio, transcript and reply all stay local.

const ANSWER_ENGINE = engineById('lfm2.5-1.2b')
type Mode = 'idle' | 'loading' | 'listening' | 'thinking' | 'speaking'

function VoiceInner() {
    const [mode, setMode] = useState<Mode>('idle')
    const [transcript, setTranscript] = useState('')
    const [answer, setAnswer] = useState('')
    const [status, setStatus] = useState('')
    const [sttId, setSttId] = useState(STT_ENGINES[0].id)
    const [error, setError] = useState('')
    const vadRef = useRef<any>(null)
    const activeRef = useRef(false) // user wants the loop running
    const busyRef = useRef(false) // a turn is being processed
    const sttIdRef = useRef(sttId)
    sttIdRef.current = sttId

    // Warm the answer model + retrieval + speech models up front.
    useEffect(() => {
        warmEmbedder()
        warmIndex()
        warm(ANSWER_ENGINE)
        warmSpeech(sttIdRef.current)
        const off1 = onSttProgress(setStatus)
        const off2 = onTtsProgress(setStatus)
        return () => {
            off1()
            off2()
            activeRef.current = false
            try {
                vadRef.current?.pause?.()
                void vadRef.current?.destroy?.()
            } catch {
                /* already gone */
            }
            disposeModel()
            disposeSpeech()
        }
    }, [])

    // Answer one transcribed question: grounded, on-device, spoken back.
    const answerQuestion = useCallback(async (question: string) => {
        const grounding = await groundingBlock(question, 5)
        const system = [
            `You are a friendly assistant on ${profile.name}'s website. Refer to him as Teo.`,
            `Answer in one or two short spoken sentences using only the facts below.`,
            ``,
            grounding,
        ].join('\n')
        let full = ''
        await generate(
            ANSWER_ENGINE,
            [
                { role: 'system', content: system },
                { role: 'user', content: question },
            ],
            {
                onProgress: setStatus,
                onReady: () => setStatus(''),
                onChunk: chunk => {
                    full += chunk
                    setAnswer(full)
                },
            }
        )
        return full
    }, [])

    // The turn pipeline: STT → answer → TTS. VAD is paused while we process so the
    // model's own voice can't trigger another turn (no feedback loop).
    const handleUtterance = useCallback(
        async (audio: Float32Array) => {
            if (busyRef.current) return
            busyRef.current = true
            try {
                vadRef.current?.pause?.()
                setMode('thinking')
                setAnswer('')
                setStatus('Transcribing…')
                const text = await transcribe(audio, sttIdRef.current)
                if (!text) {
                    setStatus('')
                    return
                }
                setTranscript(text)
                setStatus('Thinking…')
                const reply = await answerQuestion(text)
                setMode('speaking')
                setStatus('Speaking…')
                if (reply.trim()) {
                    const { audio: wav, samplingRate } = await speak(reply)
                    await playPcm(wav, samplingRate)
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Voice pipeline error.')
            } finally {
                busyRef.current = false
                setStatus('')
                // Resume listening if the user hasn't stopped the loop.
                if (activeRef.current && vadRef.current) {
                    try {
                        await vadRef.current.start()
                        setMode('listening')
                    } catch {
                        /* mic gone */
                    }
                } else {
                    setMode('idle')
                }
            }
        },
        [answerQuestion]
    )

    const start = useCallback(async () => {
        setError('')
        activeRef.current = true
        setMode('loading')
        setStatus('Starting microphone…')
        try {
            if (!vadRef.current) {
                const { MicVAD } = await import('@ricky0123/vad-web')
                vadRef.current = await MicVAD.new({
                    model: 'v5',
                    onSpeechStart: () => setMode('listening'),
                    onSpeechEnd: (audio: Float32Array) => void handleUtterance(audio),
                })
            }
            await vadRef.current.start()
            setMode('listening')
            setStatus('')
        } catch (e) {
            activeRef.current = false
            setMode('idle')
            setError(e instanceof Error ? e.message : 'Microphone access denied.')
        }
    }, [handleUtterance])

    const stop = useCallback(() => {
        activeRef.current = false
        try {
            vadRef.current?.pause?.()
        } catch {
            /* already paused */
        }
        setMode('idle')
        setStatus('')
    }, [])

    const running = mode === 'listening' || mode === 'thinking' || mode === 'speaking' || mode === 'loading'

    const label =
        mode === 'loading'
            ? status || 'Loading…'
            : mode === 'listening'
            ? 'Listening… speak, then pause'
            : mode === 'thinking'
            ? status || 'Thinking…'
            : mode === 'speaking'
            ? 'Speaking…'
            : 'Tap to start the conversation'

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] text-slate-400">
                    Silero VAD · {STT_ENGINES.find(s => s.id === sttId)?.label} · {ANSWER_ENGINE.label} · Kokoro TTS —
                    all on-device
                </p>
                <label className="shrink-0 text-[12px] text-slate-400">
                    <span className="sr-only">Speech-to-text model</span>
                    <select
                        value={sttId}
                        onChange={e => setSttId(e.target.value)}
                        disabled={running}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600 outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                        {STT_ENGINES.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="mt-4 flex flex-col items-center gap-3 py-4">
                <button
                    type="button"
                    onClick={running ? stop : start}
                    className={`grid h-16 w-16 place-items-center rounded-full text-white transition ${
                        mode === 'listening'
                            ? 'animate-pulse bg-rose-500 hover:bg-rose-600'
                            : mode === 'speaking'
                            ? 'bg-emerald-500'
                            : mode === 'thinking' || mode === 'loading'
                            ? 'bg-amber-500'
                            : 'bg-slate-900 dark:bg-slate-100 dark:text-slate-900'
                    }`}
                    aria-label={running ? 'Stop conversation' : 'Start conversation'}
                >
                    {running ? (
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
                            <rect x="7" y="7" width="10" height="10" rx="1.5" />
                        </svg>
                    ) : (
                        <svg
                            viewBox="0 0 24 24"
                            className="h-7 w-7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden
                        >
                            <rect x="9" y="3" width="6" height="11" rx="3" />
                            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                        </svg>
                    )}
                </button>
                <p className="text-[13px] text-slate-400">{label}</p>
            </div>

            {error && <p className="mt-1 text-center text-[13px] text-rose-500">{error}</p>}

            {transcript && (
                <p className="mt-1 text-right">
                    <span className="inline-block rounded-2xl bg-slate-900 px-3.5 py-2 text-left text-[14px] text-slate-50 dark:bg-slate-100 dark:text-slate-900">
                        {transcript}
                    </span>
                </p>
            )}
            {answer && (
                <div className="mt-2 flex items-start gap-2">
                    <span className="inline-block rounded-2xl bg-slate-100 px-3.5 py-2 text-[14px] leading-relaxed text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                        {answer}
                    </span>
                    <button
                        type="button"
                        onClick={() =>
                            void speak(answer).then(({ audio, samplingRate }) => playPcm(audio, samplingRate))
                        }
                        title="Replay"
                        className="mt-1 shrink-0 text-[12px] text-slate-400 transition hover:text-slate-600"
                    >
                        Replay
                    </button>
                </div>
            )}
        </div>
    )
}

export default function VoiceChat() {
    return (
        <GpuGate>
            <VoiceInner />
        </GpuGate>
    )
}
