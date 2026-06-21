// Browser MCP client — connects the in-browser agent to a live Model Context
// Protocol server over Streamable HTTP (the only transport a browser can speak;
// stdio is server-only). Lets the on-device agent discover and call real,
// versioned tools served anywhere — no backend of our own.
//
// Caveat that lives in the UI too: the target server must be reachable from the
// browser and send permissive CORS headers, since this runs from the page origin.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export type McpTool = { name: string; description: string; inputSchema: any }

let client: Client | null = null
let connectedUrl: string | null = null

export function mcpConnectedUrl(): string | null {
    return connectedUrl
}

export async function connectMcp(url: string): Promise<McpTool[]> {
    await disconnectMcp()
    const c = new Client({ name: 'teozeng-playground', version: '1.0.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(new URL(url))
    await c.connect(transport)
    client = c
    connectedUrl = url
    const { tools } = await c.listTools()
    return (tools ?? []).map(t => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t as any).inputSchema ?? {},
    }))
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!client) throw new Error('Not connected to an MCP server.')
    const result: any = await client.callTool({ name, arguments: args })
    const content = Array.isArray(result?.content) ? result.content : []
    const text = content.map((part: any) => (part?.type === 'text' ? part.text : JSON.stringify(part))).join('\n')
    return text || '(no content returned)'
}

export async function disconnectMcp(): Promise<void> {
    const c = client
    client = null
    connectedUrl = null
    try {
        await c?.close()
    } catch {
        /* best-effort */
    }
}
