# LINE Channel Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code Channel MCP server that bridges LINE Messaging API for personal assistant use, with bidirectional chat and permission relay.

**Architecture:** Three focused source files — `line-client.ts` (pure LINE API calls), `webhook.ts` (HTTP server + routing), `index.ts` (MCP server wiring). Tests cover pure logic only; LINE API and MCP stdio are not mocked end-to-end.

**Tech Stack:** Bun 1.x, TypeScript, `@modelcontextprotocol/sdk`, `zod`, Bun built-in test runner (`bun test`), LINE Messaging API (Push + Webhook)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `package.json` | Create | Bun project + dependencies |
| `.gitignore` | Create | Ignore node_modules, .env |
| `.env.example` | Create | Env vars template |
| `src/line-client.ts` | Create | `verifySignature`, `pushMessage` |
| `src/webhook.ts` | Create | `startWebhookServer` — HTTP server + routing |
| `src/index.ts` | Create | MCP Server, tool handlers, startup |
| `src/__tests__/line-client.test.ts` | Create | Unit tests for `verifySignature` |
| `src/__tests__/webhook.test.ts` | Create | Unit tests for webhook routing |
| `.mcp.json` | Create | Claude Code MCP server registration |
| `README.md` | Create | Setup and usage guide |

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "line-channel",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.15.0",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/lenny.cheng/Documents/line-channel
bun install
```

Expected: `node_modules/@modelcontextprotocol` and `node_modules/zod` created, `bun.lockb` generated.

- [ ] **Step 3: Create .gitignore**

```
node_modules/
.env
bun.lockb
```

- [ ] **Step 4: Create .env.example**

```
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token_here
LINE_CHANNEL_SECRET=your_channel_secret_here
LINE_USER_ID=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LINE_WEBHOOK_PORT=3000
```

- [ ] **Step 5: Commit**

```bash
cd /Users/lenny.cheng/Documents/line-channel
git add package.json .gitignore .env.example bun.lockb
git commit -m "chore: project scaffolding and dependencies"
```

---

## Task 2: line-client.ts — verifySignature (TDD)

**Files:**
- Create: `src/line-client.ts`
- Create: `src/__tests__/line-client.test.ts`

LINE signature verification: compute HMAC-SHA256 of the raw request body string using the channel secret, base64-encode it, and compare against the `X-Line-Signature` header value.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/line-client.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { createHmac } from 'crypto'
import { verifySignature } from '../line-client'

const SECRET = 'test-secret'
const BODY = '{"events":[],"destination":"Udeadbeef"}'

function makeSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

describe('verifySignature', () => {
  test('returns true for valid signature', () => {
    const sig = makeSignature(BODY, SECRET)
    expect(verifySignature(BODY, sig, SECRET)).toBe(true)
  })

  test('returns false for wrong secret', () => {
    const sig = makeSignature(BODY, 'wrong-secret')
    expect(verifySignature(BODY, sig, SECRET)).toBe(false)
  })

  test('returns false for tampered body', () => {
    const sig = makeSignature(BODY, SECRET)
    expect(verifySignature(BODY + 'x', sig, SECRET)).toBe(false)
  })

  test('returns false for empty signature', () => {
    expect(verifySignature(BODY, '', SECRET)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/lenny.cheng/Documents/line-channel
bun test src/__tests__/line-client.test.ts
```

Expected: error — `Cannot find module '../line-client'`

- [ ] **Step 3: Implement line-client.ts with verifySignature**

Create `src/line-client.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto'

// Verifies the X-Line-Signature header against the raw request body.
// Uses HMAC-SHA256 with the channel secret, base64-encoded.
// Uses timing-safe comparison to prevent timing attacks.
export function verifySignature(body: string, signature: string, secret: string): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(body).digest('base64')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false
  }
}

export async function pushMessage(
  accessToken: string,
  userId: string,
  text: string,
): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`LINE Push API error ${res.status}: ${detail}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/__tests__/line-client.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/line-client.ts src/__tests__/line-client.test.ts
git commit -m "feat: add line-client with verifySignature and pushMessage"
```

---

## Task 3: webhook.ts — routing logic (TDD)

**Files:**
- Create: `src/webhook.ts`
- Create: `src/__tests__/webhook.test.ts`

`webhook.ts` exports `startWebhookServer(mcp, config, port)`. Tests use a mock `mcp` object to verify correct notifications are emitted for each input scenario.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/webhook.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHmac } from 'crypto'
import { startWebhookServer } from '../webhook'
import type { WebhookServer } from '../webhook'

const SECRET = 'test-secret'
const USER_ID = 'Uabc123'
const PORT = 19999 // use a high port to avoid conflicts in tests

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
  let notifications: unknown[]
  const notificationMock = mock((n: unknown) => {
    notifications.push(n)
    return Promise.resolve()
  })
  const mockMcp = { notification: notificationMock }
  let server: WebhookServer

  // Start server once — Bun.serve throws if the port is already bound,
  // so we must not call startWebhookServer in beforeEach.
  beforeAll(() => {
    server = startWebhookServer(mockMcp as any, { channelSecret: SECRET, allowedUserId: USER_ID }, PORT)
  })

  afterAll(() => {
    server.stop()
  })

  beforeEach(() => {
    notifications = []
    notificationMock.mockReset()
    // Re-attach accumulator after reset
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

  test('unknown sender is silently dropped (200)', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', source: { userId: 'Ustranger' }, message: { type: 'text', text: 'hi' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    expect(notifications).toHaveLength(0)
  })

  test('regular text message forwards as channel notification', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', source: { userId: USER_ID }, message: { type: 'text', text: 'hello claude' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    expect(notifications).toHaveLength(1)
    const n = notifications[0] as any
    expect(n.method).toBe('notifications/claude/channel')
    expect(n.params.content).toBe('hello claude')
    expect(n.params.meta.user_id).toBe(USER_ID)
  })

  test('permission verdict "yes abcde" emits permission notification', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', source: { userId: USER_ID }, message: { type: 'text', text: 'yes abcde' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    expect(notifications).toHaveLength(1)
    const n = notifications[0] as any
    expect(n.method).toBe('notifications/claude/channel/permission')
    expect(n.params.request_id).toBe('abcde')
    expect(n.params.behavior).toBe('allow')
  })

  test('permission verdict "n abcde" emits deny', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', source: { userId: USER_ID }, message: { type: 'text', text: 'n abcde' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    const n = notifications[0] as any
    expect(n.params.behavior).toBe('deny')
  })

  test('non-message events are ignored (no notification)', async () => {
    const body = JSON.stringify({
      events: [{ type: 'follow', source: { userId: USER_ID } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    expect(notifications).toHaveLength(0)
  })

  test('non-text messages (image, sticker) are ignored', async () => {
    const body = JSON.stringify({
      events: [{ type: 'message', source: { userId: USER_ID }, message: { type: 'image', id: '123' } }],
    })
    const res = await postWebhook(body)
    expect(res.status).toBe(200)
    expect(notifications).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/__tests__/webhook.test.ts
```

Expected: error — `Cannot find module '../webhook'`

- [ ] **Step 3: Implement webhook.ts**

Create `src/webhook.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/__tests__/webhook.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/webhook.ts src/__tests__/webhook.test.ts
git commit -m "feat: add webhook server with routing and sender gating"
```

---

## Task 4: index.ts — MCP Server entry point

**Files:**
- Create: `src/index.ts`

No automated tests for this file — it wires together stdio transport (not unit-testable) and is validated by running the server. Correctness is verified in Task 6.

- [ ] **Step 1: Implement index.ts**

Create `src/index.ts`:

```typescript
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
```

- [ ] **Step 2: Run all tests to confirm nothing is broken**

```bash
cd /Users/lenny.cheng/Documents/line-channel
bun test
```

Expected: all tests from Tasks 2 and 3 pass.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add MCP server entry point with reply tool and permission relay"
```

---

## Task 5: Config files (.mcp.json, README.md)

**Files:**
- Create: `.mcp.json`
- Create: `README.md`

- [ ] **Step 1: Create .mcp.json**

```json
{
  "mcpServers": {
    "line-channel": {
      "command": "bun",
      "args": ["./src/index.ts"],
      "env": {
        "LINE_CHANNEL_ACCESS_TOKEN": "${LINE_CHANNEL_ACCESS_TOKEN}",
        "LINE_CHANNEL_SECRET": "${LINE_CHANNEL_SECRET}",
        "LINE_USER_ID": "${LINE_USER_ID}",
        "LINE_WEBHOOK_PORT": "${LINE_WEBHOOK_PORT}"
      }
    }
  }
}
```

- [ ] **Step 2: Create README.md**

```markdown
# line-channel

A Claude Code Channel plugin that lets you chat with Claude from LINE.

## Prerequisites

- [Bun](https://bun.sh) 1.x
- [ngrok](https://ngrok.com) (free tier works)
- A LINE Messaging API channel ([create one](https://developers.line.biz/en/docs/messaging-api/getting-started/))
- Claude Code v2.1.80 or later with a claude.ai login

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Where to find it |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console > Channel > Messaging API > Channel access token |
| `LINE_CHANNEL_SECRET` | LINE Developers Console > Channel > Basic settings > Channel secret |
| `LINE_USER_ID` | LINE Developers Console > Channel > Messaging API > Your user ID |
| `LINE_WEBHOOK_PORT` | Local port (default: 3000) |

### 3. Start ngrok

```bash
ngrok http 3000
```

### 4. Start Claude Code with this channel

Load your `.env` first, then start with the development flag:

```bash
export $(cat .env | xargs)
claude --dangerously-load-development-channels server:line-channel
```

On startup, the plugin prints the ngrok webhook URL and copies it to your clipboard.

### 5. Paste the webhook URL into LINE Developers Console

LINE Developers Console > Channel > Messaging API > Webhook URL

Format: `https://xxxx.ngrok-free.app/webhook`

Enable "Use webhook" toggle.

## Usage

- Send any text message to your LINE bot → Claude receives it and replies
- When Claude needs tool approval, you receive a LINE message:
  ```
  Claude wants to run Bash: ls -la
  Reply: yes abcde  or  no abcde
  ```
  Reply with `yes abcde` or `no abcde` to approve or deny.

## Running tests

```bash
bun test
```
```

- [ ] **Step 3: Commit**

```bash
git add .mcp.json README.md
git commit -m "chore: add .mcp.json and README"
```

---

## Task 6: End-to-end smoke test

This task has no automated tests — it verifies the server starts and communicates with Claude Code.

- [ ] **Step 1: Copy .env.example and fill in real values**

```bash
cd /Users/lenny.cheng/Documents/line-channel
cp .env.example .env
# Edit .env with your LINE credentials
```

- [ ] **Step 2: Start ngrok in a separate terminal**

```bash
ngrok http 3000
```

- [ ] **Step 3: Start Claude Code with the channel**

```bash
export $(cat .env | xargs)
claude --dangerously-load-development-channels server:line-channel
```

Expected startup output:
```
[line-channel] Webhook port: 3000
[line-channel] Webhook URL: https://xxxx.ngrok-free.app/webhook
[line-channel] URL copied to clipboard. Paste into LINE Developers Console > Webhook URL
```

- [ ] **Step 4: Paste webhook URL into LINE Console**

Go to LINE Developers Console > your channel > Messaging API tab > Webhook URL.
Paste the URL (already in clipboard), click Verify.
Expected: "Success"

- [ ] **Step 5: Send a test message from LINE**

Open LINE, find your bot, send: `hello`

Expected: Claude replies within a few seconds.

- [ ] **Step 6: Test permission relay**

Send a message that will trigger a tool call, e.g.: `list the files in this directory`

When the local terminal shows a permission dialog, you should also receive a LINE message with the approval prompt. Reply with `yes <id>` from LINE.

Expected: Claude Code proceeds with the tool call.

- [ ] **Step 7: Final commit tag**

```bash
cd /Users/lenny.cheng/Documents/line-channel
git tag v1.0.0
```

---

## Git Remote Setup (upload to git)

After completing all tasks, push to a remote repository.

- [ ] **Step 1: Create a new repository** on your Git hosting (GitHub, GitLab, etc.)

- [ ] **Step 2: Add remote and push**

```bash
cd /Users/lenny.cheng/Documents/line-channel
git remote add origin <your-repo-url>
git push -u origin master
```
