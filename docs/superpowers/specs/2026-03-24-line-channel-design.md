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
│   └── webhook.ts        # HTTP server: receive LINE events, route to MCP notifications
├── .mcp.json             # Claude Code MCP server registration
├── .env.example          # Required environment variables template
├── package.json
└── README.md
```

### Component responsibilities

| File | Responsibility | Does NOT |
|---|---|---|
| `index.ts` | MCP Server setup, tool registration, stdio connection | Handle HTTP directly |
| `line-client.ts` | Call LINE API, verify X-Line-Signature | Know about MCP |
| `webhook.ts` | Receive LINE webhook events, gate sender, route to MCP | Call LINE API directly |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | Authenticate LINE API calls (reply + push) |
| `LINE_CHANNEL_SECRET` | Verify incoming webhook signature |
| `LINE_USER_ID` | Your LINE user ID — allowlist and push target |
| `LINE_WEBHOOK_PORT` | Local HTTP port (default: `3000`) |

All four are required at startup. Missing variables cause an immediate exit with a clear error message.

---

## Data Flow

### Inbound (LINE to Claude Code)

```
User sends LINE message
  → LINE Servers
  → ngrok HTTPS tunnel
  → POST /webhook (webhook.ts)
      → Verify X-Line-Signature (line-client.ts)
      → Check sender === LINE_USER_ID (drop if not)
      → Classify message:
          ┌─ matches /^(yes|no) [a-km-z]{5}$/i
          │   → mcp.notification("notifications/claude/channel/permission")
          └─ regular text
              → mcp.notification("notifications/claude/channel")
                content: message text
                meta: { reply_token, user_id }
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
Claude Code needs tool approval
  → notifications/claude/channel/permission_request
  → index.ts PermissionRequestSchema handler
  → line-client.ts pushMessage(LINE_USER_ID, prompt)
    "Claude wants to run Bash: rm -rf old_build/
     Reply: yes abcde or no abcde"
  → User replies in LINE
  → webhook.ts intercepts → emits permission verdict
  → Claude Code applies verdict
```

**Key distinction:**
- Reply API: for responding to user messages (requires `reply_token`, valid ~1 min)
- Push API: for permission relay prompts (proactive, requires `LINE_USER_ID`)

---

## MCP Server Capabilities

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
2. **Sender allowlist** — Only messages from `LINE_USER_ID` are forwarded to Claude. All others are silently dropped (HTTP 200 returned to LINE to avoid retries).
3. **Permission reply format** — Strict regex `/^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i` prevents accidental verdict triggers. The ID alphabet (`a-z` minus `l`) matches what Claude Code generates.

---

## Error Handling

| Situation | Behavior |
|---|---|
| ngrok not running at startup | Print warning + instructions; server starts normally |
| LINE Reply API call fails | Log error; do not crash MCP server |
| `reply_token` expired | Catch error; push a "reply timed out" message via Push API |
| Missing env variable | Exit immediately with message: `Missing required env var: <NAME>` |
| Invalid webhook signature | Return HTTP 401; log warning |

---

## ngrok URL Detection

On startup, the server queries `http://localhost:4040/api/tunnels` to auto-detect the active ngrok tunnel. If found, it prints:

```
[line-channel] Webhook port: 3000
[line-channel] Webhook URL: https://xxxx.ngrok-free.app/webhook
[line-channel] Paste this URL into LINE Developers Console > Webhook URL
```

If ngrok is not running, it prints a manual instruction instead.

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
        "LINE_WEBHOOK_PORT": "3000"
      }
    }
  }
}
```

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
