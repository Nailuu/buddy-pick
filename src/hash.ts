import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";

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
  // Try to find the actual binary from the bun npm dependency.
  // The bun package puts its binary at node_modules/bun/bin/bun.exe
  // on ALL platforms (including Linux — that's how bun's postinstall works).
  try {
    const thisFile = fileURLToPath(import.meta.url)
    let dir = dirname(thisFile)
    for (let i = 0; i < 5; i++) {
      const candidate = join(dir, 'node_modules', 'bun', 'bin', 'bun.exe')
      if (existsSync(candidate)) return candidate
      dir = dirname(dir)
    }
  } catch {}

  // Fall back to system-installed bun via PATH
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which'
    return execFileSync(whichCmd, ["bun"], { encoding: "utf-8" }).trim().split(/\r?\n/)[0]!;
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

  // Handle spawn failures (e.g. Windows .bin shim not directly executable)
  // so Node doesn't crash with an unhandled 'error' event.
  const spawnFailed = new Promise<boolean>((resolve) => {
    bunProcess!.on("error", () => resolve(true));
  });

  rl = createInterface({ input: bunProcess.stdout! });
  rl.on("line", (line) => {
    const resolve = pendingResolves.shift();
    if (resolve) resolve(Number(line));
  });

  // Wait for process to be ready by sending a test hash — or a spawn error
  const testResult = await Promise.race([
    hashStringAsync("__buddy_pick_init__"),
    spawnFailed.then(() => NaN),
  ]);
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
