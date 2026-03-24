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
