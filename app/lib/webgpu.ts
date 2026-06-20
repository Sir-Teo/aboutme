// Single source of truth for "can this browser run the playground?".
//
// The playground is deliberately WebGPU-only (no WASM/instant fallback): it's a
// showcase of frontier on-device models, and degrading to a 135M model would
// misrepresent what's possible. So instead of a fallback ladder we probe once
// and, when WebGPU is absent, render an honest hardware gate.

export type WebGPUStatus = 'checking' | 'ready' | 'unavailable'

const PROBE_TIMEOUT_MS = 2500

let probe: Promise<boolean> | null = null

// Cache the probe promise: the check requests a real adapter + device, which is
// comparatively slow, and several tabs/components ask the same question.
export function webgpuAvailable(): Promise<boolean> {
    return (probe ??= runProbe())
}

async function runProbe(): Promise<boolean> {
    if (typeof navigator === 'undefined') return false
    const gpu = (navigator as any).gpu
    if (!gpu?.requestAdapter) return false
    try {
        const adapter: any = await withTimeout(gpu.requestAdapter({ powerPreference: 'high-performance' }))
        if (!adapter) return false
        if (typeof adapter.requestDevice === 'function') {
            const devicePromise: Promise<any> = adapter.requestDevice()
            const device: any = await withTimeout(devicePromise)
            if (!device) {
                // The device may still resolve after the timeout — tidy it up.
                devicePromise.then((late: any) => late?.destroy?.()).catch(() => undefined)
                return false
            }
            device.destroy?.()
        }
        return true
    } catch {
        return false
    }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
        return await Promise.race([
            promise,
            new Promise<null>(resolve => {
                timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}

// A short, accurate hint for the gate UI based on the current browser.
export function webgpuHelpHint(): string {
    if (typeof navigator === 'undefined') return ''
    const ua = navigator.userAgent || ''
    if (/Firefox/i.test(ua)) return 'Firefox: enable dom.webgpu.enabled in about:config, or use Chrome/Edge.'
    if (/Safari/i.test(ua) && !/Chrome|Chromium|CriOS/i.test(ua))
        return 'Safari: enable the WebGPU feature flag in Develop ▸ Feature Flags, or use Chrome/Edge.'
    return 'Use a recent Chrome or Edge (113+) on a device with a GPU.'
}
