import { select, input, confirm } from '@inquirer/prompts'
import ora from 'ora'
import pc from 'picocolors'

import { checkMinVersion, getUserId, deleteCompanionData, getCompanionName, renameCompanion } from './config.js'
import { findClaudeBinary, detectCurrentSalt, patchBinary, restoreBinary, hasBackup } from './binary.js'
import { initHasher, hashStringAsync, shutdownHasher } from './hash.js'
import { rollCompanion } from './roll.js'
import { renderCompanionCard, renderCompanionCompact, RARITY_COLOR } from './display.js'
import { renderSprite } from './sprites.js'
import { isValidSalt, bruteforceSalts, type BruteforceFilter } from './salt.js'
import { SPECIES, RARITIES, RARITY_STARS, SALT_LENGTH, EYES, HATS, type Species, type Rarity, type Eye, type Hat, type CompanionBones } from './types.js'

const BRUTEFORCE_PREFIX = 'buddy-pick-'

export async function runInteractiveFlow(): Promise<void> {
  console.log()
  console.log(pc.bold('  buddy-pick') + pc.dim(' — pick your Claude Code /buddy companion'))
  console.log()

  // Version check
  const versionCheck = checkMinVersion()
  if (!versionCheck.ok) {
    console.log(pc.red(`  Error: ${versionCheck.message}`))
    process.exit(1)
  }
  console.log(pc.dim(`  Claude Code ${versionCheck.version}`))

  // Find binary
  const binaryPath = findClaudeBinary()
  if (!binaryPath) {
    console.log(pc.red('  Error: Could not find Claude binary. Is claude installed?'))
    process.exit(1)
  }
  console.log(pc.dim(`  Binary: ${binaryPath}`))

  // Detect current salt
  const currentSalt = detectCurrentSalt(binaryPath)
  if (!currentSalt) {
    console.log(pc.red('  Error: Could not detect SALT in binary. Unsupported binary format?'))
    process.exit(1)
  }
  console.log(pc.dim(`  Current salt: ${currentSalt}`))

  // Init hasher
  const spinner = ora('Initializing hash engine...').start()
  const bunAvailable = await initHasher()
  if (bunAvailable) {
    spinner.succeed('Hash engine ready (bun wyhash)')
  } else {
    spinner.warn('Bun not found — using FNV-1a fallback (previews may not match production)')
  }

  // Read user ID
  const userId = getUserId()
  console.log(pc.dim(`  User ID: ${userId.substring(0, 8)}...`))
  console.log()

  // Show current companion
  const currentHash = await hashStringAsync(userId + currentSalt)
  const currentCompanion = rollCompanion(currentHash)
  console.log('  Your current companion:')
  console.log(renderCompanionCard(currentCompanion, currentSalt))
  console.log()

  // Main menu loop
  let running = true
  while (running) {
    const companionName = getCompanionName()
    const action = await select({
      message: 'What would you like to do?',
      choices: [
        { name: 'Browse species gallery', value: 'gallery' },
        { name: 'Bruteforce search for specific companion', value: 'bruteforce' },
        ...(companionName
          ? [{ name: `Rename companion (current: ${companionName})`, value: 'rename' as const }]
          : []),
        { name: 'Preview a custom salt', value: 'preview' },
        ...(hasBackup(binaryPath)
          ? [{ name: 'Restore original (from backup)', value: 'restore' as const }]
          : []),
        { name: 'Exit', value: 'exit' },
      ],
    })

    switch (action) {
      case 'preview':
        await handlePreview(userId, binaryPath, currentSalt)
        break
      case 'bruteforce':
        await handleBruteforce(userId, binaryPath, currentSalt)
        break
      case 'gallery':
        await handleGallery(userId)
        break
      case 'rename':
        await handleRename()
        break
      case 'restore':
        await handleRestore(binaryPath)
        break
      case 'exit':
        running = false
        break
    }
  }

  shutdownHasher()
}

async function handlePreview(userId: string, binaryPath: string, currentSalt: string): Promise<void> {
  const salt = await input({
    message: `Enter a ${SALT_LENGTH}-character salt:`,
    validate: (s) => {
      if (s.length !== SALT_LENGTH) return `Must be exactly ${SALT_LENGTH} characters (got ${s.length})`
      if (!isValidSalt(s)) return 'Invalid characters (use printable ASCII, no quotes or backslashes)'
      return true
    },
  })

  const hash = await hashStringAsync(userId + salt)
  const companion = rollCompanion(hash)
  console.log()
  console.log(renderCompanionCard(companion, salt))
  console.log()

  const apply = await confirm({ message: 'Apply this salt?', default: false })
  if (apply) {
    await applyPatch(binaryPath, currentSalt, salt)
  }
}

async function handleBruteforce(userId: string, binaryPath: string, currentSalt: string): Promise<void> {
  const speciesChoice = await select({
    message: 'Species:',
    choices: [
      { name: 'Any', value: '' },
      ...SPECIES.map((s) => ({ name: s, value: s })),
    ],
  })

  const rarityChoice = await select({
    message: 'Rarity:',
    choices: [
      { name: 'Any', value: '' },
      ...RARITIES.map((r) => ({ name: RARITY_COLOR[r](`${RARITY_STARS[r]} ${r}`), value: r })),
    ],
  })

  const eyeChoice = await select({
    message: 'Eyes:',
    choices: [
      { name: 'Any', value: '' },
      ...EYES.map((e) => ({ name: e, value: e })),
    ],
  })

  // Hat filter — only show if rarity is not common (common always gets 'none')
  let hatChoice = ''
  if (rarityChoice !== 'common') {
    hatChoice = await select({
      message: 'Hat:',
      choices: [
        { name: 'Any', value: '' },
        ...HATS.map((h) => ({ name: h, value: h })),
      ],
    })
  }

  const shinyChoice = await select({
    message: 'Shiny?',
    choices: [
      { name: 'Any', value: '' },
      { name: 'Yes', value: 'yes' },
      { name: 'No', value: 'no' },
    ],
  })

  const filter: BruteforceFilter = {}
  if (speciesChoice) filter.species = speciesChoice as Species
  if (rarityChoice) filter.rarity = rarityChoice as Rarity
  if (eyeChoice) filter.eye = eyeChoice as Eye
  if (hatChoice) filter.hat = hatChoice as Hat
  if (shinyChoice === 'yes') filter.shiny = true
  if (shinyChoice === 'no') filter.shiny = false

  const prefix = BRUTEFORCE_PREFIX

  const spinner = ora('Searching...').start()
  let lastUpdate = Date.now()

  const results = await bruteforceSalts(userId, filter, prefix, 1, (progress) => {
    const now = Date.now()
    if (now - lastUpdate > 200) {
      spinner.text = `Searching... tested ${progress.tested.toLocaleString()} salts`
      lastUpdate = now
    }
  })

  spinner.stop()

  if (results.length === 0) {
    console.log(pc.yellow('\n  No matches found. Try wider filters.\n'))
    return
  }

  const match = results[0]!
  console.log(pc.green('\n  Found a match!\n'))
  console.log(renderCompanionCard(match.companion, match.salt))
  console.log()

  const apply = await confirm({ message: 'Apply this salt?', default: true })
  if (apply) {
    await applyPatch(binaryPath, currentSalt, match.salt)
  }
}

async function handleGallery(_userId: string): Promise<void> {
  console.log(pc.bold('\n  Species Gallery'))
  console.log(pc.dim('  All 18 buddy species with their ASCII art\n'))

  // Render all species with a default eye, grouped in rows of 3
  const defaultEye = '·'
  const cols = 3
  const colWidth = 16

  for (let i = 0; i < SPECIES.length; i += cols) {
    const batch = SPECIES.slice(i, i + cols)

    // Build mock companions for sprite rendering
    const companions: CompanionBones[] = batch.map((species) => ({
      species,
      rarity: 'common' as const,
      eye: defaultEye,
      hat: 'none' as const,
      shiny: false,
      stats: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
    }))

    // Render sprites
    const sprites = companions.map((c) => renderSprite(c))

    // Determine max height
    const maxHeight = Math.max(...sprites.map((s) => s.length))

    // Pad sprites to same height
    const padded = sprites.map((s) => {
      while (s.length < maxHeight) s.push(' '.repeat(12))
      return s
    })

    // Print species names
    const nameRow = batch.map((s) => {
      const name = s.charAt(0).toUpperCase() + s.slice(1)
      return pc.bold(name.padEnd(colWidth))
    }).join('')
    console.log(`  ${nameRow}`)

    // Print sprite rows side by side
    for (let row = 0; row < maxHeight; row++) {
      const line = padded.map((s) => (s[row] ?? '').padEnd(colWidth)).join('')
      console.log(`  ${line}`)
    }

    console.log()
  }

  // Show eye variants
  console.log(pc.bold('  Eye Styles'))
  console.log(`  ${EYES.map((e) => `  ${e}  `).join(pc.dim('│'))}\n`)

  // Show hat variants
  console.log(pc.bold('  Hat Types'))
  console.log(`  ${HATS.filter((h) => h !== 'none').join(', ')}\n`)

  // Show rarity tiers
  console.log(pc.bold('  Rarity Tiers'))
  for (const r of RARITIES) {
    const stars = RARITY_STARS[r]
    const color = r === 'common' ? pc.dim : r === 'uncommon' ? pc.green : r === 'rare' ? pc.blue : r === 'epic' ? pc.magenta : (s: string) => pc.bold(pc.yellow(s))
    console.log(`  ${color(`${stars} ${r}`)}`)
  }
  console.log()
}

async function handleRename(): Promise<void> {
  const currentName = getCompanionName()
  if (!currentName) {
    console.log(pc.yellow('\n  No companion found. Hatch one first with /buddy in Claude Code.\n'))
    return
  }

  console.log(pc.dim(`\n  Current name: ${currentName}`))

  const newName = await input({
    message: 'New companion name:',
    validate: (s) => {
      const trimmed = s.trim()
      if (trimmed.length === 0) return 'Name cannot be empty'
      if (trimmed.length > 50) return 'Name too long (max 50 characters)'
      return true
    },
  })

  const ok = renameCompanion(newName.trim())
  if (ok) {
    console.log(pc.green(`\n  Renamed to ${pc.bold(newName.trim())}!\n`))
  } else {
    console.log(pc.red('\n  Failed — no companion data found in ~/.claude.json\n'))
  }
}

async function handleRestore(binaryPath: string): Promise<void> {
  const proceed = await confirm({
    message: 'Restore binary from backup?',
    default: false,
  })

  if (!proceed) return

  const ok = restoreBinary(binaryPath)
  if (ok) {
    deleteCompanionData()
    console.log(pc.green('\n  Restored!'))
    console.log(pc.yellow('  Restart your Claude Code instance for changes to take effect.'))
    console.log(pc.green('  Then run /buddy to re-hatch.\n'))
  } else {
    console.log(pc.red('\n  No backup found.\n'))
  }
}

async function applyPatch(binaryPath: string, oldSalt: string, newSalt: string): Promise<void> {
  const proceed = await confirm({
    message: 'This will modify your Claude binary. A backup will be created. Continue?',
    default: true,
  })

  if (!proceed) return

  try {
    const result = patchBinary(binaryPath, oldSalt, newSalt)
    deleteCompanionData()
    console.log(pc.green(`\n  Patched ${result.patchedCount} occurrences`))
    console.log(pc.dim(`  Backup: ${result.backupPath}`))
    console.log(pc.dim('  Cleared companion data from ~/.claude.json'))
    console.log()
    console.log(pc.yellow('  Restart your Claude Code instance for changes to take effect.'))
    console.log(pc.green('  Then run /buddy to meet your new companion!\n'))
  } catch (err) {
    console.log(pc.red(`\n  Patch failed: ${err instanceof Error ? err.message : err}\n`))
  }
}
