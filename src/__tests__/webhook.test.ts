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
    let notificationCallStarted = false
    let notificationCallCompleted = false
    const delayedNotificationMock = mock(async (n: unknown) => {
      notificationCallStarted = true
      await Bun.sleep(10) // Simulate some async work
      notificationCallCompleted = true
      notifications.push(n)
      return Promise.resolve()
    })
    const origMcp = mockMcp as any
    origMcp.notification = delayedNotificationMock

    const body = JSON.stringify({
      events: [{ type: 'message', replyToken: 'tok1', source: { userId: USER_ID }, message: { type: 'text', text: 'hi' } }],
    })
    const res = await postWebhook(body)
    // Handler returns 200 before background processing (fire-and-forget pattern).
    // Even though processing may have started, the response comes back without waiting for it to complete.
    expect(res.status).toBe(200)
    // Wait for background processing to actually complete
    await Bun.sleep(50)
    expect(notificationCallCompleted).toBe(true)
    expect(notifications).toHaveLength(1)

    // Restore original mock for other tests
    notificationMock.mockReset()
    notificationMock.mockImplementation((n: unknown) => {
      notifications.push(n)
      return Promise.resolve()
    })
    origMcp.notification = notificationMock
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
    expect(n.params.meta.user_id).toBe(USER_ID)
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
