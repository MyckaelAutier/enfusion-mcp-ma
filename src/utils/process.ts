import { execFileSync, spawn } from "node:child_process";
import { openSync, closeSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const IS_WIN = process.platform === "win32";

/** PIDs of running processes whose executable name is `image` (e.g. "ArmaReforgerServer.exe"). */
export function findPids(image: string): number[] {
  try {
    if (IS_WIN) {
      const out = execFileSync("tasklist", ["/fo", "csv", "/nh", "/fi", `imagename eq ${image}`], {
        encoding: "utf-8",
        windowsHide: true,
      });
      // "image","pid",... — "INFO: No tasks..." when nothing matches
      return [...out.matchAll(/^"[^"]+","(\d+)"/gm)].map((m) => Number(m[1]));
    }
    const out = execFileSync("pgrep", ["-x", image.replace(/\.exe$/i, "")], { encoding: "utf-8" });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

/**
 * Stop processes. Without `force`, ask them to close (WM_CLOSE / SIGTERM) so they can
 * save; with `force`, kill the whole tree.
 */
export function killPids(pids: number[], force = false): void {
  for (const pid of pids) {
    try {
      if (IS_WIN) {
        execFileSync("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], { windowsHide: true, stdio: "ignore" });
      } else {
        process.kill(pid, force ? "SIGKILL" : "SIGTERM");
      }
    } catch {
      // already gone
    }
  }
}

/**
 * Start a long-running program detached from this process (it keeps running if the
 * MCP server exits). stdout/stderr go to `logFile` when given. Returns the PID.
 */
export function spawnDetached(exe: string, args: string[], cwd: string, logFile?: string): number {
  const fd = logFile ? openSync(logFile, "a") : "ignore";
  const child = spawn(exe, args, {
    cwd,
    detached: true,
    windowsHide: false,
    stdio: ["ignore", fd, fd],
  });
  child.unref();
  if (typeof fd === "number") closeSync(fd);
  if (!child.pid) throw new Error(`Failed to start ${exe}`);
  return child.pid;
}

/** Newest sub-directory of `dir` (by mtime), optionally only those modified after `since`. */
export function newestDir(dir: string, since = 0): string | null {
  if (!existsSync(dir)) return null;
  let best: { path: string; t: number } | null = null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    const t = statSync(p).mtimeMs;
    if (t >= since && (!best || t > best.t)) best = { path: p, t };
  }
  return best?.path ?? null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
