'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import GpuGate from '../GpuGate'

// Text-to-image, fully in the browser: SD-Turbo (single step) via onnxruntime-web
// on WebGPU. The most experimental experiment here — ~2.5 GB of weights stream on
// first use, then it generates a 512² image locally with nothing sent anywhere.

type Res =
    | { type: 'progress'; progress: string }
    | { type: 'image'; id: string; width: number; height: number; data: Uint8ClampedArray }
    | { type: 'error'; id?: string; message: string }

const PROMPTS = [
    'a serene mountain lake at sunrise, photorealistic',
    'a cozy reading nook, warm light, watercolor',
    'a tiny robot watering a plant, isometric, soft colors',
]

function ImageGenInner() {
    const [prompt, setPrompt] = useState(PROMPTS[0])
    const [busy, setBusy] = useState(false)
    const [progress, setProgress] = useState('')
    const [error, setError] = useState('')
    const [hasImage, setHasImage] = useState(false)
    const workerRef = useRef<Worker | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const idRef = useRef(0)

    useEffect(() => {
        const worker = new Worker(new URL('../../components/imagegen.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<Res>) => {
            const msg = event.data
            if (msg.type === 'progress') setProgress(msg.progress)
            else if (msg.type === 'image') {
                const canvas = canvasRef.current
                if (canvas) {
                    canvas.width = msg.width
                    canvas.height = msg.height
                    canvas.getContext('2d')?.putImageData(new ImageData(msg.data, msg.width, msg.height), 0, 0)
                }
                setHasImage(true)
                setBusy(false)
                setProgress('')
            } else if (msg.type === 'error') {
                setError(msg.message)
                setBusy(false)
                setProgress('')
            }
        }
        workerRef.current = worker
        return () => worker.terminate()
    }, [])

    const run = useCallback(() => {
        if (!prompt.trim() || busy) return
        setError('')
        setBusy(true)
        setProgress('Loading models (first run streams ~2.5 GB)…')
        const id = `g${idRef.current++}`
        workerRef.current?.postMessage({ type: 'generate', id, prompt: prompt.trim() })
    }, [prompt, busy])

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <p className="text-[12px] text-slate-400">
                SD-Turbo · onnxruntime-web · WebGPU — generated on-device.{' '}
                <span className="text-amber-500">Experimental · ~2.5 GB first download.</span>
            </p>

            <div className="mt-4 flex flex-col gap-2">
                <textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    rows={2}
                    placeholder="Describe an image…"
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <div className="flex flex-wrap gap-1.5">
                    {PROMPTS.map(p => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setPrompt(p)}
                            className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                        >
                            {p.length > 28 ? p.slice(0, 28) + '…' : p}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
                <button
                    type="button"
                    onClick={run}
                    disabled={busy || !prompt.trim()}
                    className="rounded-full bg-slate-900 px-4 py-1.5 text-[13px] text-white transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                >
                    {busy ? 'Generating…' : 'Generate'}
                </button>
                {progress && <span className="text-[12px] text-slate-400">{progress}</span>}
                {error && <span className="text-[12px] text-rose-500">{error}</span>}
            </div>

            <div className="mt-4 grid place-items-center rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                <canvas
                    ref={canvasRef}
                    className={`aspect-square w-full max-w-[512px] rounded-lg ${hasImage ? '' : 'opacity-0'}`}
                />
                {!hasImage && !busy && <p className="-mt-[60%] text-[13px] text-slate-400">Your image appears here</p>}
            </div>
        </div>
    )
}

export default function ImageGen() {
    return (
        <GpuGate>
            <ImageGenInner />
        </GpuGate>
    )
}
