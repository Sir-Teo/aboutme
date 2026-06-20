'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import GpuGate from '../GpuGate'
import { visionEngines } from '../engines'

// Vision tab: drop an image (or grab a webcam frame) and ask about it — caption,
// visual Q&A, OCR — all on-device via a Gemma/Liquid VLM. No upload, no server.

const VISION_ENGINES = visionEngines()
const PRESETS = [
    { label: 'Describe', prompt: 'Describe this image in detail.' },
    { label: 'Read text (OCR)', prompt: 'Read and transcribe all text visible in this image.' },
    { label: 'Main objects', prompt: 'List the main objects you can see in this image.' },
]

type WorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'ready' }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'done'; id: string; text: string }
    | { type: 'error'; id?: string; message: string }

function VisionInner() {
    const [image, setImage] = useState<string | null>(null)
    const [prompt, setPrompt] = useState(PRESETS[0].prompt)
    const [output, setOutput] = useState('')
    const [busy, setBusy] = useState(false)
    const [progress, setProgress] = useState('')
    const [webcam, setWebcam] = useState(false)
    const [engineId, setEngineId] = useState(VISION_ENGINES[0].id)
    const engine = VISION_ENGINES.find(e => e.id === engineId) ?? VISION_ENGINES[0]
    const workerRef = useRef<Worker | null>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const idRef = useRef(0)

    // Spin up the vision worker once.
    useEffect(() => {
        const worker = new Worker(new URL('../../components/vision.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const msg = event.data
            if (msg.type === 'progress') setProgress(msg.progress)
            else if (msg.type === 'ready') setProgress('')
            else if (msg.type === 'chunk') {
                setProgress('')
                setOutput(prev => prev + msg.chunk)
            } else if (msg.type === 'done') setBusy(false)
            else if (msg.type === 'error') {
                setOutput(`Error: ${msg.message}`)
                setBusy(false)
                setProgress('')
            }
        }
        workerRef.current = worker
        return () => worker.terminate()
    }, [])

    const stopWebcam = useCallback(() => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        setWebcam(false)
    }, [])

    useEffect(() => () => stopWebcam(), [stopWebcam])

    function onFile(file: File | undefined) {
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            setImage(String(reader.result))
            setOutput('')
        }
        reader.readAsDataURL(file)
    }

    async function startWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            streamRef.current = stream
            setWebcam(true)
            // Attach after the <video> mounts.
            requestAnimationFrame(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                    void videoRef.current.play()
                }
            })
        } catch {
            setProgress('Camera unavailable or permission denied.')
        }
    }

    function capture() {
        const video = videoRef.current
        if (!video) return
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        setImage(canvas.toDataURL('image/jpeg', 0.9))
        setOutput('')
        stopWebcam()
    }

    function run() {
        if (!image || busy) return
        setOutput('')
        setBusy(true)
        setProgress('Thinking…')
        const id = `v${idRef.current++}`
        workerRef.current?.postMessage({
            type: 'describe',
            id,
            engine: {
                id: engine.id,
                modelId: engine.modelId,
                modelClass: engine.modelClass,
                dtype: engine.dtype,
                maxNewTokens: engine.maxNewTokens,
            },
            image,
            prompt,
        })
    }

    return (
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] text-slate-400">
                    {engine.label} · {engine.sizeLabel} · on-device
                </p>
                {VISION_ENGINES.length > 1 && (
                    <select
                        value={engineId}
                        onChange={e => setEngineId(e.target.value)}
                        aria-label="Vision model"
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    >
                        {VISION_ENGINES.map(e => (
                            <option key={e.id} value={e.id}>
                                {e.label} ({e.sizeLabel})
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* image source */}
            {webcam ? (
                <div className="mt-3">
                    <video ref={videoRef} className="w-full rounded-lg" muted playsInline />
                    <div className="mt-2 flex gap-2">
                        <button
                            type="button"
                            onClick={capture}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] text-slate-50 dark:bg-slate-100 dark:text-slate-900"
                        >
                            Capture
                        </button>
                        <button
                            type="button"
                            onClick={stopWebcam}
                            className="rounded-lg px-3 py-1.5 text-[13px] text-slate-500 ring-1 ring-slate-200 dark:ring-slate-700"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="To analyze" className="mt-3 max-h-72 w-full rounded-lg object-contain" />
            ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                    <label className="cursor-pointer rounded-lg bg-slate-100 px-3 py-2 text-[14px] text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700">
                        Upload image
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => onFile(e.target.files?.[0])}
                        />
                    </label>
                    <button
                        type="button"
                        onClick={startWebcam}
                        className="rounded-lg px-3 py-2 text-[14px] text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700"
                    >
                        Use webcam
                    </button>
                </div>
            )}

            {image && !webcam && (
                <>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {PRESETS.map(p => (
                            <button
                                key={p.label}
                                type="button"
                                onClick={() => setPrompt(p.prompt)}
                                className={`rounded-full px-3 py-1 text-[13px] ring-1 transition ${
                                    prompt === p.prompt
                                        ? 'bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-100'
                                        : 'text-slate-600 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700'
                                }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                        <input
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            placeholder="Ask about the image…"
                            className="flex-1 rounded-lg bg-slate-50 px-3 py-2 text-[14px] text-slate-800 outline-none ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700"
                        />
                        <button
                            type="button"
                            onClick={run}
                            disabled={busy}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-[14px] text-slate-50 transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                        >
                            {busy ? '…' : 'Ask'}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setImage(null)
                                setOutput('')
                            }}
                            className="rounded-lg px-2 py-2 text-[13px] text-slate-400 transition hover:text-slate-600"
                            title="Clear image"
                        >
                            Clear
                        </button>
                    </div>
                </>
            )}

            {progress && <p className="mt-3 text-[13px] text-slate-400">{progress}</p>}
            {output && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[14px] leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {output}
                </p>
            )}
        </div>
    )
}

export default function VisionChat() {
    return (
        <GpuGate>
            <VisionInner />
        </GpuGate>
    )
}
