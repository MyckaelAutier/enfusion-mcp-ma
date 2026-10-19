# enfusion-mcp-ma

An **MCP** (Model Context Protocol) server that turns Claude into a complete **Arma Reforger** modding workshop.
It knows the game's API, reads the game files directly, creates mods, **compiles and packs them itself**, starts
the **game** and a **dedicated server** to test them, and can tune a **server's economy** (XP, ranks, supply
costs…) without writing a single line of script.

> Fork of [steffenbk/enfusion-mcp-BK](https://github.com/steffenbk/enfusion-mcp-BK), updated for **Arma Reforger 1.8**
> and heavily extended (see [What's new in this fork](#whats-new-in-this-fork)).

---

## Contents

- [What it does](#what-it-does)
- [What's new in this fork](#whats-new-in-this-fork)
- [Requirements](#requirements)
- [Installation](#installation)
- [Getting started](#getting-started)
- [Building a mod from A to Z](#building-a-mod-from-a-to-z)
- [Server mods: XP, ranks, costs](#server-mods-xp-ranks-costs)
- [Local dedicated server](#local-dedicated-server)
- [Tool reference](#tool-reference)
- [Guided prompts](#guided-prompts)
- [Configuration](#configuration)
- [Bundled data and updating it](#bundled-data-and-updating-it)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Credits and license](#credits-and-license)

---

## What it does

Describe what you want and Claude takes care of the rest:

- *"Make a Conflict server mod: double XP, rifles 30% cheaper, the M249 requires the sergeant rank."*
- *"Create a HUD that shows the player's health and stamina."*
- *"A survival game mode with zombie waves."*
- *"A CSAT faction with desert camo."*
- *"Start a local server on Conflict Everon with my mod and connect me to it."*

In practice, Claude:

1. **Researches** the 1.8 API (8,984 classes, their methods, 251 global enums), the knowledge base, the BI wiki and
   the game files. The files are read straight from the `.pak` archives, with the GUID of every resource.
2. **Generates** the addon: `.gproj`, Enforce scripts, prefabs, configs, UI layouts, overrides.
3. **Compiles** the scripts with a headless Workbench and fixes the errors (`file:line`).
4. **Packs** the addon (`data.pak` + `.gproj` + `resourceDatabase.rdb`), the format the game and the server load.
5. **Tests** it: starts the game with the mod, or installs and starts a dedicated server, then reads the logs.
6. Drives **Workbench live** when needed (entities, layers, prefabs, scenarios…), then closes it cleanly.

---

## What's new in this fork

**Data updated for 1.8**
- API index rebuilt from Workbench's **1.8.0** docs: 8,984 classes (up from 8,693), core types (`string`,
  `array`, `vector`, `map`…) included, **251 global enums** added, detailed descriptions and the source file of
  every class.
- Fixed: about 20% of method names were corrupted (`SourceToEntityIEntitySource`) and therefore unsearchable.
- Methods that Doxygen dropped are recovered (e.g. `WorldEditorAPI.DeleteEntity`, `LockEntityLayer`).
- Rewritten scraper: from Workbench's local docs or from the BI website (`npm run scrape` / `npm run scrape:remote`).

**New tools**
- `mod`: `compile` (headless Workbench, errors as `file:line`), `pack`, and `build` = compile + pack. The old
  `build` hung forever.
- `config_override`: override any game config or prefab, like Workbench's "Override in addon", but without Workbench.
- `economy`: XP, rank thresholds, arsenal costs, loadout respawn costs, with a multiplier or exact values.
- `server`: SteamCMD install, config validated against the game's official schema, start/stop/status/logs, scenarios.
- `game`: starts the game with your addons, connects to a server, reads the logs, closes it.
- `env_check`: full health check of the setup, and saving of custom paths.
- `wb_close`: closes Workbench cleanly.
- `/server-mod` prompt.
- `resourceDatabase.rdb` reader: **GUIDs of every game resource** (105,000+), used by `asset_search`, the
  overrides and duplication.

**Fixes verified against the real game**
- `server_config` generated removed keys (`gameHostBindPort`…) that a 1.8 server rejects.
- `game_duplicate` never found any file, because the game is fully packed.
- `asset_search` truncated paths (`Prefabs/` went missing) and had almost no GUIDs.
- `wb_state` reported "game mode" with no world open; `wb_projects` saw no projects; `wb_open_resource` reported
  success on failure; `wb_execute_action` ignored the target module.
- Prefab recipes: non-existent components and paths (`RotorComponent`, `Soldier_Base.et`…) replaced with the real
  ones. `npm run check:recipes` checks them against the `.pak` files.
- Gamemode recipes and knowledge base rewritten for the 1.8 API: `SaveGameManager`, the new `CanPlayerSpawn_S`
  signature, `IsHQRadioTrafficPossible`.
- `script_create` no longer generates impossible `override proto …` methods or empty getters.

---

## Requirements

| | |
|---|---|
| **Windows 10/11** | Workbench only exists on Windows |
| **Node.js 20+** | `node --version` |
| **Arma Reforger** (Steam) | the game, to read its data and to test |
| **Arma Reforger Tools** (Steam) | Workbench `ArmaReforgerWorkbenchSteamDiag.exe`, to compile and pack |
| *(optional)* Arma Reforger Server | `server install` downloads it for you through SteamCMD |

---

## Installation

One command, nothing to clone. All you need is **Node.js 20+**.

### Option A: Claude Code plugin (recommended)

In Claude Code:

```
/plugin marketplace add MyckaelAutier/enfusion-mcp-ma
/plugin install enfusion-mcp-ma@enfusion-mcp-ma
```

The plugin installs the MCP server (from npm, always the latest version) and a skill that teaches Claude the right
Arma Reforger workflow.

### Option B: MCP server only

```bash
claude mcp add --scope user enfusion-mcp -- cmd /c npx -y enfusion-mcp-ma@latest
```

### Option C: Claude Desktop

`%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "enfusion-mcp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "enfusion-mcp-ma@latest"]
    }
  }
}
```

In every case, restart Claude, then check with `/mcp` that `enfusion-mcp` is connected. The very first start
downloads the package (about 6 MB); later starts are instant.

> Had the old package (`npx -y enfusion-mcp`, stuck at 0.6.1)? Remove it first:
> `claude mcp remove enfusion-mcp --scope user`.

**Updating**: with `@latest`, the newest published package is used on every start. For the plugin:
`/plugin marketplace update enfusion-mcp-ma`.

---

## Getting started

Just ask Claude: **"run env_check"**. You get something like:

```
✅ Game: C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger (v1.8.0.13)
✅ Game Diag exe (needed for game launch connect/world)
✅ Workbench: …\Arma Reforger Tools\Workbench\ArmaReforgerWorkbenchSteamDiag.exe
❌ Dedicated server: not installed — `server install`
✅ Base-game resource database: 105482 resources with GUIDs
✅ Addons (projectPath): …\ArmaReforgerWorkbench\addons — 5 addon(s)
```

If a path is non-standard: *"env_check configure gamePath = D:\Steam\…\Arma Reforger"*. It is saved to
`~/.enfusion-mcp/config.json`.

---

## Building a mod from A to Z

The full cycle, which Claude runs on its own:

| Step | Tool | Detail |
|---|---|---|
| 1. Research | `api_search`, `wb_knowledge`, `wiki_search`, `asset_search`, `game_read` | never invents a method |
| 2. Create the addon | `mod` `create` | `.gproj` + folder layout, 10 patterns available |
| 3. Write | `script_create`, `prefab`, `layout_create`, `menu_create`, `config_create`, `config_override`, `economy`, `project` | |
| 4. Check | `mod` `validate` | static checks, no Workbench needed |
| 5. **Compile** | `mod` `compile` | headless Workbench (~5 s), errors as `file:line` |
| 6. **Pack** | `mod` `build` | compile then pack → `Documents/My Games/ArmaReforgerWorkbench/packed/<Addon>` |
| 7. Test in game | `game` `launch` (addons, connect, world) → `game` `logs` → `game` `stop` | |
| 8. Test multiplayer | `server` `config` → `start` → `logs` + `game` `launch` connect `127.0.0.1` | |
| 9. Editor (optional) | `wb_launch` → `wb_*` → `wb_close` → `wb_cleanup` | placing entities, worlds, scenarios |
| 10. Publish | Workbench → *Publish* | the Workshop remains a manual step |

Example `mod` `compile` output on an error:

```
**Scripts:** FAILED (4s)

### Errors in this addon
- `Scripts/Game/MCT_Broken.c:5` Unknown type 'UnknownType'
```

---

## Server mods: XP, ranks, costs

Economy values live in **game configs**. To change them, a mod ships an **override**: a file at the same path as
the original, with a `.meta` carrying **the same GUID**, containing only the **delta** (each changed object is
addressed by its `{ID}`). That is what Workbench's "Override in addon" does, and what `economy` and
`config_override` generate. Values you don't mention keep the game's values, and Bohemia's updates keep applying.

### `economy`: the common settings

| Category | Game files | Value | Key |
|---|---|---|---|
| `xp` | `Configs/Campaign/XPRewards.conf` + `CampaignXPRewards.conf` (Conflict) | `m_iRewardXP` | reward ID: `ENEMY_KILL`, `BASE_SEIZED`, `RELAY_RECONFIGURED`… |
| `ranks` | `Configs/Ranks/BaseMilitaryRanks.conf` + FIA | `m_iRequiredXP` | `PRIVATE`, `CORPORAL`, `SERGEANT`… |
| `arsenal` | `Configs/EntityCatalog/<Faction>/InventoryItems_EntityCatalog_<Faction>.conf` | `m_iSupplyCost`, `m_eRequiredRank` | regex on the prefab (`M16`, `AK74\|PKM`) |
| `loadouts` | `Configs/EntityCatalog/<Faction>/Characters_EntityCatalog_<Faction>.conf` | `m_fSpawnSupplyCost`, `m_eRequiredRank` | regex on the prefab (`Sniper`, `MG`) |

Example requests: *"economy inspect xp"*, *"double XP but keep the penalties"*, *"M16 rifles cost 6 supplies"*,
*"the US sniper costs 150 to respawn and requires sergeant"*.

Equivalent raw call:

```json
{ "action": "set", "category": "xp", "modName": "MyServer", "multiplier": 2, "values": { "ENEMY_KILL": 50 } }
```

Output:

```
- Configs/Campaign/XPRewards.conf (GUID {E6FC4537B53EA00B}) — 5 change(s):
  - SCR_XPRewardInfo {51BC713E81C18CF3} [m_eRewardID=ENEMY_KILL] · m_iRewardXP: 20 → 50
  - SCR_XPRewardInfo {5E0E812546D6087F} [m_eRewardID=VETERANCY] · m_iRewardXP: 75 → 150
```

With `multiplier`, only **gains** (positive values) are scaled for `xp` and `ranks`. To change a penalty, give its
exact value.

### `config_override`: any game value

1. Find the file: `asset_search` (e.g. "GameMode_Campaign") or `game_browse`.
2. `config_override` `inspect` with a `filter`: the effective objects with their `{ID}`, inheritance resolved.
3. `config_override` `set` with `edits`:

```json
{
  "action": "set",
  "path": "Configs/Ranks/BaseMilitaryRanks.conf",
  "modName": "MyServer",
  "edits": [
    { "where": { "m_iRank": "^SERGEANT$" }, "property": "m_iRequiredXP", "value": "2000" },
    { "className": "SCR_RankInfoCampaign", "property": "m_iRadioRespawnCooldown", "multiply": 0.5 }
  ]
}
```

Each edit selects its objects by `id`, `className` and/or `where` (regexes on the properties of the object or of
its parents, e.g. `m_sEntityPrefab`), then applies `value`, `multiply` or `add`. Running `set` again extends the
existing override. `config_override` `list` shows a mod's overrides and flags any that are missing their `.meta`.

### Deployment

An override mod has to run **on the server**, and clients need it too. For a public server: publish it on the
Workshop, then add it to `"mods"` in `server.json` (players download it automatically). Locally: `server start` /
`game launch` with `addons: ["MyServer"]`.

---

## Local dedicated server

```text
server install       → downloads SteamCMD, then Arma Reforger Server (app 1874900, anonymous, several GB)
server status        → install progress, state, config, logs
server scenarios     → the game's 37 scenarios with their ID ({ECC61978EDCC2B5A}Missions/23_Campaign.conf…)
server config        → server.json generated AND validated against the game's backend/DSConfigSchema.json
server validate      → checks an existing server.json (unknown keys, types, formats)
server start         → starts with your packed addons (-addonsDir/-addons) and/or Workshop mods
server logs          → tail of console.log, or only the (E)/(W)/(F) lines
server stop          → clean shutdown (force=true to kill)
```

Supported config options: name, scenario, max players, port, player and admin passwords, admins, visibility,
cross-play, BattlEye, third-person view, view distances, RCON, persistence (autosave), AI limit, join queue,
mission header overrides, Workshop mods (`modId`, `version`).

Then, to join it: `game launch` with `connect: "127.0.0.1"` and the same `addons`.

Default locations: server `~/.enfusion-mcp/server`, profile, saves and logs `~/.enfusion-mcp/server-profile`,
SteamCMD `~/.enfusion-mcp/steamcmd`.

---

## Tool reference

### Build and test
| Tool | Purpose |
|---|---|
| `env_check` | full health check; `configure` saves paths |
| `mod` | `create` · `validate` · `compile` · `pack` · `build` |
| `game` | `launch` (addons, connect, world, windowed) · `stop` · `status` · `logs` |
| `server` | `install` · `update` · `config` · `validate` · `start` · `stop` · `status` · `logs` · `scenarios` |
| `server_config` | legacy `server.json` generator (aligned with the 1.8 schema) |
| `workshop_info` | Workshop metadata of a `.gproj` |

### Economy and overrides
| Tool | Purpose |
|---|---|
| `economy` | XP, ranks, arsenal costs, respawn costs (`inspect` / `set`) |
| `config_override` | generic config or prefab override (`inspect` / `set` / `list`) |
| `game_duplicate` | copies a game prefab or config into the mod, with a new GUID |

### Game knowledge
| Tool | Purpose |
|---|---|
| `api_search` | classes, methods, properties, enums of the 1.8 API (inheritance included, `format: tree`) |
| `component_search` | components by category (vehicle, weapon, AI, UI…) and events |
| `wb_knowledge` | modding knowledge base (verified patterns) |
| `wiki_search` / `wiki_read` | 274 pages: BI wiki and Doxygen tutorials |
| `asset_search` | game asset search, with their `{GUID}path` |
| `game_browse` / `game_read` | browse or read the game files (inside the `.pak` archives) |
| `prefab` `inspect` | full inheritance chain of a prefab |

### Generation
| Tool | Purpose |
|---|---|
| `script_create` | Enforce scripts (component, gamemode, action, entity, manager, modded, basic) |
| `prefab` `create` | prefabs from recipes verified against the game's real prefabs |
| `layout_create` / `layout_recipe` / `menu_create` | UI: HUDs, menus, dialogs, recipes extracted from the game |
| `config_create` | factions, mission headers, catalogs, placeables |
| `gamemode_scaffold` | a `modded SCR_GameModeCampaign` composed from features (respawn, seeding, save…) |
| `scenario_create_conflict` / `scenario_create` | full Conflict scenario; Scenario Framework objectives |
| `animation_graph` | vehicle animation graphs (authoring, inspection, validation) |
| `building_setup` | destructible building from a Blender export |
| `project` | read, write and browse the mod's files |

### Live Workbench (NET API)
`wb_launch`, `wb_close`, `wb_cleanup`, `wb_connect`, `wb_diagnose`, `wb_state`, `wb_play`, `wb_stop`, `wb_save`,
`wb_undo_redo`, `wb_open_resource`, `wb_execute_action` (with `module`), `wb_reload`, `wb_entity_create`,
`wb_entity_delete`, `wb_entity_list`, `wb_entity_inspect`, `wb_entity_modify`, `wb_entity_select`,
`wb_entity_duplicate`, `wb_component`, `wb_read_props`, `wb_terrain`, `wb_layers`, `wb_resources`, `wb_prefabs`,
`wb_clipboard`, `wb_script_editor`, `wb_localization`, `wb_projects`, `wb_validate`.

The Enforce handlers behind these tools (`mod/Scripts/WorkbenchGame/EnfusionMCP/`) are copied into the addon that
`wb_launch` opens. Remove them with `wb_cleanup` before publishing; `mod build` reminds you if they are present.

### MCP resources
| URI | Content |
|---|---|
| `enfusion://class/{className}` | full documentation of a class |
| `enfusion://pattern/{patternName}` | mod pattern |
| `enfusion://group/{groupName}` | API group and its classes |

---

## Guided prompts

| Prompt | Use |
|---|---|
| `/create-mod` | from idea to a compiled, packed and tested mod (big projects split into phases in `MODPLAN.md`) |
| `/modify-mod` | evolve an existing mod |
| `/server-mod` | server mod (XP, costs, ranks, rules) tested on a local server |

---

## Configuration

Everything is optional. Priority order: environment variables, then `~/.enfusion-mcp/config.json`, then the
repository's `enfusion-mcp.config.json`, then the defaults.

| Variable | config.json key | Default |
|---|---|---|
| `ENFUSION_WORKBENCH_PATH` | `workbenchPath` | `C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger Tools` |
| `ENFUSION_GAME_PATH` | `gamePath` | sibling `Arma Reforger` folder |
| `ENFUSION_PROJECT_PATH` | `projectPath` | `Documents\My Games\ArmaReforgerWorkbench\addons` |
| `ENFUSION_PACKED_PATH` | `packedPath` | `Documents\My Games\ArmaReforgerWorkbench\packed` |
| `ENFUSION_SERVER_PATH` | `serverPath` | `~/.enfusion-mcp/server` |
| `ENFUSION_SERVER_PROFILE` | `serverProfilePath` | `~/.enfusion-mcp/server-profile` |
| `ENFUSION_STEAMCMD_PATH` | `steamcmdPath` | `~/.enfusion-mcp/steamcmd` |
| `ENFUSION_WORKBENCH_HOST` / `_PORT` | `workbenchHost` / `workbenchPort` | `127.0.0.1` / `5775` |
| `ENFUSION_DEFAULT_MOD` | `defaultMod` | addon opened by `wb_launch` |
| `ENFUSION_EXTRACTED_PATH` | `extractedPath` | `…/extracted` if it exists |

---

## Bundled data and updating it

| Data | Content | Source |
|---|---|---|
| `data/api/` | 8,984 classes, 128,000+ methods, enums, groups, hierarchy | Workbench 1.8 Doxygen |
| `data/wiki/` | 274 pages (BI wiki and tutorials) | BI wiki and Doxygen |
| `data/kb/` | distilled modding patterns | written and verified |
| `data/recipes/` | prefab and gamemode feature recipes | verified against the 1.8 `.pak` files |
| at runtime | files and GUIDs of the installed game | `.pak` + `resourceDatabase.rdb` |

After a game update:

```bash
npm run scrape          # rebuild the API from Arma Reforger Tools/Workbench/docs (recommended)
npm run scrape:remote   # or from community.bistudio.com (often one version behind)
npm run check:recipes   # check that recipes still point to existing prefabs/components
npm run build
```

The BI website protects some pages with a Cloudflare challenge. Remote mode then takes those pages from Workbench's
local docs.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `mod compile` refuses: "Workbench is open" | `wb_close` first. Two Workbench instances on the same addon can crash the open one. `force: true` to override. |
| "no world is open in the World Editor" | open a world (`wb_open_resource` on a `.ent`) before using the entity tools |
| `wb_reload`: "Reload not confirmed" | Workbench 1.8 exposes no reliable menu action for it; use `mod compile` |
| Override has no effect | `config_override list`: the `.meta` must exist with the original GUID; rebuild with `mod build` |
| The server stops right away | `server logs errorsOnly: true`; `server validate` on the config |
| Logs | Workbench: `Documents/My Games/ArmaReforgerWorkbench/logs` · game: `Documents/My Games/ArmaReforger/logs` · server: `~/.enfusion-mcp/server-profile/logs` |

---

## Development

```bash
git clone https://github.com/MyckaelAutier/enfusion-mcp-ma.git
cd enfusion-mcp-ma
npm install
npm run dev             # MCP server from sources (tsx)
npm test                # 634 tests (vitest)
npm run build           # dist/
npm run scrape          # rebuild data/api
npm run check:recipes   # recipes vs the installed game
npm run tuning-server   # web UI for tuning vehicle engines
npm publish             # publish enfusion-mcp-ma to npm (the build runs automatically)
```

When releasing, bump the version in `package.json`, `plugin/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json`.

Layout:

```
src/
  tools/        one file per MCP tool (mod, server, game, economy, config-override, env-check, wb-*, …)
  workbench/    NET API client, headless CLI driver (cli.ts)
  pak/          .pak reader (VFS) and resourceDatabase.rdb
  formats/      Enfusion text parser, override engine
  scraper/      Doxygen to data/api
  templates/    generators (scripts, prefabs, layouts, server.json…)
  prompts/      /create-mod, /modify-mod, /server-mod
mod/            Enforce handlers copied into Workbench
plugin/         Claude Code plugin (.mcp.json + skill), published through .claude-plugin/marketplace.json
data/           API, wiki, KB, recipes, patterns
tests/          vitest
```

---

## Credits and license

- Original project: [steffenbk/enfusion-mcp-BK](https://github.com/steffenbk/enfusion-mcp-BK).
- Fork, 1.8 update and new tools: [MyckaelAutier](https://github.com/MyckaelAutier).
- Arma Reforger, Enfusion and Workbench are trademarks of Bohemia Interactive. This project is not affiliated with
  Bohemia Interactive.

Licensed under **MIT**, see [LICENSE](LICENSE).
