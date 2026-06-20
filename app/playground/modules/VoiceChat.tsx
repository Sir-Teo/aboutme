'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import GpuGate from '../GpuGate'
import { profile } from '../../data/profile'
import { engineById } from '../engines'
import { generate, warm, disposeModel } from '../agent/runtime'
import { groundingBlock, warmIndex } from '../agent/retrieval'
import { warmEmbedder } from '../agent/embeddings'

// Voice tab: ask by speaking, hear the answer spoken back.
//   • Speech-to-text uses the browser's built-in SpeechRecognition.
//   • The answer is generated on-device by a Liquid LFM2.5 model (WebGPU).
//   • The reply is read aloud with the browser's built-in SpeechSynthesis.
// (LFM2.5-Audio / Gemma-4 audio aren't loadable via transformers.js 4.2.0 yet,
// so STT uses the native recognizer; the language model stays fully on-device.)

const ANSWER_ENGINE = engineById('lfm2.5-1.2b')

function speak(text: string) {
    try {
        const synth = window.speechSynthesis
        if (!synth) return
        synth.cancel()
        synth.speak(new SpeechSynthesisUtterance(text))
    } catch {
        /* no speech synthesis available */
    }
}

function getRecognition(): any {
    if (typeof window === 'undefined') return null
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    return Ctor ? new Ctor() : null
}

function VoiceInner() {
    const [listening, setListening] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [answer, setAnswer] = useState('')
    const [progress, setProgress] = useState('')
    const [busy, setBusy] = useState(false)
    const [supported, setSupported] = useState(true)
    const recognitionRef = useRef<any>(null)

    const answerQuestion = useCallback(async (question: string) => {
        if (!question) {
            setBusy(false)
            return
        }
        setProgress('Thinking…')
        const grounding = await groundingBlock(question, 5)
        const system = [
            `You are a friendly assistant on ${profile.name}'s website. Refer to him as Teo.`,
            `Answer in one or two short spoken sentences using only the facts below.`,
            ``,
            grounding,
        ].join('\n')
        let full = ''
        try {
            await generate(
                ANSWER_ENGINE,
                [
                    { role: 'system', content: system },
                    { role: 'user', content: question },
                ],
                {
                    onProgress: setProgress,
                    onReady: () => setProgress(''),
                    onChunk: chunk => {
                        full += chunk
                        setAnswer(full)
                    },
                }
            )
            speak(full)
        } finally {
            setBusy(false)
            setProgress('')
        }
    }, [])

    useEffect(() => {
        warmEmbedder()
        warmIndex()
        warm(ANSWER_ENGINE)
        const rec = getRecognition()
        if (!rec) {
            setSupported(false)
            return
        }
        rec.lang = 'en-US'
        rec.interimResults = false
        rec.maxAlternatives = 1
        rec.onresult = (event: any) => {
            const text = event.results?.[0]?.[0]?.transcript ?? ''
            setTranscript(text)
            setBusy(true)
            void answerQuestion(text)
        }
        rec.onerror = () => {
            setListening(false)
            setProgress('Could not hear you — try again.')
        }
        rec.onend = () => setListening(false)
        recognitionRef.current = rec
        return () => {
            try {
                rec.stop()
            } catch {
                /* already stopped */
            }
            // Free the answer model's GPU memory when leaving the voice tab.
            disposeModel()
        }
    }, [answerQuestion])

    function toggle() {
        const rec = recognitionRef.current
        if (!rec) return
        if (listening) {
            rec.stop()
            setListening(false)
            return
        }
        setTranscript('')
        setAnswer('')
        setProgress('')
        try {
            rec.start()
            setListening(true)
        } catch {
            /* start() throws if already running */
        }
    }

    if (!supported) {
        return (
            <div className="rounded-xl bg-white p-5 text-[14px] text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800">
                This browser doesn’t support speech recognition. Try Chrome or Edge.
            </div>
        )
    }

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <p className="text-[12px] text-slate-400">
                Browser speech-to-text · {ANSWER_ENGINE.label} answers on-device · spoken reply
            </p>

            <div className="mt-4 flex flex-col items-center gap-3 py-4">
                <button
                    type="button"
                    onClick={toggle}
                    disabled={busy}
                    className={`grid h-16 w-16 place-items-center rounded-full text-white transition disabled:opacity-40 ${
                        listening
                            ? 'animate-pulse bg-rose-500 hover:bg-rose-600'
                            : 'bg-slate-900 dark:bg-slate-100 dark:text-slate-900'
                    }`}
                    aria-label={listening ? 'Stop listening' : 'Start listening'}
                >
                    {listening ? (
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
                <p className="text-[13px] text-slate-400">
                    {listening ? 'Listening… tap to stop' : busy ? progress || 'Working…' : 'Tap to speak'}
                </p>
            </div>

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
                        onClick={() => speak(answer)}
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
