import { verifySignature } from './line-client'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { log } from './logger'

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
  onMessage: (replyToken: string) => void = () => {},
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
        log('[line-channel] Invalid signature — rejected')
        return new Response('unauthorized', { status: 401 })
      }

      let payload: { events?: LineEvent[] }
      try {
        payload = JSON.parse(body)
      } catch {
        return new Response('bad request', { status: 400 })
      }

      // Fire-and-forget: return 200 before processing events
      processEvents(payload.events ?? [], mcp, config.allowedUserId, onMessage)
      return new Response('ok')
    },
  })
  return { stop: () => server.stop() }
}

function processEvents(
  events: LineEvent[],
  mcp: Pick<Server, 'notification'>,
  allowedUserId: string,
  onMessage: (replyToken: string) => void,
): void {
  ;(async () => {
    for (const event of events) {
      try {
        await handleEvent(event, mcp, allowedUserId, onMessage)
      } catch (err) {
        log(`[line-channel] Error processing event: ${err}`)
      }
    }
  })()
}

async function handleEvent(
  event: LineEvent,
  mcp: Pick<Server, 'notification'>,
  allowedUserId: string,
  onMessage: (replyToken: string) => void,
): Promise<void> {
  if (event.type !== 'message' || event.message?.type !== 'text') return

  const userId = event.source?.userId ?? ''
  if (userId !== allowedUserId) {
    log(`[line-channel] Message from unknown userId: ${userId} (update LINE_USER_ID in .env)`)
    return
  }

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

  // Regular message: store reply token before notifying Claude
  if (event.replyToken) {
    onMessage(event.replyToken)
  }

  await mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content: text,
      meta: { user_id: userId },
    },
  })
}

interface LineEvent {
  type: string
  replyToken?: string
  source?: { userId?: string }
  message?: { type: string; text: string }
}
