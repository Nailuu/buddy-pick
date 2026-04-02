import { readFileSync, writeFileSync, copyFileSync, existsSync, renameSync, statSync, chmodSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { SALT_LENGTH } from './types.js'

const RARITY_FLOOR_ANCHOR = Buffer.from(
  '{common:5,uncommon:15,rare:25,epic:35,legendary:50}',
)

// How far back from the anchor to search for the SALT
const ANCHOR_SCAN_RANGE = 200

export function findClaudeBinary(): string | null {
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    const found = execFileSync(whichCmd, ['claude'], { encoding: 'utf-8' }).trim().split(/\r?\n/)[0]!
    // realpathSync follows symlinks cross-platform (replaces Unix-only readlink -f)
    const resolved = realpathSync(found)
    if (existsSync(resolved)) return resolved
  } catch {}
  return null
}

export function detectCurrentSalt(binaryPath: string): string | null {
  const buf = readFileSync(binaryPath)

  // Find the RARITY_FLOOR anchor in the binary
  const anchorIdx = buf.indexOf(RARITY_FLOOR_ANCHOR)
  if (anchorIdx === -1) return null

  // Scan backward from anchor to find ="<15 chars>"
  const scanStart = Math.max(0, anchorIdx - ANCHOR_SCAN_RANGE)
  const region = buf.subarray(scanStart, anchorIdx)

  // Search for pattern: ="<exactly 15 printable ASCII chars>"
  // Work backward to find the closest match to the anchor
  for (let i = region.length - 1; i >= 3; i--) {
    if (region[i] === 0x22 /* " */ && region[i - SALT_LENGTH - 1] === 0x22 /* " */ && region[i - SALT_LENGTH - 2] === 0x3d /* = */) {
      const candidate = region.subarray(i - SALT_LENGTH, i).toString('utf-8')
      // Verify: all printable ASCII, no quotes/backslashes
      if (isValidSaltChars(candidate)) {
        // Verify it appears exactly 3 times in full binary
        const count = countOccurrences(buf, Buffer.from(candidate))
        if (count >= 3) return candidate
      }
    }
  }

  return null
}

function isValidSaltChars(s: string): boolean {
  if (s.length !== SALT_LENGTH) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c > 0x7e || c === 0x22 || c === 0x5c) return false // no control, ", or \
  }
  return true
}

function countOccurrences(buf: Buffer, needle: Buffer): number {
  let count = 0
  let idx = 0
  while ((idx = buf.indexOf(needle, idx)) !== -1) {
    count++
    idx += needle.length
  }
  return count
}

export function backupBinary(binaryPath: string): string {
  const backupPath = binaryPath + '.buddy-pick.bak'
  copyFileSync(binaryPath, backupPath)
  return backupPath
}

export function restoreBinary(binaryPath: string): boolean {
  const backupPath = binaryPath + '.buddy-pick.bak'
  if (!existsSync(backupPath)) return false
  const buf = readFileSync(backupPath)
  atomicWrite(binaryPath, buf)
  resignBinaryIfMac(binaryPath)
  return true
}

export function hasBackup(binaryPath: string): boolean {
  return existsSync(binaryPath + '.buddy-pick.bak')
}

export interface PatchResult {
  patchedCount: number
  backupPath: string
}

// Write patched content to a temp file then rename over the original.
// rename(2) replaces the directory entry without opening the target for
// writing, which avoids ETXTBSY when the binary is running.
function atomicWrite(targetPath: string, buf: Buffer): void {
  const tmpPath = join(dirname(targetPath), `.buddy-pick-tmp-${process.pid}`)
  writeFileSync(tmpPath, buf)
  // Preserve original file permissions (executable bits)
  const { mode } = statSync(targetPath)
  chmodSync(tmpPath, mode)
  renameSync(tmpPath, targetPath)
}

// On macOS, modifying a signed binary invalidates its code signature.
// The OS will kill the process on launch (SIGKILL) unless we re-sign it.
// Ad-hoc signing (-s -) doesn't require an Apple Developer certificate.
function resignBinaryIfMac(binaryPath: string): void {
  if (process.platform !== 'darwin') return
  try {
    execFileSync('codesign', ['-f', '-s', '-', binaryPath], { stdio: 'ignore' })
  } catch {
    // codesign not available or failed — warn but don't block
    console.warn(
      '\n⚠️  Could not re-sign the binary (codesign failed).\n' +
      '   macOS may prevent Claude from launching.\n' +
      '   Try running manually: codesign -f -s - ' + binaryPath + '\n',
    )
  }
}

export function patchBinary(
  binaryPath: string,
  oldSalt: string,
  newSalt: string,
): PatchResult {
  if (newSalt.length !== SALT_LENGTH) {
    throw new Error(`New salt must be exactly ${SALT_LENGTH} characters, got ${newSalt.length}`)
  }
  if (!isValidSaltChars(newSalt)) {
    throw new Error('Salt contains invalid characters (must be printable ASCII, no quotes or backslashes)')
  }

  const backupPath = backupBinary(binaryPath)
  const buf = readFileSync(binaryPath)
  const oldBuf = Buffer.from(oldSalt)
  const newBuf = Buffer.from(newSalt)

  let patchedCount = 0
  let idx = 0
  while ((idx = buf.indexOf(oldBuf, idx)) !== -1) {
    newBuf.copy(buf, idx)
    patchedCount++
    idx += newBuf.length
  }

  if (patchedCount === 0) {
    throw new Error(`Salt "${oldSalt}" not found in binary`)
  }

  atomicWrite(binaryPath, buf)
  resignBinaryIfMac(binaryPath)
  return { patchedCount, backupPath }
}
