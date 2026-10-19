# enfusion-mcp — édition MyckaelAutier

Serveur **MCP** (Model Context Protocol) qui transforme Claude en atelier complet de modding **Arma Reforger** :
il connaît l'API du jeu, lit directement les fichiers du jeu, crée les mods, **les compile et les package lui-même**,
lance le **jeu** et un **serveur dédié** pour les tester, et sait régler l'**économie d'un serveur** (XP, rangs, coûts en
supplies…) sans écrire une ligne de script.

> Fork de [steffenbk/enfusion-mcp-BK](https://github.com/steffenbk/enfusion-mcp-BK), mis à jour pour **Arma Reforger 1.8**
> et largement étendu (voir [Nouveautés du fork](#nouveautés-du-fork)).

---

## Sommaire

- [Ce que ça fait](#ce-que-ça-fait)
- [Nouveautés du fork](#nouveautés-du-fork)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Premiers pas](#premiers-pas)
- [Créer un mod de A à Z](#créer-un-mod-de-a-à-z)
- [Mods serveur : XP, rangs, coûts](#mods-serveur--xp-rangs-coûts)
- [Serveur dédié local](#serveur-dédié-local)
- [Référence des outils](#référence-des-outils)
- [Prompts guidés](#prompts-guidés)
- [Configuration](#configuration)
- [Données embarquées et mise à jour](#données-embarquées-et-mise-à-jour)
- [Dépannage](#dépannage)
- [Développement](#développement)
- [Crédits et licence](#crédits-et-licence)

---

## Ce que ça fait

Tu décris ce que tu veux, Claude s'occupe du reste :

- *« Fais un mod serveur Conflict : XP doublée, les fusils coûtent 30 % de moins, la M249 demande le rang sergent. »*
- *« Crée un HUD qui affiche la santé et l'endurance du joueur. »*
- *« Mode de jeu survie avec vagues de zombies. »*
- *« Une faction CSAT avec un camouflage désert. »*
- *« Lance un serveur local sur Conflict Everon avec mon mod et connecte-moi dessus. »*

Concrètement, Claude :

1. **Cherche** dans l'API 1.8 (8 984 classes, méthodes, 251 enums globaux), la base de connaissances, le wiki BI et
   les fichiers du jeu (lus directement dans les `.pak`, avec les GUID de toutes les ressources).
2. **Génère** l'addon : `.gproj`, scripts Enforce, prefabs, configs, layouts UI, overrides.
3. **Compile** les scripts avec Workbench en mode headless et corrige les erreurs (`fichier:ligne`).
4. **Package** l'addon (`data.pak` + `.gproj` + `resourceDatabase.rdb`), le format chargé par le jeu et le serveur.
5. **Teste** : lance le jeu avec le mod, ou installe et démarre un serveur dédié, puis lit les logs.
6. Pilote **Workbench en direct** si besoin (entités, calques, prefabs, scénarios…) puis le ferme proprement.

---

## Nouveautés du fork

**Données mises à jour (1.8)**
- Index API reconstruit sur la doc **1.8.0** de Workbench : 8 984 classes (contre 8 693), types de base
  (`string`, `array`, `vector`, `map`…) inclus, **251 enums globaux** ajoutés, descriptions détaillées et fichier
  source de chaque classe.
- Corrigé : environ 20 % des noms de méthode étaient corrompus (`SourceToEntityIEntitySource`) et introuvables.
- Méthodes « perdues » par Doxygen récupérées (ex. `WorldEditorAPI.DeleteEntity`, `LockEntityLayer`).
- Scraper refait : doc locale de Workbench ou site BI (`npm run scrape` / `npm run scrape:remote`).

**Nouveaux outils**
- `mod` : `compile` (Workbench headless, erreurs `fichier:ligne`), `pack` et `build` = compile + pack.
  L'ancien `build` restait bloqué indéfiniment.
- `config_override` : override de n'importe quelle config ou prefab du jeu, comme « Override in addon » de Workbench,
  mais sans Workbench.
- `economy` : XP, seuils de rang, coûts arsenal, coûts de respawn des loadouts, avec multiplicateur ou valeurs exactes.
- `server` : installation SteamCMD, config validée par le schéma officiel du jeu, start/stop/status/logs, scénarios.
- `game` : lance le jeu avec tes addons, se connecte à un serveur, lit les logs, ferme.
- `env_check` : diagnostic complet de l'installation, plus enregistrement des chemins.
- `wb_close` : ferme Workbench proprement.
- Prompt `/server-mod`.
- Lecteur de `resourceDatabase.rdb` : **GUID de toutes les ressources du jeu** (105 000+), exploité par `asset_search`,
  les overrides et la duplication.

**Corrections vérifiées sur le jeu réel**
- `server_config` générait des clés retirées (`gameHostBindPort`…) qu'un serveur 1.8 refuse.
- `game_duplicate` ne trouvait aucun fichier, le jeu étant entièrement packé.
- `asset_search` tronquait les chemins (`Prefabs/` disparaissait) et n'avait presque aucun GUID.
- `wb_state` affichait « game mode » sans monde ouvert ; `wb_projects` ne voyait aucun projet ;
  `wb_open_resource` annonçait un succès en cas d'échec ; `wb_execute_action` ignorait le module ciblé.
- Recettes de prefab : composants et chemins inexistants (`RotorComponent`, `Soldier_Base.et`…) remplacés par les vrais.
  `npm run check:recipes` les vérifie contre les `.pak`.
- Recettes et KB gamemode réécrites pour l'API 1.8 : `SaveGameManager`, nouvelle signature de `CanPlayerSpawn_S`,
  `IsHQRadioTrafficPossible`.
- `script_create` ne génère plus d'`override proto …` impossibles ni de getters vides.

---

## Prérequis

| | |
|---|---|
| **Windows 10/11** | Workbench n'existe que sous Windows |
| **Node.js 20+** | `node --version` |
| **Arma Reforger** (Steam) | le jeu, pour lire les données et tester |
| **Arma Reforger Tools** (Steam) | Workbench `ArmaReforgerWorkbenchSteamDiag.exe`, pour compiler et packager |
| *(optionnel)* Arma Reforger Server | `server install` le télécharge tout seul via SteamCMD |

---

## Installation

### 1. Récupérer et compiler

```bash
git clone https://github.com/MyckaelAutier/enfusion-mcp-BK.git
cd enfusion-mcp-BK
npm install        # installe et compile (dist/)
```

### 2. Brancher sur Claude Code

```bash
claude mcp add --scope user enfusion-mcp -- node "C:\chemin\vers\enfusion-mcp-BK\dist\index.js"
```

Redémarre Claude Code et vérifie avec `/mcp`.

### 3. Ou sur Claude Desktop

`%APPDATA%\Claude\claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "enfusion-mcp": {
      "command": "node",
      "args": ["C:\\chemin\\vers\\enfusion-mcp-BK\\dist\\index.js"]
    }
  }
}
```

> Ne mélange pas avec l'ancien paquet npm (`npx -y enfusion-mcp`) : retire-le avec
> `claude mcp remove enfusion-mcp --scope user` avant d'ajouter celui-ci.

---

## Premiers pas

Demande simplement à Claude : **« Lance env_check »**. Tu obtiens par exemple :

```
✅ Game: C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger (v1.8.0.13)
✅ Game Diag exe (needed for game launch connect/world)
✅ Workbench: …\Arma Reforger Tools\Workbench\ArmaReforgerWorkbenchSteamDiag.exe
❌ Dedicated server: not installed — `server install`
✅ Base-game resource database: 105482 resources with GUIDs
✅ Addons (projectPath): …\ArmaReforgerWorkbench\addons — 5 addon(s)
```

Si un chemin n'est pas standard : *« env_check configure gamePath = D:\Steam\…\Arma Reforger »*. C'est enregistré
dans `~/.enfusion-mcp/config.json`.

---

## Créer un mod de A à Z

Le cycle complet, que Claude enchaîne tout seul :

| Étape | Outil | Détail |
|---|---|---|
| 1. Rechercher | `api_search`, `wb_knowledge`, `wiki_search`, `asset_search`, `game_read` | jamais de méthode inventée |
| 2. Créer l'addon | `mod` `create` | `.gproj` + arborescence, 10 patterns disponibles |
| 3. Écrire | `script_create`, `prefab`, `layout_create`, `menu_create`, `config_create`, `config_override`, `economy`, `project` | |
| 4. Vérifier | `mod` `validate` | contrôle statique, sans Workbench |
| 5. **Compiler** | `mod` `compile` | Workbench headless (~5 s), erreurs `fichier:ligne` |
| 6. **Packager** | `mod` `build` | compile puis pack → `Documents/My Games/ArmaReforgerWorkbench/packed/<Addon>` |
| 7. Tester en jeu | `game` `launch` (addons, connect, world) → `game` `logs` → `game` `stop` | |
| 8. Tester en multi | `server` `config` → `start` → `logs` + `game` `launch` connect `127.0.0.1` | |
| 9. Éditeur (optionnel) | `wb_launch` → `wb_*` → `wb_close` → `wb_cleanup` | placement d'entités, mondes, scénarios |
| 10. Publier | Workbench → *Publish* | le Workshop reste une étape manuelle |

Exemple de résultat de `mod` `compile` en cas d'erreur :

```
**Scripts:** FAILED (4s)

### Errors in this addon
- `Scripts/Game/MCT_Broken.c:5` Unknown type 'UnknownType'
```

---

## Mods serveur : XP, rangs, coûts

Les valeurs d'économie sont des **configs du jeu**. Pour les changer, un mod place un **override** : un fichier au
même chemin que l'original, avec un `.meta` portant **le même GUID**, qui ne contient que le **delta** (chaque objet
modifié est désigné par son `{ID}`). C'est ce que fait Workbench avec « Override in addon », et c'est ce que génèrent
`economy` et `config_override`. Les valeurs non mentionnées gardent celles du jeu, et les mises à jour de Bohemia
continuent de s'appliquer.

### `economy` : les réglages courants

| Catégorie | Fichiers du jeu | Valeur | Clé |
|---|---|---|---|
| `xp` | `Configs/Campaign/XPRewards.conf` + `CampaignXPRewards.conf` (Conflict) | `m_iRewardXP` | ID de récompense : `ENEMY_KILL`, `BASE_SEIZED`, `RELAY_RECONFIGURED`… |
| `ranks` | `Configs/Ranks/BaseMilitaryRanks.conf` + FIA | `m_iRequiredXP` | `PRIVATE`, `CORPORAL`, `SERGEANT`… |
| `arsenal` | `Configs/EntityCatalog/<Faction>/InventoryItems_EntityCatalog_<Faction>.conf` | `m_iSupplyCost`, `m_eRequiredRank` | regex sur le prefab (`M16`, `AK74\|PKM`) |
| `loadouts` | `Configs/EntityCatalog/<Faction>/Characters_EntityCatalog_<Faction>.conf` | `m_fSpawnSupplyCost`, `m_eRequiredRank` | regex sur le prefab (`Sniper`, `MG`) |

Exemples de demandes : *« economy inspect xp »*, *« double l'XP mais garde les pénalités »*,
*« les fusils M16 coûtent 6 de supplies »*, *« le sniper US coûte 150 au respawn et demande sergent »*.

Appel brut équivalent :

```json
{ "action": "set", "category": "xp", "modName": "MonServeur", "multiplier": 2, "values": { "ENEMY_KILL": 50 } }
```

Sortie :

```
- Configs/Campaign/XPRewards.conf (GUID {E6FC4537B53EA00B}) — 5 change(s):
  - SCR_XPRewardInfo {51BC713E81C18CF3} [m_eRewardID=ENEMY_KILL] · m_iRewardXP: 20 → 50
  - SCR_XPRewardInfo {5E0E812546D6087F} [m_eRewardID=VETERANCY] · m_iRewardXP: 75 → 150
```

Avec `multiplier`, seuls les **gains** (valeurs positives) sont multipliés pour `xp` et `ranks`. Pour changer une
pénalité, donne sa valeur exacte.

### `config_override` : n'importe quelle valeur du jeu

1. Trouver le fichier : `asset_search` (ex. « GameMode_Campaign ») ou `game_browse`.
2. `config_override` `inspect` avec un `filter` : objets effectifs avec leurs `{ID}`, héritage résolu.
3. `config_override` `set` avec des `edits` :

```json
{
  "action": "set",
  "path": "Configs/Ranks/BaseMilitaryRanks.conf",
  "modName": "MonServeur",
  "edits": [
    { "where": { "m_iRank": "^SERGEANT$" }, "property": "m_iRequiredXP", "value": "2000" },
    { "className": "SCR_RankInfoCampaign", "property": "m_iRadioRespawnCooldown", "multiply": 0.5 }
  ]
}
```

Chaque edit choisit ses objets par `id`, `className` et/ou `where` (regex sur les propriétés de l'objet ou de ses
parents, ex. `m_sEntityPrefab`), puis applique `value`, `multiply` ou `add`. Relancer `set` complète l'override
existant. `config_override` `list` montre les overrides d'un mod et signale ceux à qui il manque un `.meta`.

### Déploiement

Un mod d'override doit tourner **sur le serveur** et les clients doivent l'avoir. En public : publie-le sur le
Workshop, puis ajoute-le à `"mods"` du `server.json` (les joueurs le téléchargent automatiquement). En local :
`server start` / `game launch` avec `addons: ["MonServeur"]`.

---

## Serveur dédié local

```text
server install       → télécharge SteamCMD puis Arma Reforger Server (app 1874900, anonyme, plusieurs Go)
server status        → avancement de l'installation, état, config, logs
server scenarios     → les 37 scénarios du jeu avec leur ID ({ECC61978EDCC2B5A}Missions/23_Campaign.conf…)
server config        → server.json généré ET validé contre backend/DSConfigSchema.json du jeu
server validate      → vérifie un server.json existant (clés inconnues, types, formats)
server start         → démarre avec tes addons packés (-addonsDir/-addons) et/ou des mods Workshop
server logs          → fin de console.log, ou seulement les (E)/(W)/(F)
server stop          → arrêt propre (force=true pour tuer)
```

Options de config gérées : nom, scénario, joueurs max, port, mots de passe joueur et admin, admins, visibilité,
cross-play, BattlEye, vue 3e personne, distances de vue, RCON, persistance (autosave), limite d'IA, file d'attente,
surcharges du mission header, mods Workshop (`modId`, `version`).

Ensuite, pour te connecter : `game launch` avec `connect: "127.0.0.1"` et les mêmes `addons`.

Emplacements par défaut : serveur `~/.enfusion-mcp/server`, profil, saves et logs `~/.enfusion-mcp/server-profile`,
SteamCMD `~/.enfusion-mcp/steamcmd`.

---

## Référence des outils

### Construction et test
| Outil | Rôle |
|---|---|
| `env_check` | diagnostic complet ; `configure` enregistre les chemins |
| `mod` | `create` · `validate` · `compile` · `pack` · `build` |
| `game` | `launch` (addons, connect, world, windowed) · `stop` · `status` · `logs` |
| `server` | `install` · `update` · `config` · `validate` · `start` · `stop` · `status` · `logs` · `scenarios` |
| `server_config` | ancien générateur de `server.json` (aligné sur le schéma 1.8) |
| `workshop_info` | métadonnées Workshop d'un `.gproj` |

### Économie et overrides
| Outil | Rôle |
|---|---|
| `economy` | XP, rangs, coûts arsenal, coûts de respawn (`inspect` / `set`) |
| `config_override` | override générique de config ou prefab (`inspect` / `set` / `list`) |
| `game_duplicate` | copie d'un prefab ou d'une config du jeu dans le mod, avec un nouveau GUID |

### Connaissance du jeu
| Outil | Rôle |
|---|---|
| `api_search` | classes, méthodes, propriétés, enums de l'API 1.8 (héritage inclus, arbre `format: tree`) |
| `component_search` | composants par catégorie (véhicule, arme, IA, UI…) et événements |
| `wb_knowledge` | base de connaissances modding (patterns vérifiés) |
| `wiki_search` / `wiki_read` | 274 pages : wiki BI et tutoriels Doxygen |
| `asset_search` | recherche d'assets du jeu, avec leur GUID `{…}path` |
| `game_browse` / `game_read` | parcourir ou lire les fichiers du jeu (dans les `.pak`) |
| `prefab` `inspect` | chaîne d'héritage complète d'un prefab |

### Génération
| Outil | Rôle |
|---|---|
| `script_create` | scripts Enforce (component, gamemode, action, entity, manager, modded, basic) |
| `prefab` `create` | prefabs depuis des recettes vérifiées sur les vrais prefabs du jeu |
| `layout_create` / `layout_recipe` / `menu_create` | UI : HUD, menus, dialogues, recettes extraites du jeu |
| `config_create` | factions, mission headers, catalogues, placeables |
| `gamemode_scaffold` | `modded SCR_GameModeCampaign` composé de fonctionnalités (respawn, seeding, sauvegarde…) |
| `scenario_create_conflict` / `scenario_create` | scénario Conflict complet ; objectifs Scenario Framework |
| `animation_graph` | graphes d'animation véhicules (création, inspection, validation) |
| `building_setup` | bâtiment destructible depuis un export Blender |
| `project` | lire, écrire, parcourir les fichiers du mod |

### Workbench en direct (API NET)
`wb_launch`, `wb_close`, `wb_cleanup`, `wb_connect`, `wb_diagnose`, `wb_state`, `wb_play`, `wb_stop`, `wb_save`,
`wb_undo_redo`, `wb_open_resource`, `wb_execute_action` (avec `module`), `wb_reload`, `wb_entity_create`,
`wb_entity_delete`, `wb_entity_list`, `wb_entity_inspect`, `wb_entity_modify`, `wb_entity_select`,
`wb_entity_duplicate`, `wb_component`, `wb_read_props`, `wb_terrain`, `wb_layers`, `wb_resources`, `wb_prefabs`,
`wb_clipboard`, `wb_script_editor`, `wb_localization`, `wb_projects`, `wb_validate`.

Les handlers Enforce de ces outils (`mod/Scripts/WorkbenchGame/EnfusionMCP/`) sont copiés dans l'addon ouvert par
`wb_launch`. Retire-les avec `wb_cleanup` avant de publier ; `mod build` te le rappelle s'ils sont présents.

### Ressources MCP
| URI | Contenu |
|---|---|
| `enfusion://class/{className}` | documentation complète d'une classe |
| `enfusion://pattern/{patternName}` | pattern de mod |
| `enfusion://group/{groupName}` | groupe d'API et ses classes |

---

## Prompts guidés

| Prompt | Usage |
|---|---|
| `/create-mod` | de l'idée au mod compilé, packagé et testé (gros projets découpés en phases dans `MODPLAN.md`) |
| `/modify-mod` | faire évoluer un mod existant |
| `/server-mod` | mod serveur (XP, coûts, rangs, règles) et test sur serveur local |

---

## Configuration

Tout est optionnel. Ordre de priorité : variables d'environnement, puis `~/.enfusion-mcp/config.json`, puis
`enfusion-mcp.config.json` du dépôt, puis les valeurs par défaut.

| Variable | Clé config.json | Défaut |
|---|---|---|
| `ENFUSION_WORKBENCH_PATH` | `workbenchPath` | `C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger Tools` |
| `ENFUSION_GAME_PATH` | `gamePath` | dossier `Arma Reforger` voisin |
| `ENFUSION_PROJECT_PATH` | `projectPath` | `Documents\My Games\ArmaReforgerWorkbench\addons` |
| `ENFUSION_PACKED_PATH` | `packedPath` | `Documents\My Games\ArmaReforgerWorkbench\packed` |
| `ENFUSION_SERVER_PATH` | `serverPath` | `~/.enfusion-mcp/server` |
| `ENFUSION_SERVER_PROFILE` | `serverProfilePath` | `~/.enfusion-mcp/server-profile` |
| `ENFUSION_STEAMCMD_PATH` | `steamcmdPath` | `~/.enfusion-mcp/steamcmd` |
| `ENFUSION_WORKBENCH_HOST` / `_PORT` | `workbenchHost` / `workbenchPort` | `127.0.0.1` / `5775` |
| `ENFUSION_DEFAULT_MOD` | `defaultMod` | addon ouvert par `wb_launch` |
| `ENFUSION_EXTRACTED_PATH` | `extractedPath` | `…/extracted` s'il existe |

---

## Données embarquées et mise à jour

| Données | Contenu | Source |
|---|---|---|
| `data/api/` | 8 984 classes, 128 000+ méthodes, enums, groupes, hiérarchie | Doxygen de Workbench 1.8 |
| `data/wiki/` | 274 pages (wiki BI et tutoriels) | wiki BI et Doxygen |
| `data/kb/` | patterns de modding distillés | rédigés et vérifiés |
| `data/recipes/` | recettes de prefabs et de fonctionnalités gamemode | vérifiées sur les `.pak` 1.8 |
| à l'exécution | fichiers et GUID du jeu installé | `.pak` + `resourceDatabase.rdb` |

Après une mise à jour du jeu :

```bash
npm run scrape          # régénère l'API depuis Arma Reforger Tools/Workbench/docs (recommandé)
npm run scrape:remote   # ou depuis community.bistudio.com (souvent en retard d'une version)
npm run check:recipes   # vérifie que les recettes pointent toujours sur des prefabs/composants existants
npm run build
```

Le site de BI protège certaines pages par un challenge Cloudflare. Le mode remote récupère alors ces pages dans la
doc locale de Workbench.

---

## Dépannage

| Problème | Solution |
|---|---|
| `mod compile` refuse : « Workbench is open » | `wb_close` d'abord. Deux Workbench sur le même addon peuvent faire planter celui qui est ouvert. `force: true` pour passer outre. |
| « no world is open in the World Editor » | ouvre un monde (`wb_open_resource` sur un `.ent`) avant les outils d'entités |
| `wb_reload` : « Reload not confirmed » | Workbench 1.8 n'expose pas d'action de menu fiable ; utilise `mod compile` |
| Override sans effet | `config_override list` : le `.meta` doit exister avec le GUID d'origine ; reconstruis avec `mod build` |
| Le serveur s'arrête tout de suite | `server logs errorsOnly: true` ; `server validate` sur la config |
| Logs | Workbench : `Documents/My Games/ArmaReforgerWorkbench/logs` · jeu : `Documents/My Games/ArmaReforger/logs` · serveur : `~/.enfusion-mcp/server-profile/logs` |

---

## Développement

```bash
npm install
npm run dev             # serveur MCP depuis les sources (tsx)
npm test                # 634 tests (vitest)
npm run build           # dist/
npm run scrape          # régénère data/api
npm run check:recipes   # recettes vs jeu installé
npm run tuning-server   # interface web de réglage des moteurs de véhicules
```

Arborescence :

```
src/
  tools/        un fichier par outil MCP (mod, server, game, economy, config-override, env-check, wb-*, …)
  workbench/    client API NET, pilote CLI headless (cli.ts)
  pak/          lecteur .pak (VFS) et resourceDatabase.rdb
  formats/      parseur texte Enfusion, moteur d'override
  scraper/      Doxygen vers data/api
  templates/    générateurs (scripts, prefabs, layouts, server.json…)
  prompts/      /create-mod, /modify-mod, /server-mod
mod/            handlers Enforce copiés dans Workbench
data/           API, wiki, KB, recettes, patterns
tests/          vitest
```

---

## Crédits et licence

- Projet original : [steffenbk/enfusion-mcp-BK](https://github.com/steffenbk/enfusion-mcp-BK).
- Fork, mise à jour 1.8 et nouveaux outils : [MyckaelAutier](https://github.com/MyckaelAutier).
- Arma Reforger, Enfusion et Workbench sont des marques de Bohemia Interactive. Ce projet n'est pas affilié à
  Bohemia Interactive.

Licence **MIT**, voir [LICENSE](LICENSE).
