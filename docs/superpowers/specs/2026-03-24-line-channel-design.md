# LINE Channel Plugin for Claude Code — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Author:** lenny.cheng

---

## Overview

A Claude Code Channel plugin that bridges LINE Messaging API with a Claude Code session. The user can chat with Claude from LINE, and Claude can reply back. Permission relay is supported so tool approvals can be granted or denied remotely from LINE.

---

## Requirements

- **Personal use only** — single allowed sender (the owner's LINE user ID)
- **Bidirectional chat** — user sends messages from LINE, Claude replies via LINE
- **Permission relay** — Claude Code forwards tool-use approval prompts to LINE; user responds `yes/no <id>`
- **ngrok** for local HTTPS exposure (free tier; URL changes on each restart)
- **Runtime:** Bun + TypeScript

---

## Architecture

```
line-channel/
├── src/
│   ├── index.ts          # MCP Server: capabilities, reply tool, permission relay handler
│   ├── line-client.ts    # LINE API wrapper: replyMessage, pushMessage, verifySignature
│   └── webhook.ts        # HTTP server: receive LINE events, produce HTTP responses, route to MCP notifications
├── .mcp.json             # Claude Code MCP server registration
├── .env.example          # Required environment variables template
├── package.json
└── README.md
```

### Component responsibilities

| File | Responsibility | Does NOT |
|---|---|---|
| `index.ts` | MCP Server setup, tool registration, stdio connection | Handle HTTP directly |
| `line-client.ts` | Call LINE API (reply/push), verify X-Line-Signature | Know about MCP |
| `webhook.ts` | Receive LINE webhook events, produce HTTP responses (200/401), gate sender, route to MCP | Call LINE API directly |

`webhook.ts` owns the full HTTP request/response lifecycle. It emits MCP notifications but does not call LINE API. All LINE API calls go through `line-client.ts`.

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | Authenticate LINE API calls (reply + push) |
| `LINE_CHANNEL_SECRET` | Verify incoming webhook signature |
| `LINE_USER_ID` | Your LINE user ID — allowlist and push target |
| `LINE_WEBHOOK_PORT` | Local HTTP port (default: `3000`) |

All four are required at startup. Missing variables cause an immediate exit with a clear error message: `Missing required env var: <NAME>`.

---

## Data Flow

### Permission Reply Regex (canonical)

All permission verdict matching uses this single regex, referenced in both the inbound classifier and security gating:

```
PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
```

- Accepts short forms `y`/`n` and full forms `yes`/`no`
- Allows leading/trailing whitespace (tolerates mobile keyboard autocorrect)
- ID alphabet is `a-z` minus `l` — matches what Claude Code generates

### Inbound (LINE to Claude Code)

```
User sends LINE message
  → LINE Servers
  → ngrok HTTPS tunnel
  → POST /webhook (webhook.ts)
      → Verify X-Line-Signature (line-client.ts) → 401 if invalid
      → Check sender === LINE_USER_ID → 200 + silent drop if not
      → Classify message text via PERMISSION_REPLY_RE:
          ┌─ matches (verdict format)
          │   → mcp.notification("notifications/claude/channel/permission")
          │     { request_id: m[2].toLowerCase(), behavior: 'allow'|'deny' }
          │   → return 200
          └─ does not match (regular text)
              → mcp.notification("notifications/claude/channel")
                content: message text
                meta: { reply_token, user_id }
              → return 200
```

### Outbound (Claude Code to LINE)

```
Claude calls reply tool({ reply_token, text })
  → index.ts CallToolRequestSchema handler
  → line-client.ts replyMessage(replyToken, text)
  → LINE Reply API → user's LINE
```

### Permission Relay

```
Claude Code needs tool approval (tool-use dialog opens)
  → notifications/claude/channel/permission_request { request_id, tool_name, description, input_preview }
  → index.ts PermissionRequestSchema handler
  → line-client.ts pushMessage(LINE_USER_ID,
      "Claude wants to run <tool_name>: <description>\nReply: yes <id> or no <id>")
  → User sees prompt in LINE and replies
  → webhook.ts classifies via PERMISSION_REPLY_RE → emits permission verdict
  → Claude Code applies verdict (local terminal dialog also stays open — first answer wins)
```

**Key distinction:**
- **Reply API**: respond to user messages (requires `reply_token`, valid ~1 min after user sends)
- **Push API**: proactive messages to user (permission relay prompts; no reply_token needed, uses `LINE_USER_ID`)

---

## MCP Server Capabilities

The capability keys use forward-slash strings inside `experimental`, exactly as specified in the Claude Code Channels reference (`capabilities.experimental['claude/channel']`). This is the correct format per the official SDK — the forward slashes are intentional namespacing, not a typo.

```typescript
capabilities: {
  experimental: {
    'claude/channel': {},            // registers channel notification listener
    'claude/channel/permission': {}, // opts in to permission relay
  },
  tools: {},                         // enables reply tool discovery
},
instructions: `
  Messages from LINE arrive as <channel source="line-channel" reply_token="..." user_id="...">.
  To reply, call the reply tool with the reply_token from the tag and your response text.
  This is a personal assistant — treat all messages as coming from the owner.
`
```

---

## reply Tool Schema

```typescript
{
  name: 'reply',
  description: 'Send a reply to the LINE user',
  inputSchema: {
    type: 'object',
    properties: {
      reply_token: { type: 'string', description: 'reply_token from the channel tag' },
      text: { type: 'string', description: 'Message text to send' },
    },
    required: ['reply_token', 'text'],
  },
}
```

---

## Security

1. **Signature verification** — Every webhook request verifies `X-Line-Signature` using HMAC-SHA256 with `LINE_CHANNEL_SECRET`. Requests with invalid or missing signatures return HTTP 401.
2. **Sender allowlist** — Only messages from `LINE_USER_ID` are forwarded to Claude. All others are silently dropped (HTTP 200 to avoid LINE retry loops). Gate on sender identity (`userId`), not group/room ID.
3. **Permission reply format** — Uses canonical `PERMISSION_REPLY_RE` (defined above). Text that does not match falls through as a regular chat message to Claude. Text that matches but carries an unknown ID is emitted as a verdict; Claude Code will silently drop it (no matching open request).

---

## Error Handling

| Situation | Behavior |
|---|---|
| ngrok not running at startup | Print warning + manual setup instructions; server starts normally |
| ngrok running but no active tunnel | Print warning: "ngrok is running but no tunnel found"; server starts normally |
| ngrok URL detection request timeout | 2-second timeout; on failure treat as "not running" |
| LINE Reply API call fails | Log error; do not crash MCP server |
| `reply_token` expired | Catch error; the original reply text is discarded (not retried); push "Sorry, reply timed out. Please resend your message." via Push API |
| Missing env variable | Exit immediately: `Missing required env var: <NAME>` |
| Invalid webhook signature | Return HTTP 401; log warning |

---

## ngrok URL Detection

On startup, the server queries `http://localhost:4040/api/tunnels` with a 2-second timeout:

- **Tunnel found:** print the public HTTPS URL
- **Running but no tunnel:** print warning: "ngrok is running but no active tunnel found"
- **Not running / timeout:** print manual setup instructions

```
[line-channel] Webhook port: 3000
[line-channel] Webhook URL: https://xxxx.ngrok-free.app/webhook
[line-channel] Paste this URL into LINE Developers Console > Webhook URL
```

---

## Concurrent Permission Requests

If Claude Code emits multiple `permission_request` notifications before the user has responded, each is pushed as a separate LINE message with its own ID. The user may answer them in any order; each verdict is matched by ID. There is no server-side queue — Claude Code manages the open-request lifecycle. Stale or unknown IDs are emitted as verdicts and silently dropped by Claude Code.

---

## Claude Code Registration (.mcp.json)

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

`LINE_WEBHOOK_PORT` defaults to `3000` in code if the variable is unset.

---

## Running During Research Preview

```bash
# Start with development channel bypass
claude --dangerously-load-development-channels server:line-channel
```

---

## Out of Scope (v1)

- Multi-user support
- Image / sticker / file message handling
- LINE group chat support
- Plugin marketplace publishing
- Automatic ngrok URL update via LINE API (not supported by LINE)
- Server-side queue for concurrent permission requests (handled by Claude Code's own lifecycle)
