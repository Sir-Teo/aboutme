'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { webgpuAvailable, webgpuHelpHint } from '../lib/webgpu'

// Shared hardware gate for every playground module: render children only when
// WebGPU is available, otherwise an honest "needs WebGPU" notice. No fallback —
// the playground is a frontier showcase, by design.
export default function GpuGate({ children }: { children: ReactNode }) {
    const [gpu, setGpu] = useState<'checking' | 'ready' | 'unavailable'>('checking')

    useEffect(() => {
        let alive = true
        webgpuAvailable().then(ok => alive && setGpu(ok ? 'ready' : 'unavailable'))
        return () => {
            alive = false
        }
    }, [])

    if (gpu === 'checking') {
        return (
            <div className="rounded-xl border border-slate-200 px-5 py-8 text-[13px] text-slate-400 dark:border-slate-800">
                Checking for WebGPU…
            </div>
        )
    }

    if (gpu === 'unavailable') {
        return (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-[14px] font-medium text-slate-800 dark:text-slate-100">WebGPU required</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                    This playground runs frontier models entirely on your device — that needs WebGPU, which this browser
                    isn’t exposing.
                </p>
                <p className="mt-2 text-[12px] text-slate-400">{webgpuHelpHint()}</p>
            </div>
        )
    }

    return <>{children}</>
}
