import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json')
const MIN_VERSION = [2, 1, 89]

function readClaudeConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

export function getUserId(): string {
  const config = readClaudeConfig()
  const oauth = config.oauthAccount as
    | { accountUuid?: string }
    | undefined
  return oauth?.accountUuid ?? (config.userID as string) ?? 'anon'
}

export function deleteCompanionData(): void {
  const config = readClaudeConfig()
  if ('companion' in config) {
    delete config.companion
    writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
  }
}

export function getCompanionName(): string | null {
  const config = readClaudeConfig()
  const companion = config.companion as { name?: string } | undefined
  return companion?.name ?? null
}

export function renameCompanion(newName: string): boolean {
  const config = readClaudeConfig()
  const companion = config.companion as Record<string, unknown> | undefined
  if (!companion) return false
  companion.name = newName
  writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
  return true
}

function parseVersion(version: string): number[] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!
  }
  return 0
}

export function getClaudeVersion(): string | null {
  try {
    const output = execFileSync('claude', ['-v'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    // Format: "2.1.89 (Claude Code)"
    const match = output.match(/^([\d.]+)/)
    return match ? match[1]! : null
  } catch {
    return null
  }
}

export function checkMinVersion(): { ok: boolean; version: string | null; message?: string } {
  const version = getClaudeVersion()
  if (!version) {
    return {
      ok: false,
      version: null,
      message: 'Could not detect Claude Code version. Is claude installed and in PATH?',
    }
  }

  const parsed = parseVersion(version)
  if (!parsed) {
    return { ok: false, version, message: `Could not parse version: ${version}` }
  }

  if (compareVersions(parsed, MIN_VERSION) < 0) {
    return {
      ok: false,
      version,
      message: `Claude Code ${version} is too old. Buddy requires >= ${MIN_VERSION.join('.')}`,
    }
  }

  return { ok: true, version }
}
