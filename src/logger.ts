import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

const LOG_PATH = join(process.env.HOME ?? '~', '.claude', 'logs', 'line-channel.log')

mkdirSync(dirname(LOG_PATH), { recursive: true })

export function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`
  process.stderr.write(line)
  appendFileSync(LOG_PATH, line)
}
