import { SALT_LENGTH, type CompanionBones, type Rarity, type Species } from './types.js'
import { hashBatch } from './hash.js'
import { rollCompanion } from './roll.js'

const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'

export function isValidSalt(s: string): boolean {
  if (s.length !== SALT_LENGTH) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c > 0x7e || c === 0x22 || c === 0x27 || c === 0x5c || c === 0x00) return false
  }
  return true
}

export function generateRandomSalt(prefix = ''): string {
  const remaining = SALT_LENGTH - prefix.length
  if (remaining < 0) throw new Error(`Prefix too long (max ${SALT_LENGTH} chars)`)
  let salt = prefix
  for (let i = 0; i < remaining; i++) {
    salt += CHARSET[Math.floor(Math.random() * CHARSET.length)]
  }
  return salt
}

export interface BruteforceFilter {
  species?: Species
  rarity?: Rarity
  shiny?: boolean
}

export interface BruteforceMatch {
  salt: string
  companion: CompanionBones
}

export interface BruteforceProgress {
  tested: number
  found: number
  currentSalt: string
}

function matchesFilter(companion: CompanionBones, filter: BruteforceFilter): boolean {
  if (filter.species && companion.species !== filter.species) return false
  if (filter.rarity && companion.rarity !== filter.rarity) return false
  if (filter.shiny !== undefined && companion.shiny !== filter.shiny) return false
  return true
}

// Generate all salt candidates with given prefix
function* generateCandidates(prefix: string): Generator<string> {
  const suffixLen = SALT_LENGTH - prefix.length
  if (suffixLen <= 0) {
    if (prefix.length === SALT_LENGTH) yield prefix
    return
  }

  const indices = new Array(suffixLen).fill(0)
  const charsetLen = CHARSET.length

  while (true) {
    let salt = prefix
    for (let i = 0; i < suffixLen; i++) {
      salt += CHARSET[indices[i]!]
    }
    yield salt

    // Increment like an odometer
    let pos = suffixLen - 1
    while (pos >= 0) {
      indices[pos]!++
      if (indices[pos]! < charsetLen) break
      indices[pos] = 0
      pos--
    }
    if (pos < 0) break
  }
}

export async function bruteforceSalts(
  userId: string,
  filter: BruteforceFilter,
  prefix = '',
  maxResults = 20,
  onProgress?: (progress: BruteforceProgress) => void,
): Promise<BruteforceMatch[]> {
  const results: BruteforceMatch[] = []
  const BATCH_SIZE = 1000
  let tested = 0
  let batch: string[] = []

  for (const salt of generateCandidates(prefix)) {
    batch.push(salt)

    if (batch.length >= BATCH_SIZE) {
      const inputs = batch.map((s) => userId + s)
      const hashes = await hashBatch(inputs)

      for (let i = 0; i < batch.length; i++) {
        const companion = rollCompanion(hashes[i]!)
        if (matchesFilter(companion, filter)) {
          results.push({ salt: batch[i]!, companion })
          if (results.length >= maxResults) return results
        }
      }

      tested += batch.length
      if (onProgress) {
        onProgress({ tested, found: results.length, currentSalt: batch[batch.length - 1]! })
      }
      batch = []
    }
  }

  // Process remaining batch
  if (batch.length > 0) {
    const inputs = batch.map((s) => userId + s)
    const hashes = await hashBatch(inputs)

    for (let i = 0; i < batch.length; i++) {
      const companion = rollCompanion(hashes[i]!)
      if (matchesFilter(companion, filter)) {
        results.push({ salt: batch[i]!, companion })
        if (results.length >= maxResults) return results
      }
    }
  }

  return results
}
