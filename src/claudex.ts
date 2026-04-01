import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { CompanionBones } from "./types.js";

const CLAUDEX_PATH = join(homedir(), ".config", "buddy-pick", "claudex.json");

export interface ClaudexEntry {
  salt: string;
  species: string;
  rarity: string;
  eye: string;
  hat: string;
  shiny: boolean;
  savedAt: string; // ISO date
  name?: string; // optional user-given label
}

function readClaudex(): ClaudexEntry[] {
  try {
    return JSON.parse(readFileSync(CLAUDEX_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeClaudex(entries: ClaudexEntry[]): void {
  const dir = dirname(CLAUDEX_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CLAUDEX_PATH, JSON.stringify(entries, null, 2) + "\n");
}

export function getClaudexEntries(): ClaudexEntry[] {
  return readClaudex();
}

export function addToClaudex(
  salt: string,
  companion: CompanionBones,
  name?: string,
): ClaudexEntry {
  const entries = readClaudex();

  // Don't duplicate — update existing entry with same salt
  const existing = entries.findIndex((e) => e.salt === salt);
  const entry: ClaudexEntry = {
    salt,
    species: companion.species,
    rarity: companion.rarity,
    eye: companion.eye,
    hat: companion.hat,
    shiny: companion.shiny,
    savedAt: new Date().toISOString(),
    name,
  };

  if (existing >= 0) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }

  writeClaudex(entries);
  return entry;
}

export function removeFromClaudex(salt: string): boolean {
  const entries = readClaudex();
  const filtered = entries.filter((e) => e.salt !== salt);
  if (filtered.length === entries.length) return false;
  writeClaudex(filtered);
  return true;
}

export function renameClaudexEntry(
  salt: string,
  name: string,
): boolean {
  const entries = readClaudex();
  const entry = entries.find((e) => e.salt === salt);
  if (!entry) return false;
  entry.name = name;
  writeClaudex(entries);
  return true;
}
