import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerServerModPrompt(server: McpServer): void {
  server.registerPrompt(
    "server-mod",
    {
      title: "Server tuning mod (XP, costs, ranks, rules) + test server",
      description:
        "Guided workflow for a server-side mod: change XP rewards, rank thresholds, arsenal / respawn supply costs or any " +
        "other game value through config overrides (plus scripts when logic must change), build it and run it on a local dedicated server.",
      argsSchema: {
        goal: z.string().describe("What the server should do differently, e.g. 'double XP, cheaper rifles, snipers need sergeant'"),
        modName: z.string().optional().describe("Addon folder name (created if missing)"),
      },
    },
    ({ goal, modName }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Build an Arma Reforger server mod${modName ? ` named "${modName}"` : ""}: ${goal}

You are autonomous — do every step yourself.

1. **env_check** — make sure game, Workbench and (for testing) the dedicated server are available. If the server is
   missing, run **server** action 'install' and follow it with 'status' while you work.
2. Create the addon if needed: **mod** action 'create' (bare scaffold, no pattern).
3. Values first — prefer data over scripts:
   - **economy** 'inspect' then 'set' for: xp (reward IDs like ENEMY_KILL, BASE_SEIZED), ranks (PRIVATE…COLONEL
     thresholds), arsenal (item supply cost / required rank by prefab regex), loadouts (respawn supply cost / rank).
   - Anything else (AI limits in game modes, timers, faction settings, vehicle / prefab properties): find the file
     with **asset_search** or **game_browse**, look at it with **config_override** 'inspect' (filter to the property),
     then 'set'. Never copy a whole base config: overrides are deltas keyed by object IDs with the base GUID.
4. Only if behaviour (not values) must change: **api_search** every class/method you use, write a \`modded class\`
   with **script_create** / **project**, then **mod** 'compile' until it reports OK.
5. **mod** 'build'.
6. Test: **server** 'config' (scenario from 'scenarios', e.g. Conflict {ECC61978EDCC2B5A}Missions/23_Campaign.conf),
   **server** 'start' with addons ["<modName>"], **server** 'logs' errorsOnly; optionally **game** 'launch' with
   connect 127.0.0.1 and the same addons to check in game. Stop both when done.
7. Report what changed (old → new values), where the packed addon is, and that for a public server the mod must be
   published on the Workshop and listed in server.json "mods" (clients download it automatically).`,
          },
        },
      ],
    })
  );
}
