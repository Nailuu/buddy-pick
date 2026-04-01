# buddy-pick

Pick your Claude Code `/buddy` companion.

An interactive CLI tool that lets you preview and choose your Claude Code companion by patching the generation salt in the Claude binary.

## Installation

```bash
npx buddy-pick
```

### Prerequisites

- **Claude Code >= 2.1.89** (buddy system introduced in this version)
- **Bun runtime** (recommended, for accurate hash computation — auto-detected)
  - If bun isn't available, falls back to FNV-1a hash which may produce different previews than production

## Features

- **Preview companions** — See exactly what species, rarity, stats, and traits you'll get for any salt
- **Bruteforce search** — Find salts that produce your desired species/rarity combo
- **Binary patching** — Safely patch the Claude binary with automatic backup
- **Restore** — One-click restore from backup
- **Version check** — Validates Claude Code version before patching

## How It Works

Claude Code generates your `/buddy` companion deterministically:

```
userId + SALT → hash → seeded PRNG → rarity → species → eye → hat → shiny → stats
```

The SALT is a 15-byte constant baked into the Claude binary. Changing it changes the hash seed, which produces a completely different companion. buddy-pick finds the SALT in the binary using structural anchors (nearby constants that don't change), previews what different salts would produce, and patches the binary when you've found one you like.

After patching, buddy-pick clears the stored companion data from `~/.claude.json` so Claude Code re-hatches your new companion on the next `/buddy` invocation.

## Usage

```
$ npx buddy-pick

  buddy-pick — pick your Claude Code /buddy companion

  Claude Code 2.1.89
  Binary: /home/user/.local/share/claude/versions/2.1.89
  Current salt: friend-2026-402

  Your current companion:
  ╭──────────────────────────────────╮
  │ ★★ UNCOMMON                      │
  │ Species: duck                     │
  │ Eyes: ✦   Hat: none               │
  │                                   │
  │ DEBUGGING  ████████░░  78         │
  │ PATIENCE   ██░░░░░░░░  25         │
  │ ...                               │
  ╰──────────────────────────────────╯

  ? What would you like to do?
  > Preview a custom salt
    Bruteforce search for specific companion
    Browse species gallery
    Restore original (from backup)
    Exit
```

## Limitations

- **Auto-updates overwrite patches** — Claude Code updates replace the binary, requiring re-patching. Your backup is preserved.
- **Hash accuracy requires bun** — The production binary uses Bun's `wyhash` for companion generation. Without bun, previews use the FNV-1a fallback and may not match.
- **Bruteforce speed** — Depends on bun subprocess throughput. A 4-character suffix space (~14.8M candidates) typically completes in seconds.

## License

MIT
