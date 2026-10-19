import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";

/**
 * Reader for an addon's resourceDatabase.rdb — the map from resource path to
 * resource GUID (what Workbench shows as "{GUID}path"). Base-game files ship in
 * .pak archives without .meta files, so this is the only place their GUIDs live.
 *
 * Layout (reverse-engineered from Arma Reforger 1.8, "FORM....RDBC" header):
 * each resource is stored as
 *   u32 length | path bytes + NUL (length includes the NUL) | 6 bytes | u64 GUID (little-endian) | ...
 * We scan for that shape rather than walking the full chunk structure, and
 * validate each hit (printable path with an extension) so stray bytes can't match.
 */
export interface RdbEntry {
  /** 16-char upper-case hex GUID */
  guid: string;
  /** Path with its original casing */
  path: string;
}

export function parseResourceDatabase(buf: Buffer): Map<string, RdbEntry> {
  const out = new Map<string, RdbEntry>(); // keyed by lower-case path
  const end = buf.length - 14;
  for (let i = 0; i + 4 < end; i++) {
    const len = buf.readUInt32LE(i);
    if (len < 4 || len > 400) continue;
    const strEnd = i + 4 + len - 1; // index of the NUL
    if (strEnd + 15 > buf.length || buf[strEnd] !== 0) continue;
    let ok = true;
    let hasDot = false;
    for (let j = i + 4; j < strEnd; j++) {
      const c = buf[j];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      if (c === 0x2e) hasDot = true;
    }
    if (!ok || !hasDot) continue;
    const path = buf.toString("latin1", i + 4, strEnd);
    if (!/^[\w$ .\-/()&+,'!#@~[\]]+\.\w+$/.test(path)) continue;
    const guid = Buffer.from(buf.subarray(strEnd + 7, strEnd + 15)).reverse().toString("hex").toUpperCase();
    out.set(path.toLowerCase(), { guid, path });
    i = strEnd + 14;
  }
  return out;
}

let cache: { gamePath: string; map: Map<string, RdbEntry> } | null = null;

/** GUID map for every resourceDatabase.rdb under `<gamePath>/addons/*`, cached per game path. */
export function gameGuidMap(gamePath: string): Map<string, RdbEntry> {
  if (cache?.gamePath === gamePath) return cache.map;
  const map = new Map<string, RdbEntry>();
  const addons = join(gamePath, "addons");
  if (existsSync(addons)) {
    for (const dir of readdirSync(addons, { withFileTypes: true })) {
      const rdb = join(addons, dir.name, "resourceDatabase.rdb");
      if (!dir.isDirectory() || !existsSync(rdb)) continue;
      try {
        for (const [k, v] of parseResourceDatabase(readFileSync(rdb))) if (!map.has(k)) map.set(k, v);
      } catch (e) {
        logger.warn(`Failed to read ${rdb}: ${e}`);
      }
    }
  }
  logger.info(`Resource GUID map: ${map.size} entries from ${addons}`);
  cache = { gamePath, map };
  return map;
}

/** "{GUID}path" for a base-game resource, or null if unknown. */
export function resourceName(gamePath: string, path: string): string | null {
  const bare = path.replace(/^\{[0-9A-Fa-f]{16}\}/, "").replace(/\\/g, "/");
  const e = gameGuidMap(gamePath).get(bare.toLowerCase());
  return e ? `{${e.guid}}${e.path}` : null;
}
