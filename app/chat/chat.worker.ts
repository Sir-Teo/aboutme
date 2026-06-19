// Dedicated worker for the full-page /chat experience.
//
// This is intentionally separate from components/AskAI.worker.ts (the homepage
// widget's worker) so the chat page can add an agentic tool-calling loop and a
// broad model catalog without any risk of regressing the widget.
//
// Two paths:
//  - Plain generation: stream a single answer (no tools).
//  - Agentic loop: pass tool JSON schemas via the chat template, parse the
//    model's tool call, run the tool here in the worker, feed the result back,
//    and repeat until the model answers or we hit the step cap.

type RuntimeDevice = 'webgpu' | 'wasm'
type RuntimeMode = {
    device: RuntimeDevice
    modelId: string
    dtype: 'q4' | 'q4f16'
    label: string
    maxNewTokens: number
}

type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string }

type WorkerRequest =
    | {
          type: 'generate'
          id: string
          mode: RuntimeMode
          messages: ChatMessage[]
          useTools?: boolean
      }
    | { type: 'warm'; mode: RuntimeMode }
    | { type: 'stop'; id: string }

type WorkerResponse =
    | { type: 'progress'; progress: string }
    | { type: 'ready'; mode: RuntimeMode }
    | { type: 'chunk'; id: string; chunk: string }
    | { type: 'tool-call'; id: string; name: string; args: string }
    | { type: 'tool-result'; id: string; name: string; result: string }
    | { type: 'step'; id: string; step: number }
    | { type: 'done'; id: string }
    | { type: 'error'; id?: string; message: string }

const GENERATION_IDLE_TIMEOUT_MS = 20000
const MAX_AGENT_STEPS = 5

const workerSelf = self as unknown as {
    postMessage(message: WorkerResponse): void
    addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
}

let current: { mode: RuntimeMode; generator: any } | null = null
let loading: Promise<any> | null = null
let activeStopper: { interrupt: () => void; reset: () => void } | null = null
let activeId: string | null = null
let cancelled = new Set<string>()
let lastProgressPost = 0
let lastProgressText = ''

function post(message: WorkerResponse) {
    workerSelf.postMessage(message)
}

function postProgress(progress: string, force = false) {
    const now = performance.now()
    if (!force && progress === lastProgressText && now - lastProgressPost < 250) return
    lastProgressPost = now
    lastProgressText = progress
    post({ type: 'progress', progress })
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

// --- HuggingFace fetch workaround --------------------------------------------
// Transformers.js probes each model file with a `Range: bytes=0-0` metadata
// request. On some networks the redirect to the Xet/CDN host rejects that
// ranged request (surfacing as "Failed to fetch"); retry it as a plain HEAD.
let transformersFetch: typeof fetch | null = null

function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.href
    return input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
    return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
    return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
}

function isHuggingFaceMetadataRangeRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
    if (requestMethod(input, init) !== 'GET') return false
    const headers = requestHeaders(input, init)
    return headers.get('Range') === 'bytes=0-0' && /^https:\/\/huggingface\.co\/.+\/resolve\//.test(requestUrl(input))
}

async function fetchWithMetadataFallback(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const fetcher = transformersFetch ?? fetch.bind(globalThis)
    try {
        return await fetcher(input, init)
    } catch (error) {
        if (!isHuggingFaceMetadataRangeRequest(input, init) || errorMessage(error).includes('AbortError')) {
            throw error
        }
        const headers = requestHeaders(input, init)
        headers.delete('Range')
        return fetcher(requestUrl(input), {
            ...init,
            method: 'HEAD',
            headers,
            body: undefined,
            cache: init?.cache ?? 'no-store',
        })
    }
}

function fileLabel(file: unknown): string {
    if (typeof file !== 'string' || !file) return 'files'
    return file.split('/').pop() || file
}

function progressText(mode: RuntimeMode, progress: any): string | null {
    if (progress?.status === 'progress_total' && typeof progress.progress === 'number') {
        return `${mode.label}: downloading model... ${Math.max(0, Math.min(100, Math.round(progress.progress)))}%`
    }
    if (progress?.status === 'progress' && typeof progress.progress === 'number') {
        return `${mode.label}: downloading ${fileLabel(progress.file)}... ${Math.max(
            0,
            Math.min(100, Math.round(progress.progress))
        )}%`
    }
    if (progress?.status === 'download') return `${mode.label}: fetching ${fileLabel(progress.file)}...`
    if (progress?.status === 'initiate') return `${mode.label}: checking ${fileLabel(progress.file)}...`
    if (progress?.status === 'ready' || progress?.status === 'done') return `${mode.label}: preparing...`
    return null
}

function configureEnv(env: any, mode: RuntimeMode) {
    transformersFetch ??= env.fetch ?? fetch.bind(globalThis)
    env.fetch = fetchWithMetadataFallback
    env.allowLocalModels = false
    env.useBrowserCache = true
    env.useWasmCache = true
    if (mode.device !== 'wasm') return
    const wasm = env?.backends?.onnx?.wasm
    if (!wasm) return
    const isolated = (self as any).crossOriginIsolated === true
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1
    wasm.numThreads = isolated ? Math.max(1, Math.min(4, Math.ceil(cores / 2))) : 1
    wasm.proxy = false
}

async function loadGenerator(mode: RuntimeMode) {
    if (current?.mode.modelId === mode.modelId && current.mode.device === mode.device) {
        current.mode = mode
        return current.generator
    }
    if (loading) return loading

    loading = (async () => {
        const { env, pipeline } = await import('@huggingface/transformers')
        configureEnv(env, mode)
        postProgress(`${mode.label}: loading runtime...`, true)
        const generator = await pipeline('text-generation', mode.modelId, {
            dtype: mode.dtype,
            device: mode.device,
            progress_callback: (p: any) => {
                const text = progressText(mode, p)
                if (text) postProgress(text)
            },
        })
        current = { mode, generator }
        post({ type: 'ready', mode })
        return generator
    })()

    try {
        return await loading
    } finally {
        loading = null
    }
}

// ---- Tools (executed here in the worker) ----------------------------------

type ToolDef = {
    schema: any
    run: (args: any) => string
}

const TOOLS: Record<string, ToolDef> = {
    calculator: {
        schema: {
            type: 'function',
            function: {
                name: 'calculator',
                description: 'Evaluate a basic arithmetic expression and return the numeric result.',
                parameters: {
                    type: 'object',
                    properties: {
                        expression: {
                            type: 'string',
                            description: 'An arithmetic expression, e.g. "3 * (4 + 5)" or "2 ** 10".',
                        },
                    },
                    required: ['expression'],
                },
            },
        },
        run: args => {
            const raw = String(args?.expression ?? '').trim()
            if (!raw) return 'Error: no expression provided.'
            // Only allow safe arithmetic characters — no identifiers, no calls.
            if (!/^[\d\s+\-*/().%]+$/.test(raw.replace(/\*\*/g, '*'))) {
                return 'Error: expression contains unsupported characters. Only numbers and + - * / ( ) % ** are allowed.'
            }
            try {
                // eslint-disable-next-line no-new-func
                const value = Function(`"use strict"; return (${raw});`)()
                if (typeof value !== 'number' || !Number.isFinite(value)) return 'Error: result is not a finite number.'
                // Trim binary-float noise (e.g. 40.800000000000004 -> 40.8) without
                // losing genuine precision.
                return String(Number.isInteger(value) ? value : Number(value.toPrecision(12)))
            } catch {
                return 'Error: could not evaluate the expression.'
            }
        },
    },
    get_current_datetime: {
        schema: {
            type: 'function',
            function: {
                name: 'get_current_datetime',
                description: "Get the user's current local date and time.",
                parameters: { type: 'object', properties: {}, required: [] },
            },
        },
        run: () => {
            const now = new Date()
            return JSON.stringify({
                iso: now.toISOString(),
                local: now.toLocaleString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
        },
    },
    format_json: {
        schema: {
            type: 'function',
            function: {
                name: 'format_json',
                description:
                    'Validate and pretty-print a JSON string. Returns the formatted JSON or a clear error with position info.',
                parameters: {
                    type: 'object',
                    properties: {
                        json: { type: 'string', description: 'The JSON string to validate and format.' },
                    },
                    required: ['json'],
                },
            },
        },
        run: args => {
            const input = String(args?.json ?? '').trim()
            if (!input) return 'Error: no JSON provided.'
            try {
                return JSON.stringify(JSON.parse(input), null, 2)
            } catch (e) {
                return `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`
            }
        },
    },
    convert_units: {
        schema: {
            type: 'function',
            function: {
                name: 'convert_units',
                description: 'Convert a value between units of measurement.',
                parameters: {
                    type: 'object',
                    properties: {
                        value: { type: 'number', description: 'The numeric value to convert.' },
                        from: {
                            type: 'string',
                            description:
                                'Source unit. Supported: km, miles, m, ft, cm, in, kg, lbs, g, oz, celsius, fahrenheit, kelvin, l, ml, gal, fl_oz, m2, ft2, km2, miles2, ms, s, min, hour, day.',
                        },
                        to: { type: 'string', description: 'Target unit (same set as from).' },
                    },
                    required: ['value', 'from', 'to'],
                },
            },
        },
        run: args => {
            const value = Number(args?.value)
            const from = String(args?.from ?? '')
                .toLowerCase()
                .trim()
            const to = String(args?.to ?? '')
                .toLowerCase()
                .trim()
            if (!Number.isFinite(value)) return 'Error: value must be a finite number.'
            // All conversions go through SI base units.
            const TO_SI: Record<string, [number, string]> = {
                // length → metres
                m: [1, 'length'],
                km: [1000, 'length'],
                cm: [0.01, 'length'],
                mm: [0.001, 'length'],
                miles: [1609.344, 'length'],
                mi: [1609.344, 'length'],
                ft: [0.3048, 'length'],
                feet: [0.3048, 'length'],
                in: [0.0254, 'length'],
                inch: [0.0254, 'length'],
                inches: [0.0254, 'length'],
                yd: [0.9144, 'length'],
                yards: [0.9144, 'length'],
                // mass → kg
                kg: [1, 'mass'],
                g: [0.001, 'mass'],
                mg: [1e-6, 'mass'],
                lbs: [0.453592, 'mass'],
                lb: [0.453592, 'mass'],
                oz: [0.0283495, 'mass'],
                // volume → litres
                l: [1, 'volume'],
                ml: [0.001, 'volume'],
                gal: [3.78541, 'volume'],
                fl_oz: [0.0295735, 'volume'],
                // area → m²
                m2: [1, 'area'],
                ft2: [0.092903, 'area'],
                km2: [1e6, 'area'],
                miles2: [2589988, 'area'],
                ha: [10000, 'area'],
                // time → seconds
                ms: [0.001, 'time'],
                s: [1, 'time'],
                sec: [1, 'time'],
                min: [60, 'time'],
                hour: [3600, 'time'],
                hr: [3600, 'time'],
                day: [86400, 'time'],
            }
            // Temperature needs special handling (non-multiplicative).
            const temps = new Set(['celsius', 'fahrenheit', 'kelvin', 'c', 'f', 'k'])
            const normTemp = (u: string) =>
                u === 'c' ? 'celsius' : u === 'f' ? 'fahrenheit' : u === 'k' ? 'kelvin' : u
            if (temps.has(from) || temps.has(to)) {
                const nf = normTemp(from)
                const nt = normTemp(to)
                let celsius: number
                if (nf === 'celsius') celsius = value
                else if (nf === 'fahrenheit') celsius = (value - 32) * (5 / 9)
                else if (nf === 'kelvin') celsius = value - 273.15
                else return `Error: unknown temperature unit "${from}".`
                let result: number
                if (nt === 'celsius') result = celsius
                else if (nt === 'fahrenheit') result = celsius * (9 / 5) + 32
                else if (nt === 'kelvin') result = celsius + 273.15
                else return `Error: unknown temperature unit "${to}".`
                return `${Number(result.toPrecision(8))} ${to}`
            }
            const fromEntry = TO_SI[from]
            const toEntry = TO_SI[to]
            if (!fromEntry) return `Error: unknown unit "${from}".`
            if (!toEntry) return `Error: unknown unit "${to}".`
            if (fromEntry[1] !== toEntry[1]) return `Error: cannot convert ${fromEntry[1]} to ${toEntry[1]}.`
            const si = value * fromEntry[0]
            const result = si / toEntry[0]
            return `${Number(result.toPrecision(8))} ${to}`
        },
    },
    regex_test: {
        schema: {
            type: 'function',
            function: {
                name: 'regex_test',
                description: 'Test a regular expression against a string and return all matches with capture groups.',
                parameters: {
                    type: 'object',
                    properties: {
                        pattern: { type: 'string', description: 'The regex pattern (without delimiters).' },
                        text: { type: 'string', description: 'The text to test the pattern against.' },
                        flags: {
                            type: 'string',
                            description: 'Optional flags: g (global), i (ignore case), m (multiline). Default: "g".',
                        },
                    },
                    required: ['pattern', 'text'],
                },
            },
        },
        run: args => {
            const pattern = String(args?.pattern ?? '')
            const text = String(args?.text ?? '')
            const flags = String(args?.flags ?? 'g').replace(/[^gimsuy]/g, '')
            if (!pattern) return 'Error: no pattern provided.'
            let re: RegExp
            try {
                re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`)
            } catch (e) {
                return `Invalid regex: ${e instanceof Error ? e.message : String(e)}`
            }
            const matches = Array.from(text.matchAll(re))
            if (!matches.length) return 'No matches found.'
            const result = matches.slice(0, 50).map(m => ({
                match: m[0],
                index: m.index,
                groups: m.slice(1).length ? m.slice(1) : undefined,
                namedGroups: m.groups ?? undefined,
            }))
            return JSON.stringify({ matchCount: matches.length, matches: result }, null, 2)
        },
    },
    encode_decode: {
        schema: {
            type: 'function',
            function: {
                name: 'encode_decode',
                description: 'Encode or decode a string. Supports base64, URL encoding, and HTML entity escaping.',
                parameters: {
                    type: 'object',
                    properties: {
                        operation: {
                            type: 'string',
                            description:
                                'One of: base64_encode, base64_decode, url_encode, url_decode, html_escape, html_unescape.',
                        },
                        input: { type: 'string', description: 'The string to transform.' },
                    },
                    required: ['operation', 'input'],
                },
            },
        },
        run: args => {
            const op = String(args?.operation ?? '').trim()
            const input = String(args?.input ?? '')
            try {
                switch (op) {
                    case 'base64_encode':
                        return btoa(unescape(encodeURIComponent(input)))
                    case 'base64_decode':
                        return decodeURIComponent(escape(atob(input)))
                    case 'url_encode':
                        return encodeURIComponent(input)
                    case 'url_decode':
                        return decodeURIComponent(input)
                    case 'html_escape':
                        return input
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;')
                            .replace(/'/g, '&#39;')
                    case 'html_unescape':
                        return input
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&quot;/g, '"')
                            .replace(/&#39;/g, "'")
                    default:
                        return `Error: unknown operation "${op}". Use base64_encode, base64_decode, url_encode, url_decode, html_escape, or html_unescape.`
                }
            } catch (e) {
                return `Error: ${e instanceof Error ? e.message : String(e)}`
            }
        },
    },
}

function toolSchemas(): any[] {
    return Object.values(TOOLS).map(t => t.schema)
}

// Parse a tool call out of the model's text. Handles the common formats across
// model families: <tool_call>{json}</tool_call>, fenced ```json blocks, and a
// bare {"name":..., "arguments":...} object.
function parseToolCall(text: string): { name: string; args: any; pre: string } | null {
    const tryParse = (s: string): { name: string; args: any } | null => {
        try {
            const obj = JSON.parse(s)
            const name = obj?.name ?? obj?.tool_name ?? obj?.function?.name
            if (typeof name !== 'string' || !(name in TOOLS)) return null
            let args = obj?.arguments ?? obj?.parameters ?? obj?.function?.arguments ?? {}
            if (typeof args === 'string') {
                try {
                    args = JSON.parse(args)
                } catch {
                    /* leave as string */
                }
            }
            return { name, args }
        } catch {
            return null
        }
    }

    // 1) <tool_call>...</tool_call>
    const tagMatch = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/)
    if (tagMatch) {
        const parsed = tryParse(tagMatch[1].trim())
        if (parsed) return { ...parsed, pre: text.slice(0, tagMatch.index).trim() }
    }

    // 2) fenced ```json / ```tool_code blocks
    const fence = text.match(/```(?:json|tool_code|tool_call)?\s*([\s\S]*?)```/)
    if (fence) {
        const parsed = tryParse(fence[1].trim())
        if (parsed) return { ...parsed, pre: text.slice(0, fence.index).trim() }
    }

    // 3) bare JSON object containing "name" and arguments/parameters
    const objMatch = text.match(/\{[\s\S]*?"name"[\s\S]*?\}/)
    if (objMatch) {
        // Expand to a balanced object starting at the first '{'.
        const start = text.indexOf('{', objMatch.index)
        let depth = 0
        for (let i = start; i < text.length; i++) {
            if (text[i] === '{') depth++
            else if (text[i] === '}') {
                depth--
                if (depth === 0) {
                    const parsed = tryParse(text.slice(start, i + 1))
                    if (parsed) return { ...parsed, pre: text.slice(0, start).trim() }
                    break
                }
            }
        }
    }

    return null
}

function buildPrompt(generator: any, messages: ChatMessage[], useTools: boolean): string {
    const tokenizer = generator.tokenizer
    if (useTools) {
        try {
            return tokenizer.apply_chat_template(messages, {
                tools: toolSchemas(),
                add_generation_prompt: true,
                tokenize: false,
            })
        } catch {
            // Model template doesn't support tools — fall through to plain chat.
        }
    }
    return tokenizer.apply_chat_template(messages, { add_generation_prompt: true, tokenize: false })
}

async function runGeneration(
    generator: any,
    prompt: string,
    mode: RuntimeMode,
    id: string,
    stream: boolean
): Promise<string> {
    const { TextStreamer, InterruptableStoppingCriteria } = await import('@huggingface/transformers')
    const stopper = new InterruptableStoppingCriteria()
    activeStopper = stopper

    let watchdog: ReturnType<typeof setTimeout> | null = null
    let stalled = false
    const arm = () => {
        if (watchdog) clearTimeout(watchdog)
        watchdog = setTimeout(() => {
            stalled = true
            stopper.interrupt()
        }, GENERATION_IDLE_TIMEOUT_MS)
    }
    const disarm = () => {
        if (watchdog) clearTimeout(watchdog)
        watchdog = null
    }

    let collected = ''
    const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (chunk: string) => {
            arm()
            collected += chunk
            if (stream) post({ type: 'chunk', id, chunk })
        },
    })

    arm()
    try {
        const out = await generator(prompt, {
            max_new_tokens: mode.maxNewTokens,
            do_sample: false,
            repetition_penalty: 1.1,
            no_repeat_ngram_size: 4,
            return_full_text: false,
            streamer,
            stopping_criteria: stopper,
        })
        if (!collected && Array.isArray(out) && out[0]?.generated_text) {
            collected = String(out[0].generated_text)
        }
    } finally {
        disarm()
    }
    if (stalled) throw new Error('Generation timed out.')
    return collected
}

async function handleGenerate(req: Extract<WorkerRequest, { type: 'generate' }>) {
    const generator = await loadGenerator(req.mode)
    const loadedMode = current?.mode ?? req.mode
    activeId = req.id

    const useTools = req.useTools === true
    const conversation: ChatMessage[] = [...req.messages]

    for (let step = 0; step < (useTools ? MAX_AGENT_STEPS : 1); step++) {
        if (cancelled.has(req.id)) break
        post({ type: 'step', id: req.id, step })

        const prompt = buildPrompt(generator, conversation, useTools)
        const text = await runGeneration(generator, prompt, loadedMode, req.id, true)

        if (!useTools) return

        const call = parseToolCall(text)
        if (!call) return // model produced a final answer

        // Record the assistant's tool-deciding turn, then run the tool.
        conversation.push({ role: 'assistant', content: text })
        post({ type: 'tool-call', id: req.id, name: call.name, args: JSON.stringify(call.args) })

        let result: string
        try {
            result = TOOLS[call.name].run(call.args)
        } catch (error) {
            result = `Error: ${errorMessage(error)}`
        }
        post({ type: 'tool-result', id: req.id, name: call.name, result })
        conversation.push({ role: 'tool', name: call.name, content: result })
    }

    // Hit the step cap still mid-tool-loop — force one final tool-free answer so
    // the user isn't left on a dangling tool result with no reply.
    if (useTools && !cancelled.has(req.id)) {
        post({ type: 'step', id: req.id, step: MAX_AGENT_STEPS })
        const prompt = buildPrompt(generator, conversation, false)
        await runGeneration(generator, prompt, loadedMode, req.id, true)
    }
}

workerSelf.addEventListener('message', event => {
    const request = event.data

    if (request.type === 'stop') {
        cancelled.add(request.id)
        if (request.id === activeId) activeStopper?.interrupt()
        return
    }

    if (request.type === 'warm') {
        void loadGenerator(request.mode).catch(() => undefined)
        return
    }

    if (request.type !== 'generate') return

    void (async () => {
        try {
            await handleGenerate(request)
            post({ type: 'done', id: request.id })
        } catch (error) {
            post({ type: 'error', id: request.id, message: errorMessage(error) })
        } finally {
            if (activeId === request.id) {
                activeStopper = null
                activeId = null
            }
            cancelled.delete(request.id)
        }
    })()
})

export {}
