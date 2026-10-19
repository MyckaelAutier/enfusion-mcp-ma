import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import { generateServerConfig, validateAgainstSchema } from "../templates/server-config.js";
import { gameGuidMap } from "../pak/rdb.js";
import { baseReader } from "./config-override.js";
import { readGproj, resolveGproj } from "../workbench/cli.js";
import { findPids, killPids, spawnDetached, newestDir, sleep } from "../utils/process.js";

const IS_WIN = process.platform === "win32";
const SERVER_APP_ID = "1874900"; // Arma Reforger Dedicated Server (anonymous login)
const SERVER_EXE = IS_WIN ? "ArmaReforgerServer.exe" : "ArmaReforgerServer";
const STEAMCMD_EXE = IS_WIN ? "steamcmd.exe" : "steamcmd.sh";
const STEAMCMD_URL = IS_WIN
  ? "https://steamcdn-media.akamaihd.net/client/installer/steamcmd.zip"
  : "https://steamcdn-media.akamaihd.net/client/installer/steamcmd_linux.tar.gz";

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

async function ensureSteamcmd(config: Config): Promise<string> {
  const exe = join(config.steamcmdPath, STEAMCMD_EXE);
  if (existsSync(exe)) return exe;
  mkdirSync(config.steamcmdPath, { recursive: true });
  const res = await fetch(STEAMCMD_URL);
  if (!res.ok) throw new Error(`Downloading SteamCMD failed: HTTP ${res.status}`);
  const archive = join(config.steamcmdPath, IS_WIN ? "steamcmd.zip" : "steamcmd.tar.gz");
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  if (IS_WIN) {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${config.steamcmdPath}'`], { windowsHide: true });
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", config.steamcmdPath]);
  }
  if (!existsSync(exe)) throw new Error(`SteamCMD archive did not contain ${STEAMCMD_EXE}`);
  return exe;
}

/** server.json schema shipped with the game data (backend/DSConfigSchema.json). */
function loadSchema(config: Config): Record<string, any> | null {
  const t = baseReader(config)("backend/DSConfigSchema.json");
  return t ? JSON.parse(t) : null;
}

function serverLogsDir(config: Config): string {
  return join(config.serverProfilePath, "logs");
}

function tail(file: string, lines: number, filter?: RegExp): string {
  if (!existsSync(file)) return "(no log yet)";
  const all = readFileSync(file, "utf-8").split(/\r?\n/);
  return (filter ? all.filter((l) => filter.test(l)) : all).slice(-lines).join("\n");
}

export function listScenarios(config: Config): Array<{ id: string; name: string }> {
  const read = baseReader(config);
  const out: Array<{ id: string; name: string }> = [];
  for (const e of gameGuidMap(config.gamePath).values()) {
    if (!/^Missions\/[^/]+\.conf$/i.test(e.path)) continue;
    const t = read(e.path) ?? "";
    if (!/SCR_MissionHeader|MissionHeader/.test(t.slice(0, 300))) continue;
    out.push({ id: `{${e.guid}}${e.path}`, name: t.match(/m_sName\s+"([^"]+)"/)?.[1] ?? "" });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function registerServer(server: McpServer, config: Config): void {
  server.registerTool(
    "server",
    {
      description:
        "Run an Arma Reforger dedicated server locally for testing mods: 'install'/'update' (SteamCMD, anonymous, app 1874900 — " +
        "downloads SteamCMD itself), 'config' (write server.json from options, validated against the game's own schema), " +
        "'validate' (check any server.json), 'start' (with local packed addons and/or Workshop mods), 'stop', 'status', " +
        "'logs' (tail / errors only), 'scenarios' (all scenario IDs of the game).",
      inputSchema: {
        action: z.enum(["install", "update", "config", "validate", "start", "stop", "status", "logs", "scenarios"]),
        configPath: z.string().optional().describe("(start/validate/config) server.json path. Default <serverProfilePath>/server.json"),
        // config options
        name: z.string().optional().describe("(config/start) Server name"),
        scenarioId: z.string().optional().describe("(config/start) e.g. {ECC61978EDCC2B5A}Missions/23_Campaign.conf — see action scenarios"),
        maxPlayers: z.number().int().min(1).max(256).optional(),
        port: z.number().int().optional().describe("UDP game port (default 2001)"),
        password: z.string().optional(),
        passwordAdmin: z.string().optional().describe("Admin login password (#login in chat)"),
        admins: z.array(z.string()).optional().describe("Admin identity IDs"),
        visible: z.boolean().optional().describe("List in the server browser (default false)"),
        crossPlatform: z.boolean().optional(),
        battlEye: z.boolean().optional(),
        workshopMods: z.array(z.object({ modId: z.string(), name: z.string().optional(), version: z.string().optional() })).optional()
          .describe("(config/start) Published Workshop mods to download and load"),
        rconPassword: z.string().optional().describe("Enable RCON with this password"),
        autoSaveInterval: z.number().optional().describe("Persistence autosave interval in minutes"),
        aiLimit: z.number().int().optional(),
        // start options
        addons: z.array(z.string()).optional()
          .describe("(start) Local addon folder names to load from their packed build (run `mod` build first)"),
        extraArgs: z.array(z.string()).optional().describe("(start) Extra server CLI args, e.g. ['-maxFPS','60']"),
        // stop/logs
        force: z.boolean().optional().describe("(stop) Kill instead of asking to close"),
        lines: z.number().int().min(1).max(2000).default(80).describe("(logs) Lines to show"),
        errorsOnly: z.boolean().optional().describe("(logs) Only (E)/(W)/(F) lines"),
        filter: z.string().optional().describe("(scenarios/logs) Regex filter"),
      },
    },
    async (a) => {
      try {
        const exe = join(config.serverPath, SERVER_EXE);
        const cfgPath = a.configPath ?? join(config.serverProfilePath, "server.json");

        if (a.action === "install" || a.action === "update") {
          const steamcmd = await ensureSteamcmd(config);
          mkdirSync(config.serverPath, { recursive: true });
          const log = join(config.steamcmdPath, "install-server.log");
          writeFileSync(log, "");
          const pid = spawnDetached(steamcmd, ["+force_install_dir", config.serverPath, "+login", "anonymous", "+app_update", SERVER_APP_ID, "validate", "+quit"], config.steamcmdPath, log);
          return text(
            `**Server ${a.action} started** (SteamCMD pid ${pid}) → \`${config.serverPath}\`\n\n` +
            `The download is several GB and runs in the background. Follow it with \`server status\`; ` +
            `it is done when \`${SERVER_EXE}\` exists and the log says "Success! App '${SERVER_APP_ID}' fully installed".\nLog: ${log}`
          );
        }

        if (a.action === "scenarios") {
          const re = a.filter ? new RegExp(a.filter, "i") : null;
          const list = listScenarios(config).filter((s) => !re || re.test(s.id) || re.test(s.name));
          return text(`**${list.length} scenarios**\n\n${list.map((s) => `- \`${s.id}\`${s.name ? ` — ${s.name}` : ""}`).join("\n")}`);
        }

        if (a.action === "validate") {
          if (!existsSync(cfgPath)) return text(`Not found: ${cfgPath}`, true);
          const schema = loadSchema(config);
          if (!schema) return text("Could not read backend/DSConfigSchema.json from the game data.", true);
          let json: unknown;
          try { json = JSON.parse(readFileSync(cfgPath, "utf-8")); } catch (e) { return text(`Invalid JSON: ${e}`, true); }
          const errs = validateAgainstSchema(json, schema);
          return text(errs.length ? `**${errs.length} problem(s)** in ${cfgPath}\n\n${errs.map((e) => `- ${e}`).join("\n")}` : `**Valid** — ${cfgPath} matches the server schema.`, errs.length > 0);
        }

        if (a.action === "config" || (a.action === "start" && (a.name || a.scenarioId || !existsSync(cfgPath)))) {
          const json = generateServerConfig({
            name: a.name ?? "Enfusion MCP test server",
            scenarioId: a.scenarioId, maxPlayers: a.maxPlayers, port: a.port, password: a.password,
            passwordAdmin: a.passwordAdmin, admins: a.admins, visible: a.visible, crossPlatform: a.crossPlatform,
            battlEye: a.battlEye, mods: a.workshopMods, rconPassword: a.rconPassword, autoSaveInterval: a.autoSaveInterval, aiLimit: a.aiLimit,
          });
          const schema = loadSchema(config);
          const errs = schema ? validateAgainstSchema(JSON.parse(json), schema) : [];
          if (errs.length) return text(`Generated config is invalid:\n${errs.map((e) => `- ${e}`).join("\n")}`, true);
          mkdirSync(join(cfgPath, ".."), { recursive: true });
          writeFileSync(cfgPath, json, "utf-8");
          if (a.action === "config") return text(`**server.json written** → \`${cfgPath}\`${schema ? " (schema-valid)" : ""}\n\n\`\`\`json\n${json}\n\`\`\``);
        }

        if (a.action === "start") {
          if (!existsSync(exe)) return text(`Dedicated server not installed at ${config.serverPath}. Run \`server install\` first (or set ENFUSION_SERVER_PATH).`, true);
          if (findPids(SERVER_EXE).length) return text("A dedicated server is already running — `server stop` first.", true);
          const args = ["-config", cfgPath, "-profile", config.serverProfilePath, "-maxFPS", "60", "-logStats", "60000", "-noThrow"];
          const guids: string[] = [];
          for (const name of a.addons ?? []) {
            const gproj = resolveGproj(config, name);
            const id = gproj ? readGproj(gproj).id || name : name;
            const packed = join(config.packedPath, id);
            if (!existsSync(join(packed, "data.pak"))) return text(`Addon "${name}" has no packed build in ${packed}. Run \`mod\` action build first.`, true);
            const g = readdirSync(packed).find((f) => f.endsWith(".gproj"));
            guids.push(readGproj(join(packed, g!)).guid);
          }
          if (guids.length) args.push("-addonsDir", config.packedPath, "-addons", guids.join(","));
          args.push(...(a.extraArgs ?? []));
          mkdirSync(config.serverProfilePath, { recursive: true });
          const started = Date.now();
          const pid = spawnDetached(exe, args, config.serverPath);
          await sleep(8000);
          const logDir = newestDir(serverLogsDir(config), started - 5000);
          const alive = findPids(SERVER_EXE).length > 0;
          return text(
            `**Server ${alive ? "running" : "exited early"}** (pid ${pid})\n\nCommand: ${SERVER_EXE} ${args.join(" ")}\n` +
            (logDir ? `Logs: ${logDir}\n\n\`\`\`\n${tail(join(logDir, "console.log"), 25)}\n\`\`\`` : "") +
            `\n\nJoin from the game: \`game launch\` with connect=127.0.0.1:${a.port ?? 2001} (and the same local addons).`,
            !alive
          );
        }

        if (a.action === "stop") {
          const pids = findPids(SERVER_EXE);
          if (!pids.length) return text("No dedicated server running.");
          killPids(pids, a.force);
          for (let i = 0; i < 20 && findPids(SERVER_EXE).length; i++) await sleep(500);
          if (findPids(SERVER_EXE).length && !a.force) return text("Server is still shutting down (or ignored the request) — retry with force=true.", true);
          return text(`**Server stopped** (pid ${pids.join(", ")}).`);
        }

        if (a.action === "status") {
          const pids = findPids(SERVER_EXE);
          const logDir = newestDir(serverLogsDir(config));
          const installLog = join(config.steamcmdPath, "install-server.log");
          const installing = findPids(STEAMCMD_EXE).length > 0;
          return text([
            `**Dedicated server**`,
            `- Installed: ${existsSync(exe) ? `yes (${config.serverPath})` : "no — `server install`"}`,
            `- SteamCMD: ${installing ? "running (install/update in progress)" : existsSync(join(config.steamcmdPath, STEAMCMD_EXE)) ? "present" : "not downloaded"}`,
            `- Running: ${pids.length ? `yes (pid ${pids.join(", ")})` : "no"}`,
            `- Config: ${existsSync(cfgPath) ? cfgPath : "none yet (`server config`)"}`,
            `- Profile: ${config.serverProfilePath}`,
            logDir ? `- Latest log: ${logDir}` : "",
            existsSync(installLog) ? `\nInstall log (last lines):\n\`\`\`\n${tail(installLog, 8)}\n\`\`\`` : "",
          ].filter(Boolean).join("\n"));
        }

        if (a.action === "logs") {
          const logDir = newestDir(serverLogsDir(config));
          if (!logDir) return text(`No server logs in ${serverLogsDir(config)} yet.`, true);
          const re = a.errorsOnly ? /\((E|W|F)\)/ : a.filter ? new RegExp(a.filter, "i") : undefined;
          return text(`**${join(logDir, "console.log")}**\n\n\`\`\`\n${tail(join(logDir, "console.log"), a.lines, re)}\n\`\`\``);
        }

        return text(`Unknown action ${a.action}`, true);
      } catch (e) {
        return text(`server ${a.action} failed: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    }
  );
}
