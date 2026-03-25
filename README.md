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
| `LINE_USER_ID` | See step below — start the server with a placeholder, send a message, read it from the log |
| `LINE_WEBHOOK_PORT` | Local port (default: 3000) |

**Finding your `LINE_USER_ID`:** Set it to any placeholder (e.g. `placeholder`) first, then complete the setup below. After sending your first message, the server log will print:

```
[line-channel] Message from unknown userId: Uxxxxxxxxxx (update LINE_USER_ID in .env)
```

Copy that ID into `.env` and restart.

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

On startup, the plugin prints the ngrok webhook URL and copies it to your clipboard (macOS).

### 5. Paste the webhook URL into LINE Developers Console

LINE Developers Console > Channel > Messaging API > Webhook URL

Format: `https://xxxx.ngrok-free.app/webhook`

Enable the "Use webhook" toggle, then click Verify.

## Usage

Send any text message to your LINE bot — Claude receives it and replies.

When Claude needs to run a tool that requires approval, you receive a LINE message:

```
Claude wants to run Bash: ls -la

Reply: yes abcde  or  no abcde
```

Reply with `yes abcde` or `no abcde` to approve or deny. The local terminal dialog also stays open — whichever answer arrives first is applied.

## Available MCP Tools

| Tool | Description |
|---|---|
| `reply` | Send a message to the LINE user (Reply API or Push API depending on response time) |
| `get_quota` | Query current month's push message quota and consumption |

### Checking push message quota

Ask Claude in natural language — for example: "查推播用量" or "check LINE quota".

Claude calls `get_quota` which queries two LINE API endpoints and returns:

```json
{
  "limit": 200,
  "type": "limited",
  "totalUsage": 43,
  "remaining": 157
}
```

> **Note:** Only push/broadcast/multicast messages count toward the quota. Reply API messages are free and not counted.

## Viewing logs

All output is written to `~/.claude/logs/line-channel.log` with timestamps, and also to stderr (visible in `--mcp-debug` mode).

```bash
# Follow live
tail -f ~/.claude/logs/line-channel.log

# Show last 50 lines
tail -50 ~/.claude/logs/line-channel.log
```

The unknown-userId message is how you discover your `LINE_USER_ID`:
```
2026-03-25T06:41:01Z [line-channel] Message from unknown userId: Uxxxxxxxxxx (update LINE_USER_ID in .env)
```

## Running tests

```bash
bun test
```

## Notes

- Replies within 30 seconds use LINE's Reply API; slower responses fall back to Push API automatically
- Push API free tier: 200 messages/month on LINE's free plan
- ngrok free tier URL changes on every restart — re-paste into LINE Console each time
