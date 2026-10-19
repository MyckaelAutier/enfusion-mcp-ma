import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { resolveAddonDir } from "../utils/game-paths.js";
import { lookup, scaleNumber, stripGuid, type Edit, type FlatObject } from "../formats/config-override.js";
import { writeOverride, inspectBase, formatChanges } from "./config-override.js";

/**
 * Presets over config_override for the values server owners tune most
 * (verified file/class/property names, Arma Reforger 1.8 data):
 *  - xp       Configs/Campaign/XPRewards.conf (+ CampaignXPRewards.conf, Conflict) · SCR_XPRewardInfo.m_iRewardXP by m_eRewardID
 *  - ranks    Configs/Ranks/BaseMilitaryRanks.conf (+ FIAMilitaryRanks.conf) · SCR_RankInfo*.m_iRequiredXP / cooldowns by m_iRank
 *  - arsenal  Configs/EntityCatalog/<F>/InventoryItems_EntityCatalog_<F>.conf · SCR_ArsenalItem.m_iSupplyCost / m_eRequiredRank by prefab
 *  - loadouts Configs/EntityCatalog/<F>/Characters_EntityCatalog_<F>.conf · SCR_EntityCatalogLoadoutData.m_fSpawnSupplyCost / m_eRequiredRank by prefab
 */
const FACTIONS = ["US", "USSR", "FIA", "CIV", "Factionless"];

interface Category {
  files: (factions: string[]) => string[];
  /** objects this category edits */
  select: (o: FlatObject) => boolean;
  /** how `values` keys address an object */
  key: (o: FlatObject) => string;
  valueProp: string;
  /** extra props affected by `multiplier` */
  multiplyProps: string[];
  rankProp?: string;
}

const CATEGORIES: Record<string, Category> = {
  xp: {
    files: () => ["Configs/Campaign/XPRewards.conf", "Configs/Campaign/CampaignXPRewards.conf"],
    select: (o) => /XpRewardInfo|XPRewardInfo/i.test(o.node.className ?? o.node.type),
    key: (o) => lookup(o, "m_eRewardID") ?? "",
    valueProp: "m_iRewardXP",
    multiplyProps: ["m_iRewardXP", "m_iXPReward"],
  },
  ranks: {
    files: () => ["Configs/Ranks/BaseMilitaryRanks.conf", "Configs/Ranks/FIAMilitaryRanks.conf"],
    select: (o) => /RankInfo/.test(o.node.className ?? o.node.type),
    // first entries can omit m_iRank (engine default); the rank name still identifies them
    key: (o) => `${o.props.m_iRank ?? ""} ${o.props.m_sRankName ?? ""}`,
    valueProp: "m_iRequiredXP",
    multiplyProps: ["m_iRequiredXP"],
  },
  arsenal: {
    files: (f) => f.map((x) => `Configs/EntityCatalog/${x}/InventoryItems_EntityCatalog_${x}.conf`),
    select: (o) => (o.node.className ?? o.node.type) === "SCR_ArsenalItem",
    key: (o) => stripGuid(lookup(o, "m_sEntityPrefab") ?? ""),
    valueProp: "m_iSupplyCost",
    multiplyProps: ["m_iSupplyCost"],
    rankProp: "m_eRequiredRank",
  },
  loadouts: {
    files: (f) => f.map((x) => `Configs/EntityCatalog/${x}/Characters_EntityCatalog_${x}.conf`),
    select: (o) => (o.node.className ?? o.node.type) === "SCR_EntityCatalogLoadoutData",
    key: (o) => stripGuid(lookup(o, "m_sEntityPrefab") ?? ""),
    valueProp: "m_fSpawnSupplyCost",
    multiplyProps: ["m_fSpawnSupplyCost"],
    rankProp: "m_eRequiredRank",
  },
};

export function registerEconomy(server: McpServer, config: Config): void {
  server.registerTool(
    "economy",
    {
      description:
        "Tune a server's economy with a config-override mod (no scripting): XP rewards, rank thresholds, " +
        "arsenal supply costs / required ranks, loadout spawn costs. 'inspect' lists current base-game values; " +
        "'set' writes overrides into an addon (multiplier and/or per-key values). Keys: xp = reward IDs " +
        "(ENEMY_KILL, BASE_SEIZED, …); ranks = rank IDs or names (PRIVATE, CORPORAL, SERGEANT…); arsenal/loadouts = " +
        "regex on the prefab path (e.g. 'M16|AK74', 'Sniper'). Then `mod` build and load the addon on the server " +
        "(clients download it automatically). For anything else use `config_override`.",
      inputSchema: {
        action: z.enum(["inspect", "set"]),
        category: z.enum(["xp", "ranks", "arsenal", "loadouts"]),
        modName: z.string().optional().describe("(set) Addon folder under the project path"),
        multiplier: z.number().positive().optional().describe("(set) Scale the category, e.g. 2 = double XP gains / costs. For xp and ranks only positive values are scaled (penalties untouched)."),
        values: z.record(z.number()).optional().describe("(set) Exact values per key, e.g. {\"ENEMY_KILL\": 50} or {\"Sniper\": 150}"),
        requiredRank: z.record(z.string()).optional().describe("(set, arsenal/loadouts) Prefab regex → rank enum, e.g. {\"M249|PKM\": \"SERGEANT\"}"),
        factions: z.array(z.string()).optional().describe("(arsenal/loadouts) Faction folders, default US, USSR, FIA, CIV, Factionless"),
        filter: z.string().optional().describe("(inspect) Regex on the key"),
      },
    },
    async ({ action, category, modName, multiplier, values, requiredRank, factions, filter }) => {
      const cat = CATEGORIES[category];
      const files = cat.files(factions?.length ? factions : FACTIONS);
      try {
        if (action === "inspect") {
          const re = filter ? new RegExp(filter, "i") : null;
          const out: string[] = [];
          for (const f of files) {
            let r;
            try { r = inspectBase(config, f); } catch { out.push(`### ${f}\n(not found)`); continue; }
            const rows = r.objects
              .filter(cat.select)
              .filter((o) => !re || re.test(cat.key(o)))
              .map((o) => {
                const extra = [cat.valueProp, ...cat.multiplyProps.filter((p) => p !== cat.valueProp), ...(cat.rankProp ? [cat.rankProp] : [])]
                  .filter((p) => o.props[p] !== undefined).map((p) => `${p}=${o.props[p]}`).join(" ");
                return `- ${cat.key(o).trim() || o.node.id} ${extra || "(defaults)"}`;
              });
            out.push(`### ${r.path} (${rows.length})`, ...rows.slice(0, 300), ...(rows.length > 300 ? [`… ${rows.length - 300} more (use filter)`] : []));
          }
          return { content: [{ type: "text", text: out.join("\n") }] };
        }

        if (multiplier === undefined && !values && !requiredRank) {
          return { content: [{ type: "text", text: "Give multiplier, values and/or requiredRank." }], isError: true };
        }
        const addonDir = resolveAddonDir(config.projectPath, modName ?? config.defaultMod);
        if (!addonDir) return { content: [{ type: "text", text: "Addon not found — pass modName (create one with `mod` action create)." }], isError: true };

        const edits: Edit[] = [];
        if (multiplier !== undefined) {
          for (const prop of cat.multiplyProps) {
            edits.push({
              match: cat.select,
              property: prop,
              // xp/ranks: scale rewards and thresholds only — penalties and the negative
              // "renegade" thresholds stay as they are (set them explicitly with values)
              value: (cur) => ((category === "xp" || category === "ranks") && cur !== undefined && Number(cur) <= 0 ? null : scaleNumber(cur, multiplier)),
            });
          }
        }
        for (const [k, v] of Object.entries(values ?? {})) {
          const re = category === "xp" ? new RegExp(`^${k}$`, "i") : new RegExp(k, "i");
          edits.push({ match: (o) => cat.select(o) && re.test(cat.key(o)), property: cat.valueProp, value: String(v) });
        }
        if (requiredRank && cat.rankProp) {
          for (const [k, rank] of Object.entries(requiredRank)) {
            const re = new RegExp(k, "i");
            edits.push({ match: (o) => cat.select(o) && re.test(cat.key(o)), property: cat.rankProp, value: rank.toUpperCase() });
          }
        }

        const lines = [`**Economy: ${category}**`, ""];
        let total = 0;
        for (const f of files) {
          try {
            const r = writeOverride(config, addonDir, f, edits);
            total += r.changes.length;
            lines.push(...formatChanges(r, addonDir));
          } catch (e) {
            lines.push(`- ${f}: skipped (${e instanceof Error ? e.message : String(e)})`);
          }
        }
        lines.push("", total
          ? `${total} value(s) changed. Next: \`mod\` action build, then \`server start\` with this addon.`
          : "Nothing changed — keys did not match (check with action inspect).");
        return { content: [{ type: "text", text: lines.join("\n") }], ...(total ? {} : { isError: true }) };
      } catch (e) {
        return { content: [{ type: "text", text: `economy failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
    }
  );
}
