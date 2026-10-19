import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config.js";
import { readGproj, resolveGproj } from "../workbench/cli.js";
import { findPids, killPids, spawnDetached, newestDir, sleep } from "../utils/process.js";

const GAME_EXE = "ArmaReforgerSteam.exe";
const GAME_DIAG_EXE = "ArmaReforgerSteamDiag.exe"; // needed for -client / -world
const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

export function registerGame(server: McpServer, config: Config): void {
  server.registerTool(
    "game",
    {
      description:
        "Start / stop the Arma Reforger game client for testing: load local packed addons (built with `mod` build), " +
        "join a server directly (connect=IP[:port], e.g. the local `server start`), or open a world straight away. " +
        "'logs' tails the client console log (script errors at runtime).",
      inputSchema: {
        action: z.enum(["launch", "stop", "status", "logs"]),
        addons: z.array(z.string()).optional().describe("(launch) Local addon folder names to load from their packed build"),
        connect: z.string().optional().describe("(launch) Join this server, e.g. '127.0.0.1' or '127.0.0.1:2001' (uses the Diag exe)"),
        world: z.string().optional().describe("(launch) World to load on start, e.g. 'worlds/MP/MPTest.ent' (uses the Diag exe)"),
        windowed: z.boolean().optional().describe("(launch) Windowed mode"),
        extraArgs: z.array(z.string()).optional().describe("(launch) Extra CLI args"),
        force: z.boolean().optional().describe("(stop) Kill instead of asking to close"),
        lines: z.number().int().min(1).max(2000).default(80),
        errorsOnly: z.boolean().optional().describe("(logs) Only (E)/(W)/(F) lines"),
      },
    },
    async (a) => {
      const logsDir = join(homedir(), "Documents", "My Games", "ArmaReforger", "logs");
      const running = () => [...findPids(GAME_EXE), ...findPids(GAME_DIAG_EXE)];
      try {
        if (a.action === "launch") {
          if (running().length) return text("The game is already running — `game stop` first.", true);
          const diag = !!(a.connect || a.world);
          const exe = join(config.gamePath, diag ? GAME_DIAG_EXE : GAME_EXE);
          if (!existsSync(exe)) return text(`Not found: ${exe} (set ENFUSION_GAME_PATH)`, true);
          const args: string[] = ["-noSplash"];
          const guids: string[] = [];
          for (const name of a.addons ?? []) {
            const gproj = resolveGproj(config, name);
            const id = gproj ? readGproj(gproj).id || name : name;
            const packed = join(config.packedPath, id);
            const g = existsSync(packed) ? readdirSync(packed).find((f) => f.endsWith(".gproj")) : undefined;
            if (!g || !existsSync(join(packed, "data.pak"))) return text(`Addon "${name}" is not packed in ${packed}. Run \`mod\` action build first.`, true);
            guids.push(readGproj(join(packed, g)).guid);
          }
          if (guids.length) args.push("-addonsDir", config.packedPath, "-addons", guids.join(","));
          if (a.connect) args.push("-client", a.connect);
          if (a.world) args.push("-world", a.world);
          if (a.windowed) args.push("-window");
          args.push(...(a.extraArgs ?? []));
          const pid = spawnDetached(exe, args, config.gamePath);
          await sleep(3000);
          return text(`**Game launched** (pid ${pid})\n\n${diag ? GAME_DIAG_EXE : GAME_EXE} ${args.join(" ")}`);
        }

        if (a.action === "stop") {
          const pids = running();
          if (!pids.length) return text("The game is not running.");
          killPids(pids, a.force);
          for (let i = 0; i < 20 && running().length; i++) await sleep(500);
          return running().length ? text("Game still running — retry with force=true.", true) : text("**Game closed.**");
        }

        if (a.action === "status") {
          const pids = running();
          return text(`Game: ${pids.length ? `running (pid ${pids.join(", ")})` : "not running"}\nInstall: ${config.gamePath}\nLogs: ${newestDir(logsDir) ?? logsDir}`);
        }

        // logs
        const dir = newestDir(logsDir);
        const file = dir ? join(dir, "console.log") : "";
        if (!file || !existsSync(file)) return text(`No client logs in ${logsDir}.`, true);
        const all = readFileSync(file, "utf-8").split(/\r?\n/);
        const shown = (a.errorsOnly ? all.filter((l) => /\((E|W|F)\)/.test(l)) : all).slice(-a.lines);
        return text(`**${file}**\n\n\`\`\`\n${shown.join("\n")}\n\`\`\``);
      } catch (e) {
        return text(`game ${a.action} failed: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    }
  );
}
