import pc from "picocolors";
import {
  type CompanionBones,
  type Rarity,
  RARITY_STARS,
  STAT_NAMES,
} from "./types.js";
import { renderSprite } from "./sprites.js";

export const RARITY_COLOR: Record<Rarity, (s: string) => string> = {
  common: pc.dim,
  uncommon: pc.green,
  rare: pc.blue,
  epic: pc.magenta,
  legendary: (s) => pc.bold(pc.yellow(s)),
};

function colorForRarity(rarity: Rarity): (s: string) => string {
  return RARITY_COLOR[rarity];
}

function statBar(value: number): string {
  const filled = Math.round(value / 10);
  const empty = 10 - filled;
  return pc.green("█".repeat(filled)) + pc.dim("░".repeat(empty));
}

function padRight(s: string, len: number): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  return s + " ".repeat(Math.max(0, len - visible.length));
}

export function renderCompanionCard(
  companion: CompanionBones,
  salt: string,
): string {
  const color = colorForRarity(companion.rarity);
  const stars = RARITY_STARS[companion.rarity];
  const width = 34;

  const lines: string[] = [];
  const hr = "─".repeat(width);

  lines.push(pc.dim(`  ╭${hr}╮`));

  // Rarity header
  const rarityLine = `${stars} ${companion.rarity.toUpperCase()}`;
  lines.push(
    pc.dim("  │ ") + color(padRight(rarityLine, width - 1)) + pc.dim("│"),
  );

  // ASCII sprite
  const sprite = renderSprite(companion);
  for (const spriteLine of sprite) {
    const centered = centerIn(spriteLine, width);
    lines.push(pc.dim("  │") + color(centered) + pc.dim("│"));
  }

  // Shiny badge
  if (companion.shiny) {
    lines.push(
      pc.dim("  │ ") +
        padRight(pc.bold(pc.yellow("✨ SHINY!")), width - 1) +
        pc.dim("│"),
    );
  }

  lines.push(pc.dim("  │") + " ".repeat(width) + pc.dim("│"));

  // Species / eye / hat info
  const speciesLine = `Species: ${companion.species}`;
  lines.push(
    pc.dim("  │ ") + padRight(speciesLine, width - 1) + pc.dim("│"),
  );

  const eyeHatLine = `Eyes: ${companion.eye}   Hat: ${companion.hat}`;
  lines.push(
    pc.dim("  │ ") + padRight(eyeHatLine, width - 1) + pc.dim("│"),
  );

  lines.push(pc.dim("  │") + " ".repeat(width) + pc.dim("│"));

  // Stats
  for (const name of STAT_NAMES) {
    const value = companion.stats[name];
    const bar = statBar(value);
    const label = padRight(name, 10);
    const valStr = String(value).padStart(3);
    const statLine = `${label} ${bar}  ${valStr}`;
    lines.push(
      pc.dim("  │ ") + padRight(statLine, width - 1) + pc.dim("│"),
    );
  }

  lines.push(pc.dim("  │") + " ".repeat(width) + pc.dim("│"));

  // Salt footer
  const saltLine = `Salt: ${salt}`;
  lines.push(
    pc.dim("  │ ") + pc.dim(padRight(saltLine, width - 1)) + pc.dim("│"),
  );

  lines.push(pc.dim(`  ╰${hr}╯`));

  return lines.join("\n");
}

function centerIn(s: string, width: number): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, width - visible.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

export function renderCompanionCompact(
  companion: CompanionBones,
  salt: string,
): string {
  const color = colorForRarity(companion.rarity);
  const stars = RARITY_STARS[companion.rarity];
  const shiny = companion.shiny ? " ✨" : "";
  const hat = companion.hat !== "none" ? ` 🎩 ${companion.hat}` : "";

  return `${color(`${stars} ${companion.rarity}`)} ${companion.species}${hat}${shiny} ${pc.dim(`[${salt}]`)}`;
}

export function renderSpriteBlock(companion: CompanionBones): string {
  const color = colorForRarity(companion.rarity);
  const sprite = renderSprite(companion);
  return sprite.map((line) => color(line)).join("\n");
}
