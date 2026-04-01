import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";

const HASHER_SCRIPT = `
const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", (line) => {
  process.stdout.write(String(Number(BigInt(Bun.hash(line)) & 0xffffffffn)) + "\\n");
});
`;

let bunProcess: ChildProcess | null = null;
let rl: Interface | null = null;
let scriptPath: string | null = null;
let pendingResolves: ((value: number) => void)[] = [];
let useFallback = false;

function findBun(): string | null {
  try {
    return execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export async function initHasher(): Promise<boolean> {
  const bunPath = findBun();
  if (!bunPath) {
    useFallback = true;
    return false;
  }

  scriptPath = join(tmpdir(), `buddy-pick-hasher-${process.pid}.js`);
  writeFileSync(scriptPath, HASHER_SCRIPT);

  bunProcess = spawn(bunPath, [scriptPath], {
    stdio: ["pipe", "pipe", "ignore"],
  });

  rl = createInterface({ input: bunProcess.stdout! });
  rl.on("line", (line) => {
    const resolve = pendingResolves.shift();
    if (resolve) resolve(Number(line));
  });

  // Wait for process to be ready by sending a test hash
  const testResult = await hashStringAsync("__buddy_pick_init__");
  if (typeof testResult !== "number" || isNaN(testResult)) {
    shutdownHasher();
    useFallback = true;
    return false;
  }

  return true;
}

export function hashStringAsync(s: string): Promise<number> {
  if (useFallback) return Promise.resolve(hashStringFnv1a(s));

  return new Promise((resolve) => {
    pendingResolves.push(resolve);
    bunProcess!.stdin!.write(s + "\n");
  });
}

export async function hashBatch(strings: string[]): Promise<number[]> {
  if (useFallback) return strings.map(hashStringFnv1a);
  return Promise.all(strings.map(hashStringAsync));
}

export function shutdownHasher(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
  if (bunProcess) {
    bunProcess.stdin!.end();
    bunProcess.kill();
    bunProcess = null;
  }
  if (scriptPath) {
    try {
      unlinkSync(scriptPath);
    } catch {}
    scriptPath = null;
  }
  pendingResolves = [];
}

export function isUsingFallback(): boolean {
  return useFallback;
}

// FNV-1a fallback
// WARNING: produces different results than Bun.hash (wyhash)
function hashStringFnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
