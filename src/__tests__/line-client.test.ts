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
