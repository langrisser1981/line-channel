# Reply Timing Design

**Date:** 2026-03-25
**Status:** Approved

## Problem

The current webhook handler has two issues:

1. **Timeout risk**: The HTTP handler `await`s all event processing before returning 200 OK to LINE Server. If Claude takes longer than LINE's timeout window, LINE Server retries the webhook, causing duplicate events.

2. **Reply API unused**: The `reply` tool always uses Push API. LINE's Reply API is more appropriate for fast responses (< 30s), and requires the `replyToken` from the original webhook event.

## Design

### 1. Immediate 200 Response (`webhook.ts`)

Return 200 OK immediately after signature verification and JSON parsing. Event processing runs as a fire-and-forget background task.

```
Request arrives
  → verify signature (fail fast with 401)
  → parse JSON (fail fast with 400)
  → fire processEvents() without await
  → return 200 OK immediately
```

### 2. Reply Token State (`index.ts`)

A module-level variable holds the pending reply token:

```ts
let pendingReply: { token: string; at: number } | null = null
```

Lifecycle:
- Set when webhook receives a message event (via `onMessage` callback)
- Consumed (and cleared) when `reply` tool is called
- Decision: if `Date.now() - at < 30_000` → Reply API, else → Push API

### 3. Token Passing via Callback

`startWebhookServer` gains an `onMessage` callback parameter:

```ts
onMessage: (replyToken: string) => void
```

`webhook.ts` calls this when a valid message event is processed. This keeps `webhook.ts` decoupled from reply-routing logic.

### 4. Reply API (`line-client.ts`)

New `replyMessage` function:

```ts
POST https://api.line.me/v2/bot/message/reply
Body: { replyToken: string, messages: [{ type: 'text', text: string }] }
```

Reply tokens expire after 30 seconds (LINE platform constraint). Using an expired token returns a 400 error — this is handled by falling back to Push API.

## Files Changed

| File | Change |
|------|--------|
| `src/webhook.ts` | Fire-and-forget processing; add `onMessage` callback to signature; add `replyToken` to `LineEvent` |
| `src/line-client.ts` | Add `replyMessage(accessToken, replyToken, text)` |
| `src/index.ts` | Add `pendingReply` state; update `reply` tool to choose API based on elapsed time; pass `onMessage` callback to `startWebhookServer` |

## Error Handling

- If Reply API fails (expired token, LINE error): fall back to Push API and log warning
- Background processing errors are caught and logged; they do not affect the 200 response already sent

## Out of Scope

- Multi-user support (this is a single-user personal assistant)
- Queuing multiple pending tokens (latest token wins)
