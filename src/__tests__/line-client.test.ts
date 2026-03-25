import { describe, expect, spyOn, test, beforeEach, afterEach } from 'bun:test'
import { createHmac } from 'crypto'
import { verifySignature, replyMessage } from '../line-client'

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
