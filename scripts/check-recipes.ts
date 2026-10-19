/**
 * Check prefab recipes against the installed game: every defaultParent must
 * exist in the game's .pak files, and every overridden component type must
 * appear in the parent's prefab ancestry or be a known API class. Properties the
 * ancestry never sets are only listed as notes (parents often leave them default).
 *
 * Usage: npx tsx scripts/check-recipes.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { PakVirtualFS } from "../src/pak/vfs.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig();
const vfs = PakVirtualFS.get(config.gamePath);
if (!vfs) throw new Error(`No .pak files under ${config.gamePath}/addons`);

const apiClasses = new Set(
  ["enfusion", "arma"].flatMap((s) =>
    (JSON.parse(readFileSync(join(root, "data/api", `${s}-classes.json`), "utf-8")) as { name: string }[]).map((c) => c.name)
  )
);

/** Text of a prefab and all its ancestors (`ClassName : "{GUID}path.et"` headers). */
function ancestry(path: string, depth = 0): string {
  if (depth > 15 || !vfs!.exists(path)) return "";
  const text = vfs!.readTextFile(path);
  const parent = text.match(/^\s*\w+\s*:\s*"\{[0-9A-F]+\}([^"]+\.et)"/m)?.[1];
  return text + (parent ? "\n" + ancestry(parent, depth + 1) : "");
}

let problems = 0;
const report = (msg: string) => { problems++; console.log("  ✗ " + msg); };

for (const file of readdirSync(join(root, "data/recipes")).filter((f) => f.endsWith(".json"))) {
  const r = JSON.parse(readFileSync(join(root, "data/recipes", file), "utf-8"));
  console.log(`${file}`);
  const parents = [r.defaultParent, ...(r.variants ?? []).map((v: { defaultParent?: string }) => v.defaultParent)].filter(Boolean);
  for (const p of parents) if (!vfs.exists(p)) report(`defaultParent not in game: ${p}`);
  const text = r.defaultParent ? ancestry(r.defaultParent) : "";
  for (const c of r.overrideComponents ?? []) {
    const inPrefab = new RegExp(`\\b${c.type}\\b`).test(text);
    if (!inPrefab && !apiClasses.has(c.type)) report(`component ${c.type} is neither in the parent ancestry nor an API class`);
    for (const prop of Object.keys(c.properties ?? {})) {
      if (!new RegExp(`\\b${prop}\\b`).test(text)) console.log(`  · note: ${c.type}.${prop} not set anywhere in the parent ancestry`);
    }
  }
}
console.log(problems ? `${problems} problem(s)` : "all recipes OK");
process.exitCode = problems ? 1 : 0;
