'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { profile, links } from '../data/profile'

// A minimal in-browser terminal with a real command pipeline. It can't run
// host-OS commands (static site, no backend, browser sandbox), but every command
// does something real the browser allows: read the actual machine
// (`neofetch`/`uname`), live GitHub API data (`repos`), real SHA crypto (`hash`),
// a hand-written expression parser (`calc`, no eval), base64, UUIDs, and genuine
// Unix-style pipes — e.g. `ls social | grep git | wc -l`. The only non-trivial
// dependency is `python`, which lazy-loads Pyodide (CPython/WASM) from a CDN on
// first use, so it costs nothing on page load.

type Tone = 'out' | 'cmd' | 'err' | 'dim' | 'accent'
type Line = { text: string; tone?: Tone; prompt?: string }

// A command reads argv + piped stdin and returns text (one stage's stdout),
// pre-styled lines, or nothing. May be async (network / crypto).
type CmdOut = string | Line[] | void
type CmdFn = (args: string[], stdin: string) => CmdOut | Promise<CmdOut>

// ---- virtual filesystem -------------------------------------------------
type Dir = { [name: string]: Node }
type Node = string | Dir
const isDir = (n: Node | undefined): n is Dir => typeof n === 'object' && n !== null

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

function buildFS(): Dir {
    const social: Dir = {}
    for (const l of links) {
        const dest = l.href
            ? l.href
            : l.handle
            ? `@${l.handle}  (handle — copy with: open ${slug(l.label)})`
            : l.qrcode
            ? '(WeChat QR code — shown on the page)'
            : '(none)'
        social[`${slug(l.label)}.link`] = `${l.label}\n${dest}\n`
    }
    // Derive contact details from the link data so this never drifts.
    const emailLink = links.find(l => l.label === 'Email')
    const email = emailLink?.href?.replace(/^mailto:/, '') ?? ''
    const discord = links.find(l => l.label === 'Discord')?.handle ?? ''
    const contactRows = [email && `email    ${email}`, discord && `discord  ${discord}`].filter(Boolean)
    return {
        'about.txt': `${profile.name}\n${'='.repeat(profile.name.length)}\n${profile.tagline}\n`,
        'contact.txt': `${contactRows.join('\n')}\n\nMore links live in ./social — try: ls social\n`,
        'readme.md': `# ${profile.name}\n\nWelcome to the terminal. Type \`help\` for commands,\n\`ls\` to look around, or \`neofetch\` for system info.\n`,
        social,
    }
}

// ---- path helpers -------------------------------------------------------
function resolvePath(cwd: string[], target: string): string[] {
    let segs: string[]
    let rest = target
    if (target === '~' || target.startsWith('~/')) {
        segs = []
        rest = target.slice(1)
    } else if (target.startsWith('/')) {
        segs = []
    } else {
        segs = [...cwd]
    }
    for (const p of rest.split('/')) {
        if (!p || p === '.') continue
        if (p === '..') {
            if (segs.length) segs.pop()
            continue
        }
        segs.push(p)
    }
    return segs
}

function childKey(dir: Dir, name: string): string | undefined {
    if (name in dir) return name
    const lower = name.toLowerCase()
    return Object.keys(dir).find(k => k.toLowerCase() === lower)
}

function walk(root: Dir, segs: string[]): { node: Node; path: string[] } | null {
    let node: Node = root
    const path: string[] = []
    for (const s of segs) {
        if (!isDir(node)) return null
        const k = childKey(node, s)
        if (k === undefined) return null
        node = node[k]
        path.push(k)
    }
    return { node, path }
}

// Resolve a target down to its parent directory + final name, for create/remove
// operations on the (in-session, mutable) filesystem.
function resolveParent(
    root: Dir,
    cwd: string[],
    target: string
): { parent: Dir; name: string; existingKey?: string } | null {
    const segs = resolvePath(cwd, target)
    const name = segs.pop()
    if (!name) return null
    const parent = walk(root, segs)?.node
    if (!parent || !isDir(parent)) return null
    return { parent, name, existingKey: childKey(parent, name) }
}

// Write (or append) a string to a file, creating it if needed. Returns an error
// string, or null on success.
function writeFile(root: Dir, cwd: string[], target: string, content: string, append: boolean): string | null {
    const r = resolveParent(root, cwd, target)
    if (!r) return `${target}: no such directory`
    const key = r.existingKey ?? r.name
    if (isDir(r.parent[key])) return `${target}: is a directory`
    const prev = append && typeof r.parent[key] === 'string' ? (r.parent[key] as string) : ''
    r.parent[key] = prev + content
    return null
}

// Split a trailing `> file` / `>> file` redirection off a command (quote-aware).
function parseRedirect(cmd: string): { body: string; target: string | null; append: boolean } {
    let quote: string | null = null
    for (let i = 0; i < cmd.length; i++) {
        const c = cmd[i]
        if (quote) {
            if (c === quote) quote = null
            continue
        }
        if (c === '"' || c === "'") {
            quote = c
            continue
        }
        if (c === '>') {
            const append = cmd[i + 1] === '>'
            const body = cmd.slice(0, i).trim()
            const target = cmd.slice(i + (append ? 2 : 1)).trim()
            return { body, target: target || '', append }
        }
    }
    return { body: cmd, target: null, append: false }
}

function formatCwd(cwd: string[]): string {
    return cwd.length ? `~/${cwd.join('/')}` : '~'
}

function formatPrompt(cwd: string[]): string {
    return `teo@aboutme:${formatCwd(cwd)}$`
}

function sortedEntries(dir: Dir): string[] {
    return Object.keys(dir).sort((a, b) => {
        const da = isDir(dir[a])
        const db = isDir(dir[b])
        if (da !== db) return da ? -1 : 1
        return a.localeCompare(b)
    })
}

function listDir(dir: Dir): string {
    return sortedEntries(dir)
        .map(name => (isDir(dir[name]) ? `${name}/` : name))
        .join('  ')
}

function treeLines(dir: Dir, prefix = ''): string[] {
    const names = sortedEntries(dir)
    const out: string[] = []
    names.forEach((name, i) => {
        const last = i === names.length - 1
        const node = dir[name]
        out.push(`${prefix}${last ? '└── ' : '├── '}${name}${isDir(node) ? '/' : ''}`)
        if (isDir(node)) out.push(...treeLines(node, `${prefix}${last ? '    ' : '│   '}`))
    })
    return out
}

// ---- real machine introspection (the "real OS" bits) --------------------
function detectOS(): string {
    const uaData = (navigator as any).userAgentData
    if (uaData?.platform) return uaData.platform
    const ua = navigator.userAgent
    if (/Mac/i.test(ua)) return 'macOS'
    if (/Windows/i.test(ua)) return 'Windows'
    if (/Android/i.test(ua)) return 'Android'
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
    if (/Linux/i.test(ua)) return 'Linux'
    return navigator.platform || 'unknown'
}

function detectBrowser(): string {
    const ua = navigator.userAgent
    if (/Edg\//.test(ua)) return 'Edge'
    if (/OPR\//.test(ua)) return 'Opera'
    if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome'
    if (/Firefox\//.test(ua)) return 'Firefox'
    if (/Safari\//.test(ua)) return 'Safari'
    return 'browser'
}

function currentTheme(): string {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function applyTheme(theme: string) {
    const c = document.documentElement.classList
    c.toggle('dark', theme === 'dark')
    c.remove('pride') // drop any legacy pride class
    try {
        localStorage.setItem('theme', theme)
    } catch {}
}

const ASCII = [
    '  _____ _____ ___',
    ' |_   _| ____/ _ \\',
    '   | | |  _|| | | |',
    '   | | | |__| |_| |',
    '   |_| |_____\\___/',
]

function neofetchLines(): Line[] {
    const secs = Math.floor(performance.now() / 1000)
    const mins = Math.floor(secs / 60)
    const uptime = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`
    const mem = (navigator as any).deviceMemory
    const info: Array<[string, string]> = [
        ['OS', detectOS()],
        ['Host', `${detectBrowser()} (browser)`],
        ['Kernel', navigator.platform || 'n/a'],
        ['Shell', 'teosh 1.0.0'],
        ['Uptime', uptime],
        ['Resolution', `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio || 1}x`],
        ['Theme', currentTheme()],
        ['CPU', `${navigator.hardwareConcurrency || '?'} cores`],
        ['Memory', mem ? `${mem} GB` : 'n/a'],
        ['Locale', navigator.language || 'n/a'],
        ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'n/a'],
        ['Network', navigator.onLine ? 'online' : 'offline'],
    ]
    const lines: Line[] = ASCII.map(text => ({ text, tone: 'accent' }))
    lines.push({ text: '', tone: 'out' })
    lines.push({ text: 'teo@aboutme', tone: 'accent' })
    lines.push({ text: '-----------', tone: 'dim' })
    for (const [k, v] of info) lines.push({ text: `${(k + ':').padEnd(12)}${v}`, tone: 'out' })
    return lines
}

// ---- command helpers ----------------------------------------------------
// Quote-aware splitter so `echo "a | b"` doesn't split on the pipe inside quotes.
function splitPipes(s: string): string[] {
    const out: string[] = []
    let cur = ''
    let quote: string | null = null
    for (const c of s) {
        if (quote) {
            cur += c
            if (c === quote) quote = null
            continue
        }
        if (c === '"' || c === "'") {
            quote = c
            cur += c
            continue
        }
        if (c === '|') {
            out.push(cur)
            cur = ''
            continue
        }
        cur += c
    }
    out.push(cur)
    return out
}

// Tokenizer that honours single/double quotes (so multi-word args survive).
function tokenize(s: string): string[] {
    const out: string[] = []
    let cur = ''
    let quote: string | null = null
    let had = false
    for (const c of s) {
        if (quote) {
            if (c === quote) quote = null
            else cur += c
            continue
        }
        if (c === '"' || c === "'") {
            quote = c
            had = true
            continue
        }
        if (/\s/.test(c)) {
            if (cur !== '' || had) out.push(cur)
            cur = ''
            had = false
            continue
        }
        cur += c
        had = true
    }
    if (cur !== '' || had) out.push(cur)
    return out
}

// Hand-written recursive-descent arithmetic parser — no eval, no Function.
// Grammar: expr = term (('+'|'-') term)*; term = factor (('*'|'/'|'%') factor)*;
//          factor = ('+'|'-') factor | base ('^' factor)?; base = '(' expr ')' | number
function calcEval(input: string): number {
    const s = input.replace(/\s+/g, '')
    let i = 0
    const peek = () => s[i]
    const expr = (): number => {
        let v = term()
        while (peek() === '+' || peek() === '-') {
            const op = s[i++]
            v = op === '+' ? v + term() : v - term()
        }
        return v
    }
    const term = (): number => {
        let v = factor()
        while (peek() === '*' || peek() === '/' || peek() === '%') {
            const op = s[i++]
            const r = factor()
            v = op === '*' ? v * r : op === '/' ? v / r : v % r
        }
        return v
    }
    const factor = (): number => {
        if (peek() === '+') {
            i++
            return factor()
        }
        if (peek() === '-') {
            i++
            return -factor()
        }
        let v = base()
        if (peek() === '^') {
            i++
            v = Math.pow(v, factor())
        }
        return v
    }
    const base = (): number => {
        if (peek() === '(') {
            i++
            const v = expr()
            if (peek() !== ')') throw new Error('expected )')
            i++
            return v
        }
        const start = i
        while (i < s.length && /[0-9.]/.test(s[i])) i++
        if (i === start) throw new Error(`unexpected '${s[i] ?? 'end of input'}'`)
        const n = parseFloat(s.slice(start, i))
        if (isNaN(n)) throw new Error('invalid number')
        return n
    }
    const result = expr()
    if (i < s.length) throw new Error(`unexpected '${s[i]}'`)
    return result
}

function fmtNum(n: number): string {
    if (!isFinite(n)) return String(n)
    return Number.isInteger(n) ? String(n) : String(parseFloat(n.toPrecision(12)))
}

// Unicode-safe base64 (btoa only handles latin1).
const b64encode = (str: string) => {
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
}
const b64decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))

// crypto.randomUUID is unavailable on older Safari and outside secure contexts;
// fall back to getRandomValues, then Math.random as a last resort.
function uuidv4(): string {
    const c = typeof crypto !== 'undefined' ? crypto : undefined
    if (c?.randomUUID) return c.randomUUID()
    const b = new Uint8Array(16)
    if (c?.getRandomValues) c.getRandomValues(b)
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, x => x.toString(16).padStart(2, '0'))
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h
        .slice(10, 16)
        .join('')}`
}

async function digestHex(algo: string, text: string): Promise<string> {
    const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

// ---- Python (lazy-loaded Pyodide) ---------------------------------------
// Real CPython compiled to WebAssembly, fetched from the CDN only the first time
// `python` runs — so it costs nothing on page load. The promise is cached so the
// ~few-second download happens at most once per session.
const PYODIDE_VERSION = '0.26.4'
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
let pyodidePromise: Promise<any> | null = null

function loadPyodideRuntime(): Promise<any> {
    if (pyodidePromise) return pyodidePromise
    pyodidePromise = new Promise((resolve, reject) => {
        const w = window as any
        const rejectAndReset = (error: unknown) => {
            pyodidePromise = null // allow a retry on the next invocation
            reject(error)
        }
        const boot = () => w.loadPyodide({ indexURL: PYODIDE_BASE }).then(resolve, rejectAndReset)
        if (w.loadPyodide) return boot()
        const script = document.createElement('script')
        script.src = `${PYODIDE_BASE}pyodide.js`
        script.onload = boot
        script.onerror = () => rejectAndReset(new Error('failed to load the Python runtime'))
        document.head.appendChild(script)
    })
    return pyodidePromise
}

const pyodideReady = () => pyodidePromise !== null

// Pyodide tracebacks include its own internal frames (the eval_code_async / zip
// machinery). Keep the header, the user's own `<exec>` frames, and the final
// error so the message reads like a normal Python traceback.
function cleanTraceback(msg: string): string[] {
    const all = msg.replace(/\n$/, '').split('\n')
    const firstUser = all.findIndex(l => l.includes('"<exec>"'))
    if (firstUser === -1) return [all[all.length - 1] ?? 'python: error']
    return [all[0], ...all.slice(firstUser)]
}

async function runPython(code: string): Promise<Line[]> {
    let py: any
    try {
        py = await loadPyodideRuntime()
    } catch {
        return [{ text: 'python: could not load the runtime (offline?)', tone: 'err' }]
    }
    // `batched` is invoked once per flushed line, without the trailing newline.
    const buf: string[] = []
    py.setStdout({ batched: (s: string) => buf.push(s) })
    py.setStderr({ batched: (s: string) => buf.push(s) })
    let result: any
    try {
        result = await py.runPythonAsync(code)
    } catch (e: any) {
        return cleanTraceback(String(e?.message ?? e)).map(text => ({ text, tone: 'err' as Tone }))
    }
    const lines: Line[] = []
    const printed = buf.join('\n')
    if (printed) for (const t of printed.split('\n')) lines.push({ text: t })
    // Echo the value of a bare expression (REPL-style), but not None/statements.
    if (result !== undefined && result !== null) lines.push({ text: String(result) })
    if (typeof result?.destroy === 'function') result.destroy()
    return lines
}

function cowsay(text: string): string {
    const t = text.replace(/\s+/g, ' ').trim() || 'moo'
    const bar = '-'.repeat(t.length + 2)
    return [
        ` _${bar}_`,
        `< ${t} >`,
        ` -${bar}-`,
        '        \\   ^__^',
        '         \\  (oo)\\_______',
        '            (__)\\       )\\/\\',
        '                ||----w |',
        '                ||     ||',
    ].join('\n')
}

// Levenshtein distance — powers the "did you mean?" suggestion.
function lev(a: string, b: string): number {
    const m = a.length
    const n = b.length
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    return dp[m][n]
}

const FORTUNES = [
    'Premature optimization is the root of all evil. — Knuth',
    'Talk is cheap. Show me the code. — Torvalds',
    'There are only two hard things in CS: cache invalidation and naming things.',
    'Weeks of coding can save you hours of planning.',
    'It works on my machine. ¯\\_(ツ)_/¯',
    'Make it work, make it right, make it fast.',
    'The best error message is the one that never shows up.',
    'Simplicity is prerequisite for reliability. — Dijkstra',
]

// First `-n N` / bare number, else default.
function headCount(args: string[], def = 10): number {
    const i = args.indexOf('-n')
    if (i >= 0 && args[i + 1] && /^\d+$/.test(args[i + 1])) return parseInt(args[i + 1], 10)
    const bare = args.find(a => /^\d+$/.test(a))
    return bare ? parseInt(bare, 10) : def
}

const splitLines = (s: string) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'))

function normalize(res: CmdOut): { lines: Line[]; text: string } {
    if (res == null) return { lines: [], text: '' }
    if (typeof res === 'string') return { lines: splitLines(res).map(text => ({ text } as Line)), text: res }
    return { lines: res, text: res.map(l => l.text).join('\n') }
}

function notFound(name: string, names: string[]): Line[] {
    const ranked = names.map(n => [n, lev(name.toLowerCase(), n)] as [string, number]).sort((a, b) => a[1] - b[1])[0]
    const lines: Line[] = [{ text: `command not found: ${name}`, tone: 'err' }]
    if (ranked && ranked[1] > 0 && ranked[1] <= 3) lines.push({ text: `did you mean \`${ranked[0]}\`?`, tone: 'dim' })
    else lines.push({ text: 'type `help` to see available commands.', tone: 'dim' })
    return lines
}

const HELP_GROUPS: Array<[string, string[]]> = [
    ['files', ['ls', 'cd', 'cat', 'pwd', 'tree', 'touch', 'mkdir', 'rm', 'nano']],
    ['system', ['neofetch', 'uname', 'whoami', 'date', 'theme']],
    ['profile', ['links', 'open']],
    ['network', ['repos', 'ip']],
    ['compute', ['calc', 'python', 'hash', 'base64', 'uuid', 'rand']],
    ['text', ['echo', 'grep', 'wc', 'head', 'tail', 'sort', 'uniq', 'rev', 'cowsay', 'fortune']],
    ['shell', ['help', 'man', 'history', 'clear', 'exit']],
]

const MAN: Record<string, string> = {
    help: 'help — list commands grouped by category',
    clear: 'clear — clear the screen (or Ctrl+L)',
    ls: 'ls [path] — list directory contents',
    cd: 'cd [path] — change directory (no arg → home)',
    cat: 'cat <file> — print a file',
    pwd: 'pwd — print the working directory',
    tree: 'tree — print the filesystem as a tree',
    touch: 'touch <file> — create an empty file (in-session; resets on reload)',
    mkdir: 'mkdir <dir> — create a directory (in-session; resets on reload)',
    rm: 'rm [-r] <path> — remove a file (or directory with -r)',
    nano: 'nano <file> — edit a file (^S save · ^Enter run with python · esc exit). aliases: vim, edit',
    echo: 'echo [text] — print text. redirect with `echo hi > file` or `>>` to append',
    grep: 'grep [-i] <pattern> [file] — filter matching lines (regex; reads stdin)',
    wc: 'wc [-l|-w|-c] — count lines / words / chars of stdin',
    head: 'head [-n N] — first N lines of stdin (default 10)',
    tail: 'tail [-n N] — last N lines of stdin (default 10)',
    sort: 'sort [-r] [-n] — sort stdin lines',
    uniq: 'uniq — drop adjacent duplicate lines',
    rev: 'rev — reverse each line of stdin',
    whoami: 'whoami — print the current user',
    date: 'date — print the current date and time',
    uname: 'uname [-a] — print real system information',
    neofetch: 'neofetch — real machine + browser info with a logo',
    theme: 'theme [light|dark] — read or switch the live site theme',
    links: 'links — list every profile link and its destination',
    open: 'open <name> — open a profile link in a new tab (or copy a handle)',
    repos: 'repos — fetch live public repositories from the GitHub API',
    ip: 'ip — look up your public IP address',
    calc: 'calc <expr> — evaluate arithmetic (+ - * / % ^, parens). e.g. calc (2+3)*4^2',
    python: 'python [code] — run Python 3 (Pyodide/WASM). no args → interactive >>> REPL. alias: py',
    hash: 'hash [sha1|sha256|sha384|sha512] <text> — real cryptographic digest',
    base64: 'base64 [-d] <text> — base64 encode or decode (-d)',
    uuid: 'uuid [n] — generate n random v4 UUIDs',
    rand: 'rand [min] [max] — random integer in range',
    cowsay: 'cowsay <text> — the cow says it',
    fortune: 'fortune — a random programming aphorism',
    history: 'history — show command history',
    man: 'man <command> — show a one-line manual',
    exit: 'exit — close the terminal (aliases: close, quit, :q)',
}

// ---- the component ------------------------------------------------------
export default function Terminal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const fs = useMemo(buildFS, [])
    const [lines, setLines] = useState<Line[]>([])
    const [input, setInput] = useState('')
    const [cwd, setCwd] = useState<string[]>([])
    const [histIdx, setHistIdx] = useState(-1)
    // Interactive Python REPL: null = normal shell; otherwise we're inside `python`,
    // `buffer` holds the lines of an in-progress multi-line block.
    const [repl, setRepl] = useState<{ buffer: string[] } | null>(null)
    // nano-style editor: null = closed; otherwise editing `file` with starting `content`.
    const [editor, setEditor] = useState<{ file: string; content: string } | null>(null)
    const editorRef = useRef<HTMLTextAreaElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const cwdRef = useRef<string[]>([])
    const historyRef = useRef<string[]>([])
    // Serialize pipelines so output always lands in submission order, even when a
    // slow command (e.g. `repos`) is followed by a fast one.
    const runRef = useRef<Promise<void>>(Promise.resolve())
    const enqueue = useCallback((task: () => Promise<void>) => {
        runRef.current = runRef.current
            .catch(() => undefined)
            .then(task)
            .catch((e: any) => {
                setLines(l => [...l, { text: `terminal: ${e?.message ?? 'unexpected error'}`, tone: 'err' }])
            })
    }, [])

    const pathStr = formatCwd(cwd)
    const promptStr = formatPrompt(cwd)
    // The prompt shown on the live input line: shell prompt, or Python's >>> / ...
    const livePrompt = repl ? (repl.buffer.length ? '...' : '>>>') : promptStr

    const updateCwd = useCallback((path: string[]) => {
        cwdRef.current = path
        setCwd(path)
    }, [])

    // Keep the newest output and the input line in view.
    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [lines, open])

    // Focus the prompt when the panel opens, or the editor when it opens.
    useEffect(() => {
        if (!open) return
        if (editor) editorRef.current?.focus()
        else inputRef.current?.focus()
    }, [open, editor])

    // Command registry. Closures capture live state via refs (cwd, history) and the
    // memoized fs, so it only needs rebuilding when the filesystem changes — not on
    // every keystroke. Kept stable to avoid re-allocating ~40 closures per render.
    const registry: Record<string, CmdFn> = useMemo(() => {
        const reg: Record<string, CmdFn> = {
            help: () => {
                const out: Line[] = [{ text: 'commands', tone: 'accent' }]
                for (const [group, cmds] of HELP_GROUPS) out.push({ text: `  ${group.padEnd(8)} ${cmds.join(' ')}` })
                out.push({ text: '' })
                out.push({
                    text: 'pipes & redirects: ls social | grep git | wc -l   ·   echo hi > note.txt',
                    tone: 'dim',
                })
                out.push({
                    text: 'python → >>> REPL   ·   nano file.py → edit then ^Enter to run   ·   ↑/↓ history · tab',
                    tone: 'dim',
                })
                return out
            },
            pwd: () => {
                const current = cwdRef.current
                return `/home/teo${current.length ? '/' + current.join('/') : ''}`
            },
            whoami: () => 'teo',
            date: () => new Date().toString(),
            echo: args => args.join(' '),
            uname: args =>
                args.includes('-a')
                    ? `teosh ${detectOS()} ${navigator.platform} ${detectBrowser()} aboutme`
                    : detectOS(),
            neofetch: () => neofetchLines(),
            screenfetch: () => neofetchLines(),
            ls: args => {
                const target = args.find(a => !a.startsWith('-'))
                const current = cwdRef.current
                const res = walk(fs, target ? resolvePath(current, target) : current)
                if (!res) return [{ text: `ls: ${target}: no such file or directory`, tone: 'err' }]
                return isDir(res.node) ? listDir(res.node) : res.path[res.path.length - 1] ?? target ?? ''
            },
            cd: args => {
                const target = args[0] ?? '~'
                const res = walk(fs, resolvePath(cwdRef.current, target))
                if (!res) return [{ text: `cd: ${target}: no such file or directory`, tone: 'err' }]
                if (!isDir(res.node)) return [{ text: `cd: ${target}: not a directory`, tone: 'err' }]
                updateCwd(res.path)
            },
            cat: args => {
                if (!args[0]) return [{ text: 'usage: cat <file>', tone: 'err' }]
                const res = walk(fs, resolvePath(cwdRef.current, args[0]))
                if (!res) return [{ text: `cat: ${args[0]}: no such file or directory`, tone: 'err' }]
                if (isDir(res.node)) return [{ text: `cat: ${args[0]}: is a directory`, tone: 'err' }]
                return res.node
            },
            tree: () => {
                const current = cwdRef.current
                const node = walk(fs, current)?.node
                return [formatCwd(current), ...treeLines(isDir(node) ? node : fs)].join('\n')
            },
            // --- writable, in-session filesystem (resets on reload) ---
            touch: args => {
                if (!args[0]) return [{ text: 'usage: touch <file>', tone: 'err' }]
                const r = resolveParent(fs, cwdRef.current, args[0])
                if (!r) return [{ text: `touch: ${args[0]}: no such directory`, tone: 'err' }]
                const key = r.existingKey ?? r.name
                if (isDir(r.parent[key])) return [{ text: `touch: ${args[0]}: is a directory`, tone: 'err' }]
                if (r.existingKey === undefined) r.parent[key] = ''
            },
            mkdir: args => {
                if (!args[0]) return [{ text: 'usage: mkdir <dir>', tone: 'err' }]
                const r = resolveParent(fs, cwdRef.current, args[0])
                if (!r) return [{ text: `mkdir: ${args[0]}: no such directory`, tone: 'err' }]
                if (r.existingKey !== undefined) return [{ text: `mkdir: ${args[0]}: already exists`, tone: 'err' }]
                r.parent[r.name] = {}
            },
            rm: args => {
                const recursive = args.includes('-r') || args.includes('-rf')
                const target = args.find(a => !a.startsWith('-'))
                if (!target) return [{ text: 'usage: rm [-r] <path>', tone: 'err' }]
                const r = resolveParent(fs, cwdRef.current, target)
                if (!r || r.existingKey === undefined)
                    return [{ text: `rm: ${target}: no such file or directory`, tone: 'err' }]
                if (isDir(r.parent[r.existingKey]) && !recursive)
                    return [{ text: `rm: ${target}: is a directory (use -r)`, tone: 'err' }]
                delete r.parent[r.existingKey]
            },
            theme: args => {
                if (!args[0]) return `theme: ${currentTheme()} (options: light, dark)`
                const t = args[0].toLowerCase()
                if (!['light', 'dark'].includes(t))
                    return [{ text: `theme: unknown theme '${args[0]}' (try light, dark)`, tone: 'err' }]
                applyTheme(t)
                return [{ text: `theme → ${t}`, tone: 'accent' }]
            },
            links: () => {
                const w = Math.max(...links.map(l => l.label.length))
                const out: Line[] = [{ text: 'profile links', tone: 'accent' }]
                for (const l of links) {
                    const dest = l.href ?? (l.handle ? `@${l.handle}` : l.qrcode ? '(WeChat QR)' : '')
                    out.push({ text: `${l.label.padEnd(w + 2)}${dest}` })
                }
                out.push({ text: '' }, { text: 'open <name> to launch, e.g. open github', tone: 'dim' })
                return out
            },
            open: async args => {
                const target = args[0]
                if (!target) return [{ text: 'usage: open <name> — run `links` to see names', tone: 'err' }]
                const link = links.find(
                    l => slug(l.label) === slug(target) || l.label.toLowerCase() === target.toLowerCase()
                )
                if (!link) return [{ text: `open: no link named '${target}' — try \`links\``, tone: 'err' }]
                if (link.href) {
                    window.open(link.href, '_blank', 'noopener,noreferrer')
                    return [{ text: `opening ${link.label} → ${link.href}`, tone: 'accent' }]
                }
                if (link.handle) {
                    try {
                        if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
                        await navigator.clipboard.writeText(link.handle)
                        return [{ text: `copied ${link.label} handle: ${link.handle}`, tone: 'accent' }]
                    } catch {
                        return [{ text: `open: could not copy ${link.label} handle: ${link.handle}`, tone: 'err' }]
                    }
                }
                return [{ text: `${link.label}: scan the QR code shown on the page`, tone: 'accent' }]
            },
            history: () => historyRef.current.map((h, i) => `${String(i + 1).padStart(3)}  ${h}`).join('\n'),
            man: args => {
                if (!args[0]) return [{ text: 'usage: man <command>', tone: 'err' }]
                const entry = MAN[args[0].toLowerCase()]
                return entry ?? [{ text: `man: no manual entry for ${args[0]}`, tone: 'err' }]
            },
            // --- text filters (read piped stdin) ---
            grep: (args, stdin) => {
                const flags = args.filter(a => a.startsWith('-'))
                const pos = args.filter(a => !a.startsWith('-'))
                const pattern = pos[0]
                if (pattern == null) return [{ text: 'usage: grep [-i] <pattern> [file]', tone: 'err' }]
                let content = stdin
                if (!content && pos[1]) {
                    const res = walk(fs, resolvePath(cwdRef.current, pos[1]))
                    if (!res || isDir(res.node)) return [{ text: `grep: ${pos[1]}: no such file`, tone: 'err' }]
                    content = res.node
                }
                const flag = flags.includes('-i') ? 'i' : ''
                let re: RegExp
                try {
                    re = new RegExp(pattern, flag)
                } catch {
                    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flag)
                }
                return splitLines(content)
                    .filter(l => re.test(l))
                    .join('\n')
            },
            wc: (args, stdin) => {
                const nl = splitLines(stdin).length
                const words = (stdin.match(/\S+/g) || []).length
                const chars = stdin.length
                if (args.includes('-l')) return String(nl)
                if (args.includes('-w')) return String(words)
                if (args.includes('-c')) return String(chars)
                return `${String(nl).padStart(4)} ${String(words).padStart(4)} ${String(chars).padStart(4)}`
            },
            head: (args, stdin) => splitLines(stdin).slice(0, headCount(args)).join('\n'),
            tail: (args, stdin) => {
                const ls = splitLines(stdin)
                return ls.slice(Math.max(0, ls.length - headCount(args))).join('\n')
            },
            sort: (args, stdin) => {
                const ls = splitLines(stdin)
                const numeric = args.includes('-n')
                ls.sort((a, b) => {
                    if (numeric) {
                        const na = parseFloat(a)
                        const nb = parseFloat(b)
                        // Fall back to string order when either side isn't a number,
                        // so non-numeric lines don't produce NaN (unstable) comparisons.
                        if (!isNaN(na) && !isNaN(nb)) return na - nb
                    }
                    return a.localeCompare(b)
                })
                if (args.includes('-r')) ls.reverse()
                return ls.join('\n')
            },
            uniq: (_args, stdin) =>
                splitLines(stdin)
                    .filter((l, i, a) => i === 0 || l !== a[i - 1])
                    .join('\n'),
            rev: (_args, stdin) =>
                splitLines(stdin)
                    .map(l => l.split('').reverse().join(''))
                    .join('\n'),
            // --- compute / utilities ---
            calc: (args, stdin) => {
                const expr = (args.join(' ') || stdin).trim()
                if (!expr) return [{ text: 'usage: calc <expression>   e.g. calc (2+3)*4^2', tone: 'err' }]
                try {
                    return fmtNum(calcEval(expr))
                } catch (e: any) {
                    return [{ text: `calc: ${e?.message ?? 'parse error'}`, tone: 'err' }]
                }
            },
            base64: (args, stdin) => {
                const decode = args.includes('-d')
                const text = args.filter(a => a !== '-d').join(' ') || stdin
                if (!text) return [{ text: 'usage: base64 [-d] <text>', tone: 'err' }]
                try {
                    return decode ? b64decode(text.trim()) : b64encode(text)
                } catch {
                    return [{ text: 'base64: invalid input', tone: 'err' }]
                }
            },
            uuid: args => {
                const n = Math.min(Math.max(parseInt(args[0], 10) || 1, 1), 20)
                return Array.from({ length: n }, () => uuidv4()).join('\n')
            },
            rand: args => {
                const a = parseInt(args[0], 10)
                const b = parseInt(args[1], 10)
                let lo = 0
                let hi = 100
                if (!isNaN(a) && !isNaN(b)) [lo, hi] = [a, b]
                else if (!isNaN(a)) hi = a
                if (hi < lo) [lo, hi] = [hi, lo]
                return String(Math.floor(Math.random() * (hi - lo + 1)) + lo)
            },
            cowsay: (args, stdin) => cowsay(args.join(' ') || stdin),
            fortune: () => FORTUNES[Math.floor(Math.random() * FORTUNES.length)],
            sudo: () => [{ text: 'teo is not in the sudoers file. This incident will be reported.', tone: 'err' }],
            // --- async / network ---
            python: async (args, stdin) => {
                const ci = args.indexOf('-c')
                let code = (ci >= 0 ? args.slice(ci + 1).join(' ') : args.join(' ') || stdin).trim()
                // `python <file>`: if the sole argument names an existing file, run it.
                const noFlags = args.filter(a => !a.startsWith('-'))
                if (ci < 0 && noFlags.length === 1) {
                    const res = walk(fs, resolvePath(cwdRef.current, noFlags[0]))
                    if (res && typeof res.node === 'string') code = res.node
                }
                if (!code) return [{ text: 'usage: python <code|file>   e.g. python script.py', tone: 'err' }]
                // Surface the one-time download so a cold first run doesn't look frozen.
                if (!pyodideReady())
                    setLines(l => [
                        ...l,
                        { text: 'loading Python runtime (first run only, a few seconds)…', tone: 'dim' },
                    ])
                return runPython(code)
            },
            hash: async (args, stdin) => {
                const algos: Record<string, string> = {
                    sha1: 'SHA-1',
                    sha256: 'SHA-256',
                    sha384: 'SHA-384',
                    sha512: 'SHA-512',
                }
                const rest = [...args]
                let algo = 'sha256'
                if (rest[0] && algos[rest[0].toLowerCase()]) algo = (rest.shift() as string).toLowerCase()
                const text = rest.join(' ') || stdin
                if (!text) return [{ text: 'usage: hash [sha1|sha256|sha384|sha512] <text>', tone: 'err' }]
                if (typeof crypto === 'undefined' || !crypto.subtle)
                    return [
                        {
                            text: 'hash: Web Crypto unavailable (needs a secure context — https or localhost)',
                            tone: 'err',
                        },
                    ]
                return digestHex(algos[algo], text)
            },
            repos: async () => {
                try {
                    const r = await fetch('https://api.github.com/users/Sir-Teo/repos?per_page=100&sort=updated')
                    if (!r.ok) return [{ text: `repos: GitHub API returned HTTP ${r.status}`, tone: 'err' }]
                    const data: any[] = await r.json()
                    if (!Array.isArray(data) || !data.length) return 'no public repositories found'
                    const top = [...data].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 8)
                    const w = Math.max(...top.map(rp => rp.name.length))
                    const out: Line[] = [{ text: `Sir-Teo · ${data.length} public repos (top by ★)`, tone: 'accent' }]
                    for (const rp of top) {
                        const lang = rp.language ? ` [${rp.language}]` : ''
                        out.push({ text: `${rp.name.padEnd(w + 1)} ${('★' + rp.stargazers_count).padStart(5)}${lang}` })
                        if (rp.description) out.push({ text: `  ${rp.description}`, tone: 'dim' })
                    }
                    return out
                } catch {
                    return [{ text: 'repos: network error (offline?)', tone: 'err' }]
                }
            },
            ip: async () => {
                try {
                    const r = await fetch('https://api.ipify.org?format=json')
                    const d = await r.json()
                    return `public IP: ${d.ip}`
                } catch {
                    return [{ text: 'ip: lookup failed (offline?)', tone: 'err' }]
                }
            },
        }
        reg.github = reg.repos // `github` aliases `repos`
        reg.py = reg.python // `py` aliases `python`
        return reg
    }, [fs, updateCwd])

    const commandNames = useMemo(
        () => Array.from(new Set([...Object.keys(registry), 'clear', 'exit', 'nano', 'vim', 'edit'])).sort(),
        [registry]
    )

    const runPipeline = async (stages: string[]): Promise<Line[]> => {
        let stdin = ''
        let finalLines: Line[] = []
        for (let i = 0; i < stages.length; i++) {
            const tokens = tokenize(stages[i].trim())
            if (!tokens.length) return [{ text: 'syntax error near `|`', tone: 'err' }]
            const [name, ...args] = tokens
            const fn = registry[name.toLowerCase()]
            if (!fn) return notFound(name, commandNames)
            let res: CmdOut
            try {
                res = await fn(args, stdin)
            } catch (e: any) {
                return [{ text: `${name}: ${e?.message ?? 'error'}`, tone: 'err' }]
            }
            const norm = normalize(res)
            // Stop a pipeline early if a non-final stage errored.
            if (i < stages.length - 1 && norm.lines.some(l => l.tone === 'err')) return norm.lines
            stdin = norm.text
            finalLines = norm.lines
        }
        return finalLines
    }

    // --- nano-style editor -------------------------------------------------
    const openEditor = (file: string) => {
        const res = walk(fs, resolvePath(cwdRef.current, file))
        if (res && isDir(res.node)) {
            setLines(l => [...l, { text: `${file}: is a directory`, tone: 'err' }])
            return
        }
        const content = res && typeof res.node === 'string' ? res.node : ''
        setEditor({ file, content })
    }

    const saveEditor = (): boolean => {
        if (!editor || !editorRef.current) return false
        const err = writeFile(fs, cwdRef.current, editor.file, editorRef.current.value, false)
        if (err) {
            setLines(l => [...l, { text: `nano: ${err}`, tone: 'err' }])
            return false
        }
        return true
    }

    // Save and show a confirmation line (shared by the Save button and Ctrl+S).
    const saveEditorWithMsg = () => {
        const file = editor?.file
        if (saveEditor()) setLines(l => [...l, { text: `saved ${file}`, tone: 'dim' }])
    }

    const exitEditor = (save: boolean) => {
        const file = editor?.file
        const ok = save ? saveEditor() : true
        setEditor(null)
        if (save && ok && file) setLines(l => [...l, { text: `saved ${file}`, tone: 'dim' }])
    }

    // Save, leave the editor, and run the file through Python (Ctrl+Enter).
    const runEditorWithPython = () => {
        if (!editor || !editorRef.current) return
        const file = editor.file
        const code = editorRef.current.value
        if (!saveEditor()) return
        setEditor(null)
        setLines(l => [
            ...l,
            { text: `saved ${file}`, tone: 'dim' },
            { prompt: formatPrompt(cwdRef.current), text: `python ${file}`, tone: 'cmd' },
        ])
        if (!pyodideReady()) setLines(l => [...l, { text: 'loading Python runtime (first run only)…', tone: 'dim' }])
        enqueue(async () => {
            const out = await runPython(code)
            if (out.length) setLines(l => [...l, ...out])
        })
    }

    const onEditorKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        const mod = e.ctrlKey || e.metaKey
        if (e.key === 'Enter' && mod) {
            e.preventDefault()
            runEditorWithPython()
        } else if (e.key === 's' && mod) {
            e.preventDefault()
            saveEditorWithMsg()
        } else if ((e.key === 'x' && e.ctrlKey) || e.key === 'Escape') {
            e.preventDefault()
            exitEditor(true)
        } else if (e.key === 'Tab') {
            e.preventDefault()
            const ta = e.currentTarget
            ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end')
        }
    }

    // Enter the interactive Python REPL (kicked off by a bare `python`/`py`).
    const enterRepl = () => {
        setRepl({ buffer: [] })
        const banner: Line = { text: 'Python (Pyodide) — type exit() to leave', tone: 'accent' }
        if (!pyodideReady()) {
            setLines(l => [...l, { text: 'loading Python runtime (first run only)…', tone: 'dim' }, banner])
            loadPyodideRuntime().catch(() => {})
        } else {
            setLines(l => [...l, banner])
        }
    }

    // Handle one line typed at the >>> / ... prompt.
    const runReplLine = (raw: string) => {
        const buffer = repl?.buffer ?? []
        const echo: Line = { prompt: buffer.length ? '...' : '>>>', text: raw, tone: 'cmd' }
        const trimmed = raw.trim()
        if (trimmed) historyRef.current = [...historyRef.current, raw]
        setHistIdx(-1)
        // Leave the REPL (only when not mid-block).
        if (buffer.length === 0 && ['exit()', 'quit()', 'exit', 'quit'].includes(trimmed)) {
            setLines(l => [...l, echo, { text: 'leaving Python', tone: 'dim' }])
            setRepl(null)
            return
        }
        const nextBuf = [...buffer, raw]
        // A line ending in `:` opens a block; once in a block, keep collecting until
        // a blank line — mirroring CPython's own REPL continuation behaviour.
        const inBlock = nextBuf.length > 1 || /:\s*$/.test(nextBuf[0])
        setLines(l => [...l, echo])
        if (inBlock && trimmed !== '') {
            setRepl({ buffer: nextBuf })
            return
        }
        setRepl({ buffer: [] })
        const code = nextBuf.join('\n')
        if (!code.trim()) return
        enqueue(async () => {
            const out = await runPython(code)
            if (out.length) setLines(l => [...l, ...out])
        })
    }

    const run = (raw: string) => {
        if (repl) return runReplLine(raw)
        const echo: Line = { prompt: formatPrompt(cwdRef.current), text: raw, tone: 'cmd' }
        const cmd = raw.trim()
        if (cmd) {
            const nextHistory = [...historyRef.current, cmd]
            historyRef.current = nextHistory
        }
        setHistIdx(-1)
        if (!cmd) {
            setLines(l => [...l, echo])
            return
        }
        const { body, target, append } = parseRedirect(cmd)
        let redirectTarget: string | null = null
        if (target !== null) {
            const redirectTokens = tokenize(target)
            if (!redirectTokens.length) {
                setLines(l => [...l, echo, { text: 'syntax error near unexpected token `newline`', tone: 'err' }])
                return
            }
            if (redirectTokens.length > 1) {
                setLines(l => [...l, echo, { text: `ambiguous redirect: ${target}`, tone: 'err' }])
                return
            }
            redirectTarget = redirectTokens[0]
        }
        const stages = splitPipes(body)
        if (target === null && stages.length === 1) {
            const tokens = tokenize(stages[0])
            const first = (tokens[0] ?? '').toLowerCase()
            if (first === 'clear') {
                setLines([])
                return
            }
            if (['exit', 'close', 'quit', ':q'].includes(first)) {
                setLines(l => [...l, echo, { text: 'closing…', tone: 'dim' }])
                onClose()
                return
            }
            // Bare `python`/`py` (no code) starts the interactive REPL.
            if ((first === 'python' || first === 'py') && tokens.length === 1) {
                setLines(l => [...l, echo])
                enterRepl()
                return
            }
            // nano/vim/edit open the in-terminal editor.
            if (['nano', 'vim', 'edit'].includes(first)) {
                setLines(l => [...l, echo])
                if (!tokens[1]) {
                    setLines(l => [...l, { text: `usage: ${first} <file>`, tone: 'err' }])
                    return
                }
                openEditor(tokens[1])
                return
            }
        }
        setLines(l => [...l, echo])
        enqueue(async () => {
            const out = await runPipeline(stages)
            if (redirectTarget !== null) {
                // On error, surface it and don't write; otherwise redirect stdout to the file.
                if (out.some(l => l.tone === 'err')) {
                    setLines(l => [...l, ...out])
                    return
                }
                const content = out.map(l => l.text).join('\n')
                const err = writeFile(fs, cwdRef.current, redirectTarget, content ? content + '\n' : '', append)
                if (err) setLines(l => [...l, { text: `bash: ${err}`, tone: 'err' }])
                return
            }
            if (out.length) setLines(l => [...l, ...out])
        })
    }

    const complete = () => {
        const tokens = input.split(/(\s+)/) // keep whitespace tokens
        const last = tokens[tokens.length - 1]
        if (!last) return
        const afterPipe = input.split('|').pop() ?? input
        const isCmdPos = afterPipe.trimStart() === last
        let pool: string[]
        if (isCmdPos) {
            pool = commandNames
        } else {
            // A trailing slash means "list this directory's contents" — the partial
            // is empty, so don't let resolvePath collapse the slash away.
            const endsWithSlash = last.endsWith('/')
            const segs = resolvePath(cwdRef.current, last)
            const partial = endsWithSlash ? '' : segs.pop() ?? ''
            const dir = walk(fs, segs)?.node
            const prefix = last.slice(0, last.length - partial.length)
            pool = isDir(dir) ? Object.keys(dir).map(k => `${prefix}${k}${isDir(dir[k]) ? '/' : ''}`) : []
        }
        const matches = pool.filter(c => c.toLowerCase().startsWith(last.toLowerCase()))
        if (matches.length === 1) {
            tokens[tokens.length - 1] = matches[0]
            setInput(tokens.join(''))
        } else if (matches.length > 1) {
            setLines(l => [
                ...l,
                { prompt: promptStr, text: input, tone: 'cmd' },
                { text: matches.join('  '), tone: 'dim' },
            ])
        }
    }

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            run(input)
            setInput('')
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            const entries = historyRef.current
            if (!entries.length) return
            const idx = histIdx < 0 ? entries.length - 1 : Math.max(0, histIdx - 1)
            setHistIdx(idx)
            setInput(entries[idx])
        } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (histIdx < 0) return
            const entries = historyRef.current
            const idx = histIdx + 1
            if (idx >= entries.length) {
                setHistIdx(-1)
                setInput('')
            } else {
                setHistIdx(idx)
                setInput(entries[idx])
            }
        } else if (e.key === 'Tab') {
            e.preventDefault()
            if (repl) setInput(input + '    ') // indent inside the Python REPL
            else complete()
        } else if (e.key === 'l' && e.ctrlKey) {
            e.preventDefault()
            setLines([])
        } else if (e.key === 'c' && e.ctrlKey) {
            e.preventDefault()
            setLines(l => [...l, { prompt: livePrompt, text: `${input}^C`, tone: 'cmd' }])
            if (repl) setRepl({ buffer: [] }) // abandon the in-progress block
            setInput('')
        }
    }

    const toneClass: Record<Tone, string> = {
        out: 'text-slate-200',
        cmd: 'text-slate-100',
        err: 'text-rose-400',
        dim: 'text-slate-500',
        accent: 'text-emerald-400',
    }

    // Kept mounted and animated via the grid-rows 0fr→1fr trick so the open/close
    // transition actually runs (returning null would make `transition-all` dead).
    return (
        <div
            aria-hidden={!open}
            className={`grid transition-all duration-300 ease-out motion-reduce:transition-none ${
                open ? 'mt-3 grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'
            }`}
        >
            <div className="min-h-0 overflow-hidden">
                <div className="relative rounded-xl bg-slate-900 ring-1 ring-slate-800 dark:bg-black">
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close terminal panel"
                        tabIndex={open ? 0 : -1}
                        className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded text-slate-600 transition hover:text-slate-300"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            aria-hidden
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        >
                            <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                    </button>
                    {editor ? (
                        /* nano-style editor */
                        <div className="flex h-[clamp(180px,50vh,340px)] flex-col font-mono text-[16px] sm:text-[13px]">
                            <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2 pr-9 text-emerald-400">
                                <span className="truncate">nano · {editor.file}</span>
                            </div>
                            <textarea
                                key={editor.file}
                                ref={editorRef}
                                defaultValue={editor.content}
                                onKeyDown={onEditorKey}
                                spellCheck={false}
                                autoComplete="off"
                                autoCapitalize="off"
                                autoCorrect="off"
                                aria-label={`Editing ${editor.file}`}
                                tabIndex={open ? 0 : -1}
                                className="flex-1 resize-none bg-transparent px-3.5 py-3 leading-relaxed text-slate-100 caret-emerald-400 outline-none"
                            />
                            {/* Tappable controls so the editor works on touch devices too,
                                not just via Ctrl+S/Ctrl+Enter/Esc keyboard shortcuts. */}
                            <div className="flex items-center gap-2 border-t border-slate-800 px-3 py-2">
                                <button
                                    type="button"
                                    onClick={saveEditorWithMsg}
                                    tabIndex={open ? 0 : -1}
                                    className="rounded px-2.5 py-1 text-[13px] text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-800 active:bg-slate-700"
                                >
                                    Save
                                </button>
                                <button
                                    type="button"
                                    onClick={runEditorWithPython}
                                    tabIndex={open ? 0 : -1}
                                    className="rounded bg-emerald-600/90 px-2.5 py-1 text-[13px] text-white transition hover:bg-emerald-600 active:bg-emerald-700"
                                >
                                    ▶ Run
                                </button>
                                <button
                                    type="button"
                                    onClick={() => exitEditor(true)}
                                    tabIndex={open ? 0 : -1}
                                    className="rounded px-2.5 py-1 text-[13px] text-slate-400 ring-1 ring-slate-700 transition hover:bg-slate-800 active:bg-slate-700"
                                >
                                    Exit
                                </button>
                                <span className="ml-auto hidden text-[12px] text-slate-600 sm:inline">
                                    ^S save · ^↵ run · esc exit · tab indent
                                </span>
                            </div>
                        </div>
                    ) : (
                        /* screen */
                        <div
                            ref={scrollRef}
                            onClick={() => {
                                if (!window.getSelection()?.toString()) inputRef.current?.focus()
                            }}
                            className="h-[clamp(180px,50vh,340px)] overflow-y-auto px-3.5 py-3 pr-9 font-mono text-[16px] leading-relaxed sm:text-[13px]"
                        >
                            {lines.map((line, i) => (
                                <div
                                    key={i}
                                    className={`whitespace-pre-wrap break-words ${toneClass[line.tone ?? 'out']}`}
                                >
                                    {line.prompt && <span className="text-emerald-400">{line.prompt} </span>}
                                    {line.text}
                                </div>
                            ))}
                            {/* prompt line */}
                            <div className="flex">
                                <span className="shrink-0 text-emerald-400">{livePrompt}&nbsp;</span>
                                <input
                                    ref={inputRef}
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    onKeyDown={onKeyDown}
                                    spellCheck={false}
                                    autoComplete="off"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    enterKeyHint="go"
                                    aria-label="Terminal input"
                                    tabIndex={open ? 0 : -1}
                                    className="w-full flex-1 bg-transparent text-slate-100 caret-emerald-400 outline-none"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
