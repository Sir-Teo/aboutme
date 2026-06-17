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
          toolContext?: string
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
    run: (args: any, ctx: { toolContext?: string }) => string
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
                return String(value)
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
    get_profile_info: {
        schema: {
            type: 'function',
            function: {
                name: 'get_profile_info',
                description:
                    'Look up facts about Teo Zeng (the owner of this website) — work, education, research, projects, skills, links, or interests.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'What to look up, e.g. "education", "work", "projects", "links".',
                        },
                    },
                    required: ['query'],
                },
            },
        },
        run: (args, ctx) => {
            const ctxText = ctx.toolContext || ''
            if (!ctxText) return 'No profile information is available.'
            const query = String(args?.query ?? '')
                .toLowerCase()
                .trim()
            if (!query) return ctxText
            const lines = ctxText.split('\n').filter(Boolean)
            const terms = query.split(/\s+/).filter(t => t.length > 2)
            const matches = lines.filter(line => {
                const l = line.toLowerCase()
                return terms.some(t => l.includes(t))
            })
            return (matches.length ? matches : lines).join('\n')
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
            result = TOOLS[call.name].run(call.args, { toolContext: req.toolContext })
        } catch (error) {
            result = `Error: ${errorMessage(error)}`
        }
        post({ type: 'tool-result', id: req.id, name: call.name, result })
        conversation.push({ role: 'tool', name: call.name, content: result })
    }
    // Hit the step cap without a final answer — let the client finalize what it has.
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
