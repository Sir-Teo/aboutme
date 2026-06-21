'use client'

import { useCallback, useState } from 'react'
import { connectMcp, callMcpTool, disconnectMcp, type McpTool } from '../agent/mcp'

// MCP lab: connect the browser to a live Model Context Protocol server (Streamable
// HTTP), list its tools, and invoke one — the same toolbox a cloud agent would
// use, driven entirely from this page. No GpuGate: this is networking, not WebGPU.

export default function McpLab() {
    const [url, setUrl] = useState('https://mcp.deepwiki.com/mcp')
    const [tools, setTools] = useState<McpTool[]>([])
    const [connected, setConnected] = useState(false)
    const [selected, setSelected] = useState<string>('')
    const [argsText, setArgsText] = useState('{}')
    const [result, setResult] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const connect = useCallback(async () => {
        setError('')
        setBusy(true)
        setResult('')
        try {
            const list = await connectMcp(url.trim())
            setTools(list)
            setConnected(true)
            setSelected(list[0]?.name ?? '')
        } catch (e) {
            setError(
                (e instanceof Error ? e.message : 'Connection failed.') +
                    ' — the server must be reachable and send permissive CORS headers.'
            )
            setConnected(false)
        } finally {
            setBusy(false)
        }
    }, [url])

    const disconnect = useCallback(async () => {
        await disconnectMcp()
        setConnected(false)
        setTools([])
        setResult('')
    }, [])

    const call = useCallback(async () => {
        if (!selected) return
        setError('')
        setBusy(true)
        setResult('')
        try {
            let args: Record<string, unknown> = {}
            if (argsText.trim()) args = JSON.parse(argsText)
            const out = await callMcpTool(selected, args)
            setResult(out)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Tool call failed.')
        } finally {
            setBusy(false)
        }
    }, [selected, argsText])

    const tool = tools.find(t => t.name === selected)

    return (
        <div className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <p className="text-[12px] text-slate-400">
                Model Context Protocol over Streamable HTTP — the in-browser agent calling live, remote tools.
            </p>

            <div className="mt-4 flex items-center gap-2">
                <input
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://your-mcp-server/mcp"
                    disabled={connected || busy}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-800 outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                    type="button"
                    onClick={connected ? disconnect : connect}
                    disabled={busy}
                    className="rounded-full bg-slate-900 px-4 py-1.5 text-[13px] text-white transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                >
                    {busy && !connected ? 'Connecting…' : connected ? 'Disconnect' : 'Connect'}
                </button>
            </div>

            {connected && (
                <div className="mt-4 space-y-3">
                    <p className="text-[12px] text-slate-500 dark:text-slate-400">
                        {tools.length} tool{tools.length === 1 ? '' : 's'} available
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                            value={selected}
                            onChange={e => setSelected(e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                            {tools.map(t => (
                                <option key={t.name} value={t.name}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={call}
                            disabled={busy}
                            className="rounded-full bg-slate-900 px-4 py-1.5 text-[13px] text-white transition enabled:hover:opacity-90 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                        >
                            {busy ? 'Calling…' : 'Call tool'}
                        </button>
                    </div>
                    {tool?.description && <p className="text-[12px] text-slate-400">{tool.description}</p>}
                    <label className="block text-[12px] text-slate-400">
                        Arguments (JSON)
                        <textarea
                            value={argsText}
                            onChange={e => setArgsText(e.target.value)}
                            rows={3}
                            spellCheck={false}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                    </label>
                </div>
            )}

            {result && (
                <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[12px] text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                    {result}
                </pre>
            )}
            {error && <p className="mt-3 text-[13px] text-rose-500">{error}</p>}
        </div>
    )
}
