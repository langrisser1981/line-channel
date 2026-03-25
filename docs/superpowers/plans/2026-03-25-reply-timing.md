# Reply Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return HTTP 200 immediately to LINE Server and use Reply API for fast responses (< 27s), Push API otherwise.

**Architecture:** Three focused changes — add `replyMessage` to line-client, update webhook to fire-and-forget with an `onMessage` callback, and update the reply tool in index.ts to pick the right API based on elapsed time.

**Tech Stack:** TypeScript, Bun runtime, bun:test, LINE Messaging API

**Spec:** `docs/superpowers/specs/2026-03-25-reply-timing-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/line-client.ts` | Add `replyMessage(accessToken, replyToken, text)` |
| `src/webhook.ts` | Fire-and-forget processing; add `onMessage` callback param; add `replyToken` to `LineEvent` |
| `src/__tests__/webhook.test.ts` | Pass `onMessage` to `startWebhookServer`; add sleep after requests; add callback tests |
| `src/__tests__/line-client.test.ts` | Add `replyMessage` tests using fetch spy |
| `src/index.ts` | Add `pendingReply` state; update `reply` tool to choose API; update tool description |

---

## Task 1: Add `replyMessage` to line-client.ts

**Files:**
- Modify: `src/line-client.ts`
- Test: `src/__tests__/line-client.test.ts`

- [ ] **Step 1: Write the failing tests for `replyMessage`**

In `src/__tests__/line-client.test.ts`:
1. Replace the existing import lines at the top with the ones below (adds `spyOn`, `beforeEach`, `afterEach`, and `replyMessage`)
2. Append the `describe('replyMessage', ...)` block below the existing `verifySignature` tests — do not remove them

Replace the top two import lines with:

```ts
import { describe, expect, spyOn, test, beforeEach, afterEach } from 'bun:test'
import { createHmac } from 'crypto'
import { verifySignature, replyMessage } from '../line-client'
```

Then append below the existing tests:

```ts
describe('replyMessage', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('calls LINE Reply API with correct payload', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 200 }))

    await replyMessage('token123', 'replyTok456', 'hello')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.line.me/v2/bot/message/reply')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      replyToken: 'replyTok456',
      messages: [{ type: 'text', text: 'hello' }],
    })
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer token123')
  })

  test('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValue(new Response('Bad Request', { status: 400 }))

    await expect(replyMessage('token123', 'expiredToken', 'hi')).rejects.toThrow('LINE Reply API error 400')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/lenny.cheng/Documents/line-channel
bun test src/__tests__/line-client.test.ts
```

Expected: FAIL — `replyMessage is not exported`

- [ ] **Step 3: Implement `replyMessage` in `src/line-client.ts`**

Add after `pushMessage`:

```ts
export async function replyMessage(
  accessToken: string,
  replyToken: string,
  text: string,
): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`LINE Reply API error ${res.status}: ${detail}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/__tests__/line-client.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/line-client.ts src/__tests__/line-client.test.ts
git commit -m "feat: add replyMessage to line-client"
```

---

## Task 2: Update `webhook.ts` — fire-and-forget + onMessage callback

**Files:**
- Modify: `src/webhook.ts`
- Test: `src/__tests__/webhook.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire `src/__tests__/webhook.test.ts` content:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHmac } from 'crypto'
import { startWebhookServer } from '../webhook'
import type { WebhookServer } from '../webhook'

const SECRET = 'test-secret'
const USER_ID = 'Uabc123'
const PORT = 19999

function makeSignature(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64')
}

async function postWebhook(body: string, overrides: Record<string, string> = {}) {
  const sig = overrides['x-line-signature'] ?? makeSignature(body)
  return fetch(`http://localhost:${PORT}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': sig, ...overrides },
    body,
  })
}

describe('webhook routing', () => {
  let notifications: unknown[] = []
  let onMessageTokens: string[] = []

  const notificationMock = mock((n: unknown) => {
    notifications.push(n)
    return Promise.resolve()
  })
  const mockMcp = { notification: notificationMock }
  let server: WebhookServer

  beforeAll(() => {
    server = startWebhookServer(
      mockMcp as any,
      { channelSecret: SECRET, allowedUserId: USER_ID },
      PORT,
      (token) => { onMessageTokens.push(token) },
    )
  })

  afterAll(() => {
    server.stop()
  })

  beforeEach(() => {
    notifications = []
    onMessageTokens = []
    notificationMock.mockReset()
    notificationMock.mockImplementation((n: unknown) => {
      notifications.push(n)
      return Promise.resolve()
    })
  })

  test('invalid signature returns 401', async () => {
    const body = JSON.stringify({ events: [] })
    const res = await postWebhook(body, { 'x-line-signature': 'bad-sig' })
    expect(res.status).toBe(401)
    expect(notifications).toHaveLength(0)
  })

  test('returns 200 immediately before processing completes', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', replyToken: 'tok1', source: { userId: USER_ID }, message: { type: 'text', text: 'hi' } }],
    })
    const res = await postWebhook(body)
    // 200 arrives before background processing — notifications may or may not be populated yet
    expect(res.status).toBe(200)
  })

  test('unknown sender is silently dropped (200)', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', replyToken: 'tok1', source: { userId: 'Ustranger' }, message: { type: 'text', text: 'hi' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    await Bun.sleep(50)
    expect(notifications).toHaveLength(0)
    expect(onMessageTokens).toHaveLength(0)
  })

  test('regular text message forwards notification and calls onMessage with replyToken', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', replyToken: 'myToken123', source: { userId: USER_ID }, message: { type: 'text', text: 'hello claude' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    await Bun.sleep(50)
    expect(notifications).toHaveLength(1)
    const n = notifications[0] as any
    expect(n.method).toBe('notifications/claude/channel')
    expect(n.params.content).toBe('hello claude')
    expect(onMessageTokens).toEqual(['myToken123'])
  })

  test('permission verdict calls onMessage — NOT called (permission path)', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', replyToken: 'permTok', source: { userId: USER_ID }, message: { type: 'text', text: 'yes abcde' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    await Bun.sleep(50)
    expect(notifications).toHaveLength(1)
    const n = notifications[0] as any
    expect(n.method).toBe('notifications/claude/channel/permission')
    // onMessage must NOT be called for permission replies
    expect(onMessageTokens).toHaveLength(0)
  })

  test('permission verdict "n abcde" emits deny', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', replyToken: 'permTok2', source: { userId: USER_ID }, message: { type: 'text', text: 'n abcde' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    await Bun.sleep(50)
    const n = notifications[0] as any
    expect(n.params.behavior).toBe('deny')
    expect(onMessageTokens).toHaveLength(0)
  })

  test('non-message events are ignored', async () => {
    const body = JSON.stringify({
      events: [{ type: 'follow', source: { userId: USER_ID } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    await Bun.sleep(50)
    expect(notifications).toHaveLength(0)
    expect(onMessageTokens).toHaveLength(0)
  })

  test('non-text messages are ignored', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', replyToken: 'imgTok', source: { userId: USER_ID }, message: { type: 'image', id: '123' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    await Bun.sleep(50)
    expect(notifications).toHaveLength(0)
    expect(onMessageTokens).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/__tests__/webhook.test.ts
```

Expected: FAIL — `startWebhookServer` doesn't accept `onMessage` param

- [ ] **Step 3: Update `src/webhook.ts`**

Replace the entire file:

```ts
import { verifySignature } from './line-client'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

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
        console.warn('[line-channel] Invalid signature — rejected')
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
        console.error('[line-channel] Error processing event:', err)
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
    console.error(`[line-channel] Message from unknown userId: ${userId} (update LINE_USER_ID in .env)`)
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/__tests__/webhook.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/webhook.ts src/__tests__/webhook.test.ts
git commit -m "feat: fire-and-forget webhook response with onMessage callback"
```

---

## Task 3: Update `index.ts` — pendingReply state and smart reply tool

**Files:**
- Modify: `src/index.ts`

> Note: `index.ts` is the MCP entry point and is not directly unit-testable. Verify manually by running the server.

- [ ] **Step 1: Update imports in `src/index.ts`**

Find line 6 (current content: `import { pushMessage } from './line-client'`) and replace it:

```ts
// Before:
import { pushMessage } from './line-client'

// After:
import { pushMessage, replyMessage } from './line-client'
```

- [ ] **Step 2: Add `pendingReply` state below the env var section**

Find line 22 (current content: `const PORT = parseInt(process.env.LINE_WEBHOOK_PORT ?? '3000', 10)`) and insert after it:

```ts
const PORT = parseInt(process.env.LINE_WEBHOOK_PORT ?? '3000', 10)

// Tracks the replyToken from the most recent incoming LINE message.
// Consumed by the reply tool to decide between Reply API and Push API.
let pendingReply: { token: string; at: number } | null = null

// --- MCP Server ---
```

(The `// --- MCP Server ---` comment is already there on line 24 — do not duplicate it, use it as an anchor to confirm the insertion point.)

- [ ] **Step 3: Update `startWebhookServer` call to pass `onMessage` callback**

Replace the startup line:

```ts
// Before:
startWebhookServer(mcp, { channelSecret: CHANNEL_SECRET, allowedUserId: USER_ID }, PORT)

// After:
startWebhookServer(
  mcp,
  { channelSecret: CHANNEL_SECRET, allowedUserId: USER_ID },
  PORT,
  (token) => { pendingReply = { token, at: Date.now() } },
)
```

- [ ] **Step 4: Update the `reply` tool description**

In `ListToolsRequestSchema` handler, change the description:

```ts
// Before:
description: 'Send a message to the LINE user via Push API',

// After:
description: 'Send a message to the LINE user via Reply API or Push API depending on response time',
```

- [ ] **Step 5: Update the reply tool handler with timing logic**

Replace the `CallToolRequestSchema` handler body:

```ts
mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'reply') {
    throw new Error(`Unknown tool: ${req.params.name}`)
  }
  const { text } = req.params.arguments as { text: string }

  const pending = pendingReply
  pendingReply = null // consume immediately

  if (pending && Date.now() - pending.at < 27_000) {
    // Fast response: use Reply API
    try {
      await replyMessage(ACCESS_TOKEN, pending.token, text)
      return { content: [{ type: 'text', text: 'sent' }] }
    } catch (err) {
      console.error('[line-channel] Reply API failed, falling back to Push API:', err)
      // Fall through to Push API
    }
  }

  // Slow response or Reply API failure: use Push API
  try {
    await pushMessage(ACCESS_TOKEN, USER_ID, text)
  } catch (err) {
    console.error('[line-channel] Push API error:', err)
  }
  return { content: [{ type: 'text', text: 'sent' }] }
})
```

- [ ] **Step 6: Run all tests to confirm nothing is broken**

```bash
bun test
```

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: use Reply API for fast responses, Push API as fallback"
```

---

## Final Verification

- [ ] Start the server: `bun run src/index.ts`
- [ ] Send a LINE message and verify Claude replies (fast path → Reply API)
- [ ] All tests still pass: `bun test`
