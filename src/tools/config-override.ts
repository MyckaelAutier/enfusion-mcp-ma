import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Config } from "../config.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { gameGuidMap } from "../pak/rdb.js";
import { resolveAddonDir } from "../utils/game-paths.js";
import {
  resolveEffective, buildDelta, mergeOverride, overrideMeta, flatten, describe, lookup, scaleNumber, stripGuid,
  type Edit, type Change, type FlatObject,
} from "../formats/config-override.js";

/** Read base-game text files out of the .pak archives. */
export function baseReader(config: Config): (p: string) => string | null {
  const vfs = PakVirtualFS.get(config.gamePath);
  return (p) => (vfs && vfs.exists(p) ? vfs.readTextFile(p) : null);
}

export interface OverrideResult {
  file: string;
  guid: string;
  changes: Change[];
  chain: string[];
}

/**
 * Write (or extend) an override of a base-game resource inside an addon: same path,
 * .meta with the base GUID, content = minimal delta. Values are compared with the
 * base game's effective values, so re-running only records real differences.
 */
export function writeOverride(config: Config, addonDir: string, path: string, edits: Edit[]): OverrideResult {
  const bare = stripGuid(path).replace(/\\/g, "/");
  const entry = gameGuidMap(config.gamePath).get(bare.toLowerCase());
  if (!entry) throw new Error(`"${bare}" is not a base-game resource (no GUID in resourceDatabase.rdb)`);
  const eff = resolveEffective(baseReader(config), entry.path);
  if (!eff) throw new Error(`Cannot read ${entry.path} from the game .pak files`);
  const { delta, changes } = buildDelta(eff.root, edits);
  const file = join(addonDir, ...entry.path.split("/"));
  if (changes.length) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, mergeOverride(existsSync(file) ? readFileSync(file, "utf-8") : null, delta), "utf-8");
    writeFileSync(file + ".meta", overrideMeta(entry.guid, entry.path), "utf-8");
  }
  return { file, guid: entry.guid, changes, chain: eff.chain };
}

/** Effective objects of a base resource. */
export function inspectBase(config: Config, path: string): { objects: FlatObject[]; chain: string[]; guid?: string; path: string } {
  const bare = stripGuid(path).replace(/\\/g, "/");
  const entry = gameGuidMap(config.gamePath).get(bare.toLowerCase());
  const eff = resolveEffective(baseReader(config), entry?.path ?? bare);
  if (!eff) throw new Error(`Cannot read ${bare} from the game .pak files`);
  return { objects: flatten(eff.root), chain: eff.chain, guid: entry?.guid, path: entry?.path ?? bare };
}

export function formatChanges(r: OverrideResult, addonDir: string): string[] {
  const rel = relative(addonDir, r.file).replace(/\\/g, "/");
  if (!r.changes.length) return [`- \`${rel}\`: no change (no entry matched, or values already equal)`];
  return [
    `- \`${rel}\` (GUID {${r.guid}}) — ${r.changes.length} change(s):`,
    ...r.changes.slice(0, 60).map((c) => `  - ${c.object} · ${c.property}: ${c.from ?? "(default)"} → ${c.to}`),
    ...(r.changes.length > 60 ? [`  - … ${r.changes.length - 60} more`] : []),
  ];
}

const editSchema = z.object({
  id: z.string().optional().describe("Object ID like '{51BC713E81C18CF3}' (from inspect)"),
  where: z.record(z.string()).optional().describe("Match objects whose own or parent properties match these regexes, e.g. {\"m_eRewardID\":\"^ENEMY_KILL$\"} or {\"m_sEntityPrefab\":\"M16\"}"),
  className: z.string().optional().describe("Only objects of this class (e.g. SCR_ArsenalItem)"),
  property: z.string().describe("Property to set, e.g. m_iRewardXP"),
  value: z.string().optional().describe("New value (number, enum name, string)"),
  multiply: z.number().optional().describe("Instead of value: multiply the current number"),
  add: z.number().optional().describe("Instead of value: add to the current number"),
});

export function toEdit(e: z.infer<typeof editSchema>): Edit {
  const where = Object.entries(e.where ?? {}).map(([k, v]) => [k, new RegExp(v, "i")] as const);
  return {
    property: e.property,
    match: (o) =>
      (!e.id || o.node.id?.toUpperCase() === e.id.toUpperCase()) &&
      (!e.className || (o.node.className ?? o.node.type) === e.className) &&
      where.every(([k, re]) => { const v = lookup(o, k); return v !== undefined && re.test(stripGuid(v)); }) &&
      // a bare property edit with no selector must not hit every object in the file
      // (only the root object — it has no {ID} — is targeted then)
      (!!e.id || !!e.className || where.length > 0 || !o.node.id),
    value: (cur) =>
      e.value !== undefined ? e.value
      : e.multiply !== undefined ? scaleNumber(cur, e.multiply)
      : e.add !== undefined && cur !== undefined && !Number.isNaN(Number(cur)) ? String(Number(cur) + e.add)
      : null,
  };
}

export function registerConfigOverride(server: McpServer, config: Config): void {
  server.registerTool(
    "config_override",
    {
      description:
        "Override any base-game config or prefab (.conf/.et/.layout) from your mod — the same thing Workbench's " +
        "'Override in addon' does, without Workbench. 'inspect' shows the effective objects/values of a base file " +
        "(inheritance resolved, with object IDs); 'set' writes a minimal delta file at the same path with a .meta " +
        "carrying the base GUID (re-running merges with the existing override); 'list' shows the overrides a mod has. " +
        "Use it for XP, ranks, supply costs, AI limits, spawn timers, loadouts, faction settings… (see also `economy`).",
      inputSchema: {
        action: z.enum(["inspect", "set", "list"]),
        path: z.string().optional().describe("Base resource path, e.g. 'Configs/Campaign/XPRewards.conf' (GUID prefix allowed)"),
        filter: z.string().optional().describe("(inspect) Regex on object label / class / property names+values"),
        maxResults: z.number().int().min(1).max(2000).default(150).describe("(inspect) Max objects listed"),
        edits: z.array(editSchema).optional().describe("(set) Property edits"),
        modName: z.string().optional().describe("(set/list) Addon folder under the project path (default: addon opened with wb_launch)"),
      },
    },
    async ({ action, path, filter, maxResults, edits, modName }) => {
      try {
        if (action === "list") {
          const addonDir = resolveAddonDir(config.projectPath, modName ?? config.defaultMod);
          if (!addonDir) return { content: [{ type: "text", text: "Addon not found — pass modName." }], isError: true };
          const guids = gameGuidMap(config.gamePath);
          const found: string[] = [];
          const walk = (d: string) => {
            for (const f of readdirSync(d)) {
              const p = join(d, f);
              if (statSync(p).isDirectory()) { if (f !== "Scripts") walk(p); continue; }
              if (f.endsWith(".meta")) continue;
              const rel = relative(addonDir, p).replace(/\\/g, "/");
              const base = guids.get(rel.toLowerCase());
              if (base) found.push(`- \`${rel}\` overrides {${base.guid}}${existsSync(p + ".meta") ? "" : " ⚠ no .meta (Workbench will give it a new GUID — the override will not apply)"}`);
            }
          };
          walk(addonDir);
          return { content: [{ type: "text", text: found.length ? `**Overrides in ${relative(config.projectPath, addonDir)}** (${found.length})\n\n${found.join("\n")}` : "No base-game overrides in this addon." }] };
        }

        if (!path) return { content: [{ type: "text", text: "path is required" }], isError: true };

        if (action === "inspect") {
          const r = inspectBase(config, path);
          const re = filter ? new RegExp(filter, "i") : null;
          const rows: string[] = [];
          for (const o of r.objects) {
            const label = describe(o);
            const props = Object.entries(o.props).map(([k, v]) => `${k}=${v}`).join("  ");
            if (re && !re.test(label) && !re.test(props)) continue;
            rows.push(`- ${label}${props ? `\n    ${props}` : ""}`);
            if (rows.length >= maxResults) break;
          }
          return {
            content: [{
              type: "text",
              text: `**${r.path}** ${r.guid ? `{${r.guid}}` : "(not in resource DB)"}\nInheritance: ${r.chain.join(" ← ")}\n` +
                `${r.objects.length} objects${re ? `, ${rows.length} matching` : ""}:\n\n${rows.join("\n")}` +
                (rows.length >= maxResults ? `\n\n… truncated at ${maxResults}; narrow with filter.` : ""),
            }],
          };
        }

        // set
        if (!edits?.length) return { content: [{ type: "text", text: "edits are required for set" }], isError: true };
        const addonDir = resolveAddonDir(config.projectPath, modName ?? config.defaultMod);
        if (!addonDir) return { content: [{ type: "text", text: "Addon not found — pass modName (create one with `mod` action create)." }], isError: true };
        const r = writeOverride(config, addonDir, path, edits.map(toEdit));
        return {
          content: [{
            type: "text",
            text: [`**Override ${r.changes.length ? "written" : "unchanged"}**`, "", ...formatChanges(r, addonDir), "",
              r.changes.length ? "Rebuild with `mod` action build, then restart the server/game to apply." : "No selector matched or values were already equal — check with action inspect."].join("\n"),
          }],
          ...(r.changes.length ? {} : { isError: true }),
        };
      } catch (e) {
        return { content: [{ type: "text", text: `config_override failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
    }
  );
}
