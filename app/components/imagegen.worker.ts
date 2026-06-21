// In-browser text-to-image: SD-Turbo (single step) via onnxruntime-web on WebGPU.
//
// EXPERIMENTAL — the heaviest, most hardware-sensitive experiment in the
// playground. It runs the full diffusion pipeline (CLIP text encoder → UNet →
// VAE decoder) entirely client-side from the fp16 ONNX export at
// schmuell/sd-turbo-ort-web (the model purpose-built for ORT-Web). ~2.5 GB of
// weights stream on first use and cache after.
//
// The CLIP tokenizer comes from transformers.js (same BPE/vocab as SD2's text
// encoder); the three ONNX graphs run in ORT-Web. Input names are resolved from
// each session at runtime so a slightly different export still maps correctly.

import * as ort from 'onnxruntime-web/webgpu'

const REPO = 'https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main'
const TOKENIZER_REPO = 'Xenova/clip-vit-base-patch16' // CLIP BPE, compatible token ids
const LATENT = { c: 4, h: 64, w: 64 }
const IMG = 512
const SIGMA = 14.6146 // EulerAncestral init sigma at t=999 for this SD2-turbo export
const VAE_SCALE = 0.18215
const TIMESTEP = 999

type Req = { type: 'warm' } | { type: 'generate'; id: string; prompt: string }
type Res =
    | { type: 'progress'; progress: string }
    | { type: 'image'; id: string; width: number; height: number; data: Uint8ClampedArray }
    | { type: 'error'; id?: string; message: string }

const workerSelf = self as unknown as {
    postMessage(message: Res, transfer?: Transferable[]): void
    addEventListener(type: 'message', listener: (event: MessageEvent<Req>) => void): void
}
function post(m: Res, transfer?: Transferable[]) {
    workerSelf.postMessage(m, transfer)
}

// ───────────────────────────── float16 round-trip ────────────────────────────
function f32ToF16(input: Float32Array): Uint16Array {
    const out = new Uint16Array(input.length)
    const f = new Float32Array(1)
    const i = new Int32Array(f.buffer)
    for (let n = 0; n < input.length; n++) {
        f[0] = input[n]
        const x = i[0]
        const sign = (x >> 16) & 0x8000
        let exp = ((x >> 23) & 0xff) - 127 + 15
        let mant = x & 0x7fffff
        if (exp <= 0) {
            out[n] = sign // underflow → ±0
        } else if (exp >= 0x1f) {
            out[n] = sign | 0x7c00 // overflow → ±inf
        } else {
            out[n] = sign | (exp << 10) | (mant >> 13)
        }
    }
    return out
}
function f16ToF32(input: Uint16Array): Float32Array {
    const out = new Float32Array(input.length)
    for (let n = 0; n < input.length; n++) {
        const h = input[n]
        const sign = (h & 0x8000) << 16
        const exp = (h >> 10) & 0x1f
        const mant = h & 0x3ff
        let val: number
        if (exp === 0) val = (mant / 1024) * Math.pow(2, -14)
        else if (exp === 0x1f) val = mant ? NaN : Infinity
        else val = (1 + mant / 1024) * Math.pow(2, exp - 15)
        out[n] = (sign ? -1 : 1) * val
    }
    return out
}

function randn(n: number): Float32Array {
    const out = new Float32Array(n)
    for (let i = 0; i < n; i += 2) {
        const u = Math.max(1e-7, Math.random())
        const v = Math.random()
        const r = Math.sqrt(-2 * Math.log(u))
        out[i] = r * Math.cos(2 * Math.PI * v)
        if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v)
    }
    return out
}

// ───────────────────────────────── sessions ──────────────────────────────────
type Sessions = { text: any; unet: any; vae: any; tokenizer: any }
let sessions: Sessions | null = null
let loading: Promise<Sessions> | null = null

function pick(names: string[], ...needles: string[]): string {
    const lower = names.map(n => n.toLowerCase())
    for (const needle of needles) {
        const i = lower.findIndex(n => n.includes(needle))
        if (i >= 0) return names[i]
    }
    return names[0]
}

async function load() {
    if (sessions) return sessions
    if (loading) return loading
    loading = (async () => {
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'
        const opt = { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' as const }

        post({ type: 'progress', progress: 'Loading tokenizer…' })
        const { AutoTokenizer } = await import('@huggingface/transformers')
        const tokenizer = await AutoTokenizer.from_pretrained(TOKENIZER_REPO)

        post({ type: 'progress', progress: 'Loading text encoder (~0.7 GB)…' })
        const text = await ort.InferenceSession.create(`${REPO}/text_encoder/model.onnx`, opt)
        post({ type: 'progress', progress: 'Loading UNet (~1.7 GB)…' })
        const unet = await ort.InferenceSession.create(`${REPO}/unet/model.onnx`, opt)
        post({ type: 'progress', progress: 'Loading VAE decoder…' })
        const vae = await ort.InferenceSession.create(`${REPO}/vae_decoder/model.onnx`, opt)

        sessions = { text, unet, vae, tokenizer }
        return sessions
    })()
    try {
        return await loading
    } finally {
        loading = null
    }
}

async function generate(req: Extract<Req, { type: 'generate' }>) {
    try {
        const s = await load()
        if (!s) throw new Error('Pipeline failed to load.')
        post({ type: 'progress', progress: 'Encoding prompt…' })

        // 1) Tokenize → input_ids [1,77] int32.
        const enc = await s.tokenizer(req.prompt, { padding: 'max_length', max_length: 77, truncation: true })
        const idsArr = Array.from(enc.input_ids.data as BigInt64Array | Int32Array | number[], (v: any) => Number(v))
        const inputIds = new ort.Tensor('int32', Int32Array.from(idsArr), [1, idsArr.length])

        // 2) Text encoder → hidden states (fp16).
        const textIn = s.text.inputNames[0]
        const textOut = await s.text.run({ [textIn]: inputIds })
        const hiddenName = pick(s.text.outputNames, 'hidden', 'last')
        const hidden = textOut[hiddenName] // float16 tensor [1,77,1024]
        const hiddenF16 =
            hidden.type === 'float16'
                ? hidden
                : new ort.Tensor('float16', f32ToF16(hidden.data as Float32Array), hidden.dims)

        // 3) Latents and single UNet step.
        post({ type: 'progress', progress: 'Diffusing…' })
        const n = LATENT.c * LATENT.h * LATENT.w
        const noise = randn(n)
        const latents = new Float32Array(n)
        for (let i = 0; i < n; i++) latents[i] = noise[i] * SIGMA
        const scale = 1 / Math.sqrt(SIGMA * SIGMA + 1)
        const modelInput = new Float32Array(n)
        for (let i = 0; i < n; i++) modelInput[i] = latents[i] * scale

        const sampleTensor = new ort.Tensor('float16', f32ToF16(modelInput), [1, LATENT.c, LATENT.h, LATENT.w])
        const uNames: string[] = s.unet.inputNames
        const sampleName = pick(uNames, 'sample', 'latent')
        const tName = pick(uNames, 'timestep', 'time', 't')
        const encName = pick(uNames, 'encoder', 'hidden', 'context')
        // Timestep dtype varies between exports — try int64, fall back to float16.
        let unetOut: any
        const feedsBase: Record<string, any> = { [sampleName]: sampleTensor, [encName]: hiddenF16 }
        try {
            unetOut = await s.unet.run({
                ...feedsBase,
                [tName]: new ort.Tensor('int64', BigInt64Array.from([BigInt(TIMESTEP)]), [1]),
            })
        } catch {
            unetOut = await s.unet.run({
                ...feedsBase,
                [tName]: new ort.Tensor('float16', f32ToF16(new Float32Array([TIMESTEP])), [1]),
            })
        }
        const noisePredRaw = unetOut[s.unet.outputNames[0]]
        const noisePred =
            noisePredRaw.type === 'float16'
                ? f16ToF32(noisePredRaw.data as Uint16Array)
                : (noisePredRaw.data as Float32Array)

        // pred_original_sample = latents - sigma * noise_pred ; then scale for VAE.
        const sample = new Float32Array(n)
        for (let i = 0; i < n; i++) sample[i] = (latents[i] - SIGMA * noisePred[i]) / VAE_SCALE

        // 4) VAE decode → image [1,3,512,512] in ~[-1,1].
        post({ type: 'progress', progress: 'Decoding image…' })
        const vaeIn = s.vae.inputNames[0]
        const vaeOut = await s.vae.run({
            [vaeIn]: new ort.Tensor('float16', f32ToF16(sample), [1, LATENT.c, LATENT.h, LATENT.w]),
        })
        const imgRaw = vaeOut[s.vae.outputNames[0]]
        const px = imgRaw.type === 'float16' ? f16ToF32(imgRaw.data as Uint16Array) : (imgRaw.data as Float32Array)

        // CHW [-1,1] → RGBA Uint8.
        const out = new Uint8ClampedArray(IMG * IMG * 4)
        const plane = IMG * IMG
        for (let p = 0; p < plane; p++) {
            const r = (px[p] / 2 + 0.5) * 255
            const g = (px[plane + p] / 2 + 0.5) * 255
            const b = (px[2 * plane + p] / 2 + 0.5) * 255
            const o = p * 4
            out[o] = r
            out[o + 1] = g
            out[o + 2] = b
            out[o + 3] = 255
        }
        post({ type: 'image', id: req.id, width: IMG, height: IMG, data: out }, [out.buffer])
    } catch (error) {
        post({ type: 'error', id: req.id, message: error instanceof Error ? error.message : String(error) })
    }
}

workerSelf.addEventListener('message', event => {
    const req = event.data
    if (req.type === 'warm') void load().catch(() => undefined)
    else if (req.type === 'generate') void generate(req)
})

export {}
