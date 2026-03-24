import { verifySignature } from './line-client'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

// Canonical regex for permission verdict replies.
// Accepts: "yes abcde", "y abcde", "no abcde", "n abcde"
// with optional leading/trailing whitespace. ID alphabet: a-z minus l.
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

export interface WebhookConfig {
  channelSecret: string
  allowedUserId: string
}

export interface WebhookServer {
  stop(): void
}

export function startWebhookServer(
  mcp: Pick<Server, 'notification'>,
  config: WebhookConfig,
  port: number,
): WebhookServer {
  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method !== 'POST' || url.pathname !== '/webhook') {
        return new Response('not found', { status: 404 })
      }

      const body = await req.text()
      const signature = req.headers.get('x-line-signature') ?? ''

      if (!verifySignature(body, signature, config.channelSecret)) {
        console.warn('[line-channel] Invalid signature — rejected')
        return new Response('unauthorized', { status: 401 })
      }

      let payload: { events?: LineEvent[] }
      try {
        payload = JSON.parse(body)
      } catch {
        return new Response('bad request', { status: 400 })
      }

      for (const event of payload.events ?? []) {
        await handleEvent(event, mcp, config.allowedUserId)
      }

      return new Response('ok')
    },
  })
  return { stop: () => server.stop() }
}

async function handleEvent(
  event: LineEvent,
  mcp: Pick<Server, 'notification'>,
  allowedUserId: string,
): Promise<void> {
  if (event.type !== 'message' || event.message?.type !== 'text') return

  const userId = event.source?.userId ?? ''
  if (userId !== allowedUserId) return // silent drop

  const text = event.message.text

  const match = PERMISSION_REPLY_RE.exec(text)
  if (match) {
    await mcp.notification({
      method: 'notifications/claude/channel/permission',
      params: {
        request_id: match[2].toLowerCase(),
        behavior: match[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
      },
    })
    return
  }

  await mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: text,
      meta: { user_id: userId },
    },
  })
}

// LINE event types (minimal — only what we need)
interface LineEvent {
  type: string
  source?: { userId?: string }
  message?: { type: string; text: string }
}
