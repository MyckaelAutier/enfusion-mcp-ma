import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config.js";
import { findWorkbenchExe, findGproj } from "../utils/game-paths.js";
import { findPids } from "../utils/process.js";
import { gameGuidMap } from "../pak/rdb.js";
import type { WorkbenchClient } from "../workbench/client.js";

const CONFIG_KEYS = ["workbenchPath", "gamePath", "projectPath", "serverPath", "steamcmdPath", "serverProfilePath", "packedPath"] as const;

export function registerEnvCheck(server: McpServer, config: Config, client: WorkbenchClient): void {
  server.registerTool(
    "env_check",
    {
      description:
        "Health check of the whole modding setup — game, Arma Reforger Tools (Workbench Diag exe), dedicated server, SteamCMD, " +
        "project/packed/profile folders, running processes, Workbench NET API, game version and resource database — with the " +
        "fix for anything missing. 'configure' saves paths to ~/.enfusion-mcp/config.json. Run this first on a new machine.",
      inputSchema: {
        action: z.enum(["check", "configure"]).default("check"),
        settings: z.record(z.string()).optional()
          .describe(`(configure) Any of: ${CONFIG_KEYS.join(", ")}`),
      },
    },
    async ({ action, settings }) => {
      if (action === "configure") {
        const file = join(homedir(), ".enfusion-mcp", "config.json");
        const current = existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : {};
        const bad = Object.keys(settings ?? {}).filter((k) => !(CONFIG_KEYS as readonly string[]).includes(k));
        if (bad.length) return { content: [{ type: "text", text: `Unknown setting(s): ${bad.join(", ")}` }], isError: true };
        Object.assign(current, settings);
        Object.assign(config, settings); // effective immediately for this session
        mkdirSync(join(homedir(), ".enfusion-mcp"), { recursive: true });
        writeFileSync(file, JSON.stringify(current, null, 2));
        return { content: [{ type: "text", text: `Saved ${file}:\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\`` }] };
      }

      const ok = (b: boolean) => (b ? "✅" : "❌");
      const lines: string[] = ["## Environment", ""];
      const gameExe = join(config.gamePath, "ArmaReforgerSteam.exe");
      const gameDiag = join(config.gamePath, "ArmaReforgerSteamDiag.exe");
      const wbExe = findWorkbenchExe(config.workbenchPath);
      const serverExe = join(config.serverPath, process.platform === "win32" ? "ArmaReforgerServer.exe" : "ArmaReforgerServer");
      const steamcmd = join(config.steamcmdPath, process.platform === "win32" ? "steamcmd.exe" : "steamcmd.sh");

      let version = "";
      const wbLogs = join(config.projectPath, "..", "logs");
      try {
        const latest = existsSync(wbLogs) ? readdirSync(wbLogs).sort().reverse().find((d) => existsSync(join(wbLogs, d, "console.log"))) : undefined;
        if (latest) version = readFileSync(join(wbLogs, latest, "console.log"), "utf-8").match(/version (\d+\.\d+\.\d+\.\d+)/)?.[1] ?? "";
      } catch { /* ignore */ }

      lines.push(
        `${ok(existsSync(gameExe))} Game: ${config.gamePath}${version ? ` (v${version})` : ""}`,
        `${ok(existsSync(gameDiag))} Game Diag exe (needed for game launch connect/world)`,
        `${ok(!!wbExe)} Workbench: ${wbExe ?? `${config.workbenchPath} — install "Arma Reforger Tools" from Steam`}`,
        `${ok(existsSync(serverExe))} Dedicated server: ${existsSync(serverExe) ? config.serverPath : "not installed — `server install`"}`,
        `${ok(existsSync(steamcmd))} SteamCMD: ${existsSync(steamcmd) ? config.steamcmdPath : "not downloaded (server install does it)"}`,
      );
      let guidCount = 0;
      try { guidCount = gameGuidMap(config.gamePath).size; } catch { /* ignore */ }
      lines.push(`${ok(guidCount > 0)} Base-game resource database: ${guidCount} resources with GUIDs`);

      const addons = existsSync(config.projectPath)
        ? readdirSync(config.projectPath, { withFileTypes: true }).filter((e) => e.isDirectory() && findGproj(join(config.projectPath, e.name))).map((e) => e.name)
        : [];
      lines.push(
        "",
        `${ok(existsSync(config.projectPath))} Addons (projectPath): ${config.projectPath} — ${addons.length} addon(s)${addons.length ? `: ${addons.slice(0, 15).join(", ")}` : ""}`,
        `- Packed builds: ${config.packedPath}${existsSync(config.packedPath) ? ` (${readdirSync(config.packedPath).length})` : " (created on first build)"}`,
        `- Server profile: ${config.serverProfilePath}`,
        "",
        "## Running",
        `- Workbench: ${findPids("ArmaReforgerWorkbenchSteamDiag.exe").length ? "yes" : "no"} · NET API: ${(await client.ping()) ? "responding" : "not reachable"} (${config.workbenchHost}:${config.workbenchPort})`,
        `- Game: ${[...findPids("ArmaReforgerSteam.exe"), ...findPids("ArmaReforgerSteamDiag.exe")].length ? "yes" : "no"}`,
        `- Dedicated server: ${findPids("ArmaReforgerServer.exe").length ? "yes" : "no"}`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
