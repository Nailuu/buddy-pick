import { existsSync } from 'node:fs'
import { runInteractiveFlow } from './ui.js'
import { readState, writeState } from './state.js'
import { findClaudeBinary, detectCurrentSalt, patchBinary } from './binary.js'
import { isValidSalt } from './salt.js'
import { checkMinVersion, deleteCompanionData } from './config.js'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  buddy-pick — Pick your Claude Code /buddy companion

  Usage:
    npx buddy-pick             Interactive companion picker
    npx buddy-pick --restore   Re-apply last buddy after a Claude update
    npx buddy-pick --help      Show this help
    npx buddy-pick --version

  Customize your Claude Code companion by previewing and
  patching the generation salt in the Claude binary.
`)
  process.exit(0)
}

if (args.includes('--version') || args.includes('-v')) {
  console.log('0.1.0')
  process.exit(0)
}

if (args.includes('--restore')) {
  try {
    runRestore()
  } catch (err) {
    console.error(`buddy-pick: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
  process.exit(0)
}

runInteractiveFlow().catch((err) => {
  if (err instanceof Error && err.message.includes('User force closed')) {
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})

function runRestore(): void {
  const state = readState()
  if (!state) {
    console.log('buddy-pick: Nothing to restore (no previous patch recorded)')
    return
  }

  if (!isValidSalt(state.lastAppliedSalt)) {
    throw new Error('Stored salt is invalid — state.json may be corrupted')
  }

  const versionCheck = checkMinVersion()
  if (!versionCheck.ok) {
    throw new Error(versionCheck.message ?? 'Version check failed')
  }

  let binaryPath = findClaudeBinary()
  if (!binaryPath && existsSync(state.binaryPath)) {
    binaryPath = state.binaryPath
  }
  if (!binaryPath) {
    throw new Error('Claude binary not found')
  }

  const currentSalt = detectCurrentSalt(binaryPath)
  if (!currentSalt) {
    throw new Error('Could not detect salt in binary (unsupported format?)')
  }

  if (currentSalt === state.lastAppliedSalt) {
    console.log('buddy-pick: Your buddy is already active')
    return
  }

  const result = patchBinary(binaryPath, currentSalt, state.lastAppliedSalt)
  writeState(state.lastAppliedSalt, binaryPath)
  deleteCompanionData()
  console.log(`buddy-pick: Restored buddy (${result.patchedCount} patches applied)`)
}
