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
