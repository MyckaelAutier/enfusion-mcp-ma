---
name: arma-reforger-modding
description: Use for anything Arma Reforger / Enfusion — creating or fixing mods, Enforce Script, prefabs, configs, UI layouts, Workbench, compiling/packing addons, running the game or a dedicated server, server tuning (XP, ranks, supply costs, AI limits). Triggers - "mod Arma Reforger", "Reforger mod", "Workbench", "Enforce script", "serveur Arma", "XP", "dedicated server".
---

# Arma Reforger modding with enfusion-mcp

The `enfusion-mcp` tools do the whole job. Never ask the user to open Workbench or build by hand.

1. On a new machine, start with `env_check`. It reports the game, Workbench, server and paths, and how to fix what is missing.
2. Research before writing code. Use `api_search` for every class and method you call (the index is the 1.8 API), plus `wb_knowledge`, `asset_search` (gives `{GUID}path`) and `game_read`. If a method isn't found, don't use it.
3. Create the addon with `mod` create, then write scripts, prefabs, layouts and configs with the generators.
4. For values (XP, ranks, arsenal/respawn costs) use `economy`. For any other base-game setting use `config_override`. Both write overrides: same path, base GUID, delta only.
5. Run `mod` compile until it reports OK. Fix errors at the `file:line` it gives. Close Workbench first (`wb_close`) if it is open.
6. `mod` build packs the addon for the game and the server.
7. Test it:
   - in game: `game` launch with addons, then `game` logs (errorsOnly);
   - on a server: `server` status / install / config / start with addons, then `server` logs, then `game` launch with connect `127.0.0.1`.
8. Live editor work: `wb_launch` → `wb_*` → `wb_close` → `wb_cleanup` (remove the handler scripts before publishing).

Guided prompts: `/create-mod`, `/modify-mod`, `/server-mod`.
