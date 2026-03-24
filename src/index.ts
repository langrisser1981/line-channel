#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { pushMessage } from './line-client'
import { startWebhookServer } from './webhook'

// --- Env var validation -------------------------------------------------------
function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) {
    console.error(`[line-channel] Missing required env var: ${name}`)
    process.exit(1)
  }
  return val
}

const ACCESS_TOKEN = requireEnv('LINE_CHANNEL_ACCESS_TOKEN')
const CHANNEL_SECRET = requireEnv('LINE_CHANNEL_SECRET')
const USER_ID = requireEnv('LINE_USER_ID')
const PORT = parseInt(process.env.LINE_WEBHOOK_PORT ?? '3000', 10)

// --- MCP Server ---------------------------------------------------------------
const mcp = new Server(
  { name: 'line-channel', version: '1.0.0' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
      tools: {},
    },
    instructions: [
      'Messages from LINE arrive as <channel source="line-channel" user_id="...">.',
      'To reply to the user, call the reply tool with your response text.',
      'This is a personal assistant — treat all messages as coming from the owner.',
    ].join(' '),
  },
)

// --- reply tool ---------------------------------------------------------------
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message to the LINE user via Push API',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Message text to send' },
        },
        required: ['text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'reply') {
    throw new Error(`Unknown tool: ${req.params.name}`)
  }
  const { text } = req.params.arguments as { text: string }
  try {
    await pushMessage(ACCESS_TOKEN, USER_ID, text)
  } catch (err) {
    console.error('[line-channel] Push API error:', err)
  }
  return { content: [{ type: 'text', text: 'sent' }] }
})

// --- permission relay ---------------------------------------------------------
const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  const message = [
    `Claude wants to run ${params.tool_name}:`,
    params.description,
    '',
    `Reply: yes ${params.request_id}  or  no ${params.request_id}`,
  ].join('\n')
  try {
    await pushMessage(ACCESS_TOKEN, USER_ID, message)
  } catch (err) {
    console.error('[line-channel] Failed to push permission prompt:', err)
  }
})

// --- startup ------------------------------------------------------------------
await mcp.connect(new StdioServerTransport())
startWebhookServer(mcp, { channelSecret: CHANNEL_SECRET, allowedUserId: USER_ID }, PORT)
await detectNgrok(PORT)

async function detectNgrok(port: number): Promise<void> {
  const prefix = '[line-channel]'
  console.error(`${prefix} Webhook port: ${port}`)

  try {
    const res = await fetch('http://localhost:4040/api/tunnels', { signal: AbortSignal.timeout(2000) })
    if (!res.ok) throw new Error(`status ${res.status}`)

    const data = await res.json() as { tunnels?: { public_url: string }[] }
    const tunnel = data.tunnels?.find((t) => t.public_url.startsWith('https://'))
    if (!tunnel) {
      console.error(`${prefix} ngrok is running but no active tunnel found`)
      printManualInstructions(prefix, port)
      return
    }

    const webhookUrl = `${tunnel.public_url}/webhook`
    console.error(`${prefix} Webhook URL: ${webhookUrl}`)
    await copyToClipboard(webhookUrl, prefix)
  } catch {
    printManualInstructions(prefix, port)
  }
}

async function copyToClipboard(text: string, prefix: string): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error(`${prefix} Paste this URL into LINE Developers Console > Webhook URL`)
    return
  }
  try {
    const proc = Bun.spawn(['pbcopy'], { stdin: 'pipe' })
    proc.stdin.write(text)
    proc.stdin.end()
    await proc.exited
    console.error(`${prefix} URL copied to clipboard. Paste into LINE Developers Console > Webhook URL`)
  } catch {
    console.error(`${prefix} Paste this URL into LINE Developers Console > Webhook URL`)
  }
}

function printManualInstructions(prefix: string, port: number): void {
  console.error(`${prefix} ngrok not detected. Start it with:`)
  console.error(`${prefix}   ngrok http ${port}`)
  console.error(`${prefix} Then paste the HTTPS URL + /webhook into LINE Developers Console`)
}
