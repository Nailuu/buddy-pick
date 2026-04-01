# buddy-pick Research

CLI tool to customize your Claude Code `/buddy` companion by patching the generation salt in the binary.

## How the buddy system works

### Generation pipeline

```
userId (from ~/.claude.json)
    ↓
userId + SALT ("friend-2026-401")
    ↓
hashString() → 32-bit integer (FNV-1a hash, or Bun.hash on Bun runtime)
    ↓
mulberry32(hash) → seeded PRNG function
    ↓
Sequential rolls: rarity → species → eye → hat → shiny → stats
```

Every trait is derived from a single deterministic sequence. Changing the SALT changes the hash, which changes every roll.

### Source locations (claude-code)

| File | Purpose |
|------|---------|
| `src/buddy/companion.ts` | SALT constant, `roll()`, `rollFrom()`, `hashString()`, `mulberry32()` PRNG |
| `src/buddy/types.ts` | Species, eyes, hats, rarities, stats, rarity weights |
| `src/buddy/sprites.ts` | ASCII art frames per species, hat overlays, face renderer |
| `src/buddy/CompanionSprite.tsx` | React component rendering the sprite + speech bubble |
| `src/buddy/prompt.ts` | System prompt injection for companion personality |
| `src/buddy/useBuddyNotification.tsx` | Rainbow `/buddy` teaser notification |

### SALT

```ts
// src/buddy/companion.ts:84
const SALT = 'friend-2026-401'
```

- `friend` — internal codename for the feature
- `2026` — launch year
- `401` — April 1st (April Fools' feature, teaser window: April 1-7 2026)
- 15 bytes long — replacement must be exactly 15 bytes

### PRNG: Mulberry32

```ts
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

32-bit seeded PRNG. Returns a closure producing floats in [0, 1). Same seed → same sequence, always.

### Hash function

```ts
function hashString(s: string): number {
  // Bun runtime path
  if (typeof Bun !== 'undefined') {
    return Number(BigInt(Bun.hash(s)) & 0xffffffffn)
  }
  // Fallback: FNV-1a
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
```

**Important**: The production binary is a Bun executable, so it uses `Bun.hash()` (xxHash-based), NOT the FNV-1a fallback. A preview tool running in Node.js would use the fallback and produce **different results**. To get accurate previews, either:
- Run the preview tool with Bun
- Reverse-engineer `Bun.hash()` output (it's xxHash3 / wyhash depending on version)

## Available pets

### Species (18)

duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk

### Eyes (6)

`·` `✦` `×` `◉` `@` `°`

### Hats (8)

none, crown, tophat, propeller, halo, wizard, beanie, tinyduck

- Common rarity → always `none`
- All other rarities → random hat from the full list

### Rarities

| Rarity | Weight | Probability | Stars | Stat floor |
|-----------|--------|-------------|-------|------------|
| common | 60 | 60% | ★ | 5 |
| uncommon | 25 | 25% | ★★ | 15 |
| rare | 10 | 10% | ★★★ | 25 |
| epic | 4 | 4% | ★★★★ | 35 |
| legendary | 1 | 1% | ★★★★★ | 50 |

### Stats (5)

DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK

Each roll picks one **peak stat** and one **dump stat**:
- Peak: `floor + 50 + random(0-29)` (capped at 100)
- Dump: `floor - 10 + random(0-14)` (min 1)
- Others: `floor + random(0-39)`

### Shiny

1% chance (`rng() < 0.01`), rolled after hat.

## Storage

### What's persisted (`~/.claude.json`)

```json
{
  "companion": {
    "name": "Emberwit",
    "personality": "A meticulous debugger who...",
    "hatchedAt": 1775046091220
  },
  "companionMuted": false
}
```

Only the **soul** (name + personality) and hatch timestamp are stored. These are model-generated during the first `/buddy` hatch.

### What's regenerated on every read

**Bones**: species, rarity, eye, hat, shiny, stats — all derived from `hash(userId + SALT)`. Never persisted.

### User ID source

```ts
function companionUserId(): string {
  const config = getGlobalConfig()
  return config.oauthAccount?.accountUuid ?? config.userID ?? 'anon'
}
```

Priority: OAuth account UUID > legacy userID > `"anon"`.

## Binary patching approach

### Target

The Claude Code production binary is a **Bun single-file ELF executable** with embedded JS.

```
$ file $(readlink -f $(which claude))
ELF 64-bit LSB executable, x86-64 ...

$ grep -boa 'friend-2026-401' /path/to/claude
109742322:friend-2026-401
120758160:friend-2026-401
217633578:friend-2026-401
```

The SALT string appears 3 times (runtime JS, source map, possibly module graph duplicate).

### Constraints

- **Replacement must be exactly 15 bytes** — different length corrupts offsets in the binary
- All 3 occurrences should be replaced for consistency
- After patching, delete `"companion"` key from `~/.claude.json` to trigger re-hatch

### Patch command

```bash
cp /path/to/claude /path/to/claude.bak
sed -i 's/friend-2026-401/friend-2026-XXX/g' /path/to/claude
```

## CLI design considerations

- Preview mode: simulate rolls for candidate salts before patching (requires Bun for accurate hash)
- Backup/restore: always backup the binary before patching
- Salt bruteforce: iterate salts to find desired species/rarity combos
- Updates: Claude Code auto-updates will overwrite the binary, requiring re-patch
