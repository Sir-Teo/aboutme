'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import GpuGate from '../GpuGate'
import { VISION_LAB_TASKS, type VisionLabTask } from '../engines'

// Vision lab: pixel-level computer vision that *transforms* an image — background
// removal, depth maps, object detection — all on-device via transformers.js.
// Drop an image, pick a task, see the result painted on a canvas. No upload.

type Box = { label: string; score: number; xmin: number; ymin: number; xmax: number; ymax: number }
type Res =
    | { type: 'progress'; progress: string }
    | { type: 'image'; id: string; width: number; height: number; data: Uint8ClampedArray }
    | { type: 'boxes'; id: string; boxes: Box[] }
    | { type: 'error'; id?: string; message: string }

// Stable colour per label for detection overlays.
function colorFor(label: string): string {
    let h = 0
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360
    return `hsl(${h} 80% 55%)`
}

function VisionLabInner() {
    const [taskId, setTaskId] = useState<VisionLabTask>(VISION_LAB_TASKS[0].id)
    const [image, setImage] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [progress, setProgress] = useState('')
    const [error, setError] = useState('')
    const workerRef = useRef<Worker | null>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const imgElRef = useRef<HTMLImageElement | null>(null)
    const idRef = useRef(0)

    const task = VISION_LAB_TASKS.find(t => t.id === taskId) ?? VISION_LAB_TASKS[0]

    useEffect(() => {
        const worker = new Worker(new URL('../../components/pixel.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<Res>) => {
            const msg = event.data
            if (msg.type === 'progress') setProgress(msg.progress)
            else if (msg.type === 'image') {
                paintImage(msg.width, msg.height, msg.data)
                setBusy(false)
                setProgress('')
            } else if (msg.type === 'boxes') {
                paintBoxes(msg.boxes)
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

    const paintImage = (width: number, height: number, data: Uint8ClampedArray) => {
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, width, height)
        ctx.putImageData(new ImageData(data, width, height), 0, 0)
    }

    const paintBoxes = (boxes: Box[]) => {
        const canvas = canvasRef.current
        const img = imgElRef.current
        if (!canvas || !img) return
        const w = img.naturalWidth
        const h = img.naturalHeight
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, w, h)
        ctx.lineWidth = Math.max(2, Math.round(w / 320))
        ctx.font = `${Math.max(12, Math.round(w / 40))}px ui-sans-serif, system-ui`
        ctx.textBaseline = 'top'
        for (const b of boxes) {
            const x = b.xmin * w
            const y = b.ymin * h
            const bw = (b.xmax - b.xmin) * w
            const bh = (b.ymax - b.ymin) * h
            const color = colorFor(b.label)
            ctx.strokeStyle = color
            ctx.strokeRect(x, y, bw, bh)
            const tag = `${b.label} ${Math.round(b.score * 100)}%`
            const tw = ctx.measureText(tag).width + 8
            ctx.fillStyle = color
            ctx.fillRect(x, Math.max(0, y - 20), tw, 20)
            ctx.fillStyle = '#fff'
            ctx.fillText(tag, x + 4, Math.max(0, y - 18))
        }
    }

    const onFile = useCallback((file: File | undefined) => {
        if (!file) return
        setError('')
        const reader = new FileReader()
        reader.onload = () => setImage(String(reader.result))
        reader.readAsDataURL(file)
    }, [])

    const run = useCallback(() => {
        if (!image || busy) return
        setError('')
        setBusy(true)
        setProgress('Loading model…')
        const id = `r${idRef.current++}`
        workerRef.current?.postMessage({ type: 'run', id, task: task.id, modelId: task.modelId, image })
    }, [image, busy, task])

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex flex-wrap items-center gap-2">
                {VISION_LAB_TASKS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTaskId(t.id)}
                        aria-pressed={t.id === taskId}
                        className={`rounded-full border px-3 py-1 text-[12px] transition ${
                            t.id === taskId
                                ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <p className="mt-2 text-[12px] text-slate-400">{task.blurb} · runs on-device</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-center dark:border-slate-700">
                    {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            ref={imgElRef}
                            src={image}
                            alt="Input"
                            className="max-h-full max-w-full rounded-lg object-contain"
                        />
                    ) : (
                        <span className="px-4 text-[13px] text-slate-400">Click to upload an image</span>
                    )}
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => onFile(e.target.files?.[0])}
                    />
                </label>
                <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <canvas
                        ref={canvasRef}
                        className="max-h-full max-w-full rounded-lg"
                        style={{ imageRendering: 'auto' }}
                    />
                </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
                <button
                    type="button"
                    onClick={run}
                    disabled={!image || busy}
                    className="rounded-full bg-slate-900 px-4 py-1.5 text-[13px] text-white transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                >
                    {busy ? 'Running…' : `Run ${task.label.toLowerCase()}`}
                </button>
                {progress && <span className="text-[12px] text-slate-400">{progress}</span>}
                {error && <span className="text-[12px] text-rose-500">{error}</span>}
            </div>
        </div>
    )
}

export default function VisionLab() {
    return (
        <GpuGate>
            <VisionLabInner />
        </GpuGate>
    )
}
