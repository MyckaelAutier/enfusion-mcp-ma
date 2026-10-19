/**
 * Headless Workbench runs (no GUI, no NET API): script compilation and addon packing.
 *
 * Verified against Arma Reforger Tools 1.8:
 *  - `-gproj X -wbSilent` compiles every script module incl. the addon's and exits;
 *    exit code -1 + `Can't compile "Game" script module!` on failure, 0 on success.
 *  - `-gproj X -wbModule=ResourceManager -packAddon -packAddonDir D` writes
 *    <D>/{data.pak, <Name>.gproj, resourceDatabase.rdb} — the layout the game and
 *    the dedicated server load through -addonsDir — and logs "Packaging project successful".
 *  - `-buildData` (what the old `mod build` used) leaves the GUI open and never exits.
 * Results are read from the newest folder in <Workbench profile>/logs.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Config } from "../config.js";
import { findWorkbenchExe } from "../utils/game-paths.js";
import { newestDir } from "../utils/process.js";

export interface ScriptIssue {
  file: string;
  line: number;
  message: string;
  /** true when the file belongs to the addon being compiled */
  inAddon: boolean;
}

export interface WorkbenchRun {
  exitCode: number;
  timedOut: boolean;
  seconds: number;
  logDir: string | null;
  console: string;
}

/** Workbench profile dir (holds logs/, addons/). */
export function workbenchProfileDir(config: Config): string {
  return resolve(config.projectPath, "..");
}

export function runWorkbench(config: Config, args: string[], timeoutMs: number): Promise<WorkbenchRun> {
  const exe = findWorkbenchExe(config.workbenchPath);
  if (!exe) throw new Error(`Workbench not found under ${config.workbenchPath} (need Workbench/ArmaReforgerWorkbenchSteamDiag.exe)`);
  const logsDir = join(workbenchProfileDir(config), "logs");
  const start = Date.now();
  return new Promise((done) => {
    // CWD = game dir so ./addons/data and ./addons/core resolve (same as wb_launch)
    const cwd = existsSync(config.gamePath) ? config.gamePath : dirname(exe);
    const proc = spawn(exe, args, { cwd, windowsHide: true, stdio: "ignore" });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutMs);
    const finish = (code: number | null) => {
      clearTimeout(timer);
      const logDir = newestDir(logsDir, start - 5000);
      const consolePath = logDir ? join(logDir, "console.log") : "";
      done({
        exitCode: code ?? -1,
        timedOut,
        seconds: Math.round((Date.now() - start) / 1000),
        logDir,
        console: consolePath && existsSync(consolePath) ? readFileSync(consolePath, "utf-8") : "",
      });
    };
    proc.on("close", finish);
    proc.on("error", () => finish(-1));
  });
}

/** Parse `SCRIPT (E): @"path,line": message` lines (errors or warnings), deduplicated. */
export function parseScriptIssues(consoleText: string, addonDir: string | null, level: "E" | "W" = "E"): ScriptIssue[] {
  const seen = new Set<string>();
  const out: ScriptIssue[] = [];
  const re = new RegExp(`SCRIPT\\s+\\(${level}\\): @"([^"]+?),(\\d+)": (.+)$`, "gm");
  for (const m of consoleText.matchAll(re)) {
    const key = `${m[1]}:${m[2]}:${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      file: m[1],
      line: Number(m[2]),
      message: m[3].trim(),
      inAddon: !!addonDir && existsSync(join(addonDir, m[1])),
    });
  }
  return out;
}

export interface CompileResult {
  ok: boolean;
  run: WorkbenchRun;
  errors: ScriptIssue[];
  warnings: ScriptIssue[];
}

export async function compileAddon(config: Config, gprojPath: string, timeoutMs = 10 * 60_000): Promise<CompileResult> {
  const run = await runWorkbench(config, ["-gproj", gprojPath, "-wbSilent", "-noThrow"], timeoutMs);
  const addonDir = dirname(gprojPath);
  const errors = parseScriptIssues(run.console, addonDir, "E");
  const warnings = parseScriptIssues(run.console, addonDir, "W").filter((w) => w.inAddon);
  const failed = run.timedOut || run.exitCode !== 0 || /Can't compile ".+" script module/.test(run.console);
  return { ok: !failed, run, errors, warnings };
}

export interface PackResult {
  ok: boolean;
  run: WorkbenchRun;
  outDir: string;
  files: string[];
  /** "(E)" lines logged while packaging */
  errors: string[];
}

export async function packAddon(config: Config, gprojPath: string, outDir: string, timeoutMs = 30 * 60_000): Promise<PackResult> {
  mkdirSync(outDir, { recursive: true }); // Workbench does not create missing parents
  const run = await runWorkbench(
    config,
    ["-gproj", gprojPath, "-wbModule=ResourceManager", "-packAddon", "-packAddonDir", outDir, "-noThrow"],
    timeoutMs
  );
  const files = existsSync(outDir) ? readdirSync(outDir) : [];
  const ok = !run.timedOut && run.exitCode === 0 && /Packaging project successful/.test(run.console) && files.includes("data.pak");
  const packLog = run.console.slice(Math.max(0, run.console.indexOf("Packaging project started")));
  const errors = [...packLog.matchAll(/^.*\(E\): (.+)$/gm)].map((m) => m[1].trim());
  return { ok, run, outDir, files, errors };
}

/** Read ID / GUID / TITLE from a .gproj. */
export function readGproj(gprojPath: string): { id: string; guid: string; title: string } {
  const t = readFileSync(gprojPath, "utf-8");
  const get = (k: string) => t.match(new RegExp(`^\\s*${k}\\s+"?([^"\\r\\n]+?)"?\\s*$`, "m"))?.[1] ?? "";
  return { id: get("ID"), guid: get("GUID"), title: get("TITLE") };
}

/** Find an addon's .gproj by addon folder name (under projectPath) or return the given path. */
export function resolveGproj(config: Config, addonName?: string, gprojPath?: string): string | null {
  if (gprojPath) return existsSync(gprojPath) ? resolve(gprojPath) : null;
  if (!addonName) return null;
  const dir = join(config.projectPath, addonName);
  if (!existsSync(dir)) return null;
  const g = readdirSync(dir).find((f) => f.endsWith(".gproj"));
  return g ? join(dir, g) : null;
}
