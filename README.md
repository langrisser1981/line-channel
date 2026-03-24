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

## Running tests

```bash
bun test
```

## Notes

- Push API is used for all outbound messages (no reply token timeout issues)
- Push API free tier: 500 messages/month on LINE's free plan
- ngrok free tier URL changes on every restart — re-paste into LINE Console each time
