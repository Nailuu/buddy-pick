import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { SALT_LENGTH } from './types.js'

interface BuddyState {
  lastAppliedSalt: string
  binaryPath: string
}

const STATE_PATH = join(homedir(), '.config', 'buddy-pick', 'state.json')

export function readState(): BuddyState | null {
  try {
    const data = JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
    if (
      typeof data.lastAppliedSalt === 'string' &&
      data.lastAppliedSalt.length === SALT_LENGTH &&
      typeof data.binaryPath === 'string' &&
      data.binaryPath.length > 0
    ) {
      return data as BuddyState
    }
    return null
  } catch {
    return null
  }
}

export function writeState(salt: string, binaryPath: string): void {
  const dir = dirname(STATE_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const state: BuddyState = { lastAppliedSalt: salt, binaryPath }
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n')
}

export function clearState(): void {
  try {
    unlinkSync(STATE_PATH)
  } catch {}
}
