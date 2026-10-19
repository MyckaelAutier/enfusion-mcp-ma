/**
 * Config/prefab override engine (.conf / .et / .layout).
 *
 * How Arma Reforger overrides work (verified on a published Workshop mod and by
 * packing with Workbench 1.8): the mod ships a file at the SAME path as the base
 * resource, whose .meta carries the SAME GUID, and whose content is only a delta —
 * the same root class/header, with each changed object addressed by its "{ID}"
 * inside its parent blocks. Everything not mentioned keeps the base value.
 *
 * This module resolves a file's effective content (merging its ": parent" chain),
 * lets callers pick objects and set properties, and emits the minimal delta.
 */
import { parse, serialize, createNode, type EnfusionNode } from "./enfusion-text.js";

export type Reader = (path: string) => string | null;

export const stripGuid = (ref: string) => ref.replace(/^\{[0-9A-Fa-f]{16}\}/, "");

const childKey = (n: EnfusionNode) => n.id ?? `${n.type}|${n.className ?? ""}`;

function clone(n: EnfusionNode): EnfusionNode {
  return {
    ...n,
    properties: n.properties.map((p) => ({ ...p, value: typeof p.value === "string" ? p.value : clone(p.value) })),
    values: [...n.values],
    children: n.children.map(clone),
  };
}

/** Deep-merge `over` onto a copy of `base`: properties replace by key, child blocks merge by {ID} (or type when unnamed). */
export function mergeNode(base: EnfusionNode, over: EnfusionNode): EnfusionNode {
  const out = clone(base);
  out.type = over.type;
  out.className = over.className ?? out.className;
  out.inheritance = over.inheritance;
  for (const p of over.properties) {
    const i = out.properties.findIndex((q) => q.key === p.key);
    const v = { ...p, value: typeof p.value === "string" ? p.value : clone(p.value) };
    if (i >= 0) out.properties[i] = v; else out.properties.push(v);
  }
  if (over.values.length) out.values = [...over.values];
  for (const c of over.children) {
    const i = out.children.findIndex((d) => childKey(d) === childKey(c));
    if (i >= 0) out.children[i] = mergeNode(out.children[i], c);
    else out.children.push(clone(c));
  }
  return out;
}

/** Parse a file and merge it over its inheritance chain. `chain` lists the files, child first. */
export function resolveEffective(read: Reader, path: string): { root: EnfusionNode; chain: string[] } | null {
  const chain: string[] = [];
  const load = (p: string, depth: number): EnfusionNode | null => {
    const text = read(p);
    if (text === null || depth > 12) return null;
    chain.push(p);
    const node = parse(text);
    if (node.inheritance) {
      const parent = load(stripGuid(node.inheritance), depth + 1);
      if (parent) return mergeNode(parent, node);
    }
    return node;
  };
  const root = load(stripGuid(path), 0);
  return root ? { root, chain } : null;
}

export interface FlatObject {
  node: EnfusionNode;
  /** Ancestor nodes from the root (excluded) down to the parent */
  ancestors: EnfusionNode[];
  /** Effective scalar properties */
  props: Record<string, string>;
}

const scalarProps = (n: EnfusionNode) =>
  Object.fromEntries(n.properties.filter((p) => typeof p.value === "string").map((p) => [p.key, p.value as string]));

/** Every object of the tree that has an {ID}, plus the root itself (ancestors = []). */
export function flatten(root: EnfusionNode): FlatObject[] {
  const out: FlatObject[] = [{ node: root, ancestors: [], props: scalarProps(root) }];
  const walk = (n: EnfusionNode, anc: EnfusionNode[]) => {
    for (const c of n.children) {
      if (c.id) out.push({ node: c, ancestors: anc, props: scalarProps(c) });
      walk(c, [...anc, c]);
    }
  };
  walk(root, []);
  return out;
}

/** Nearest value of `key` on the object or any of its ancestors (e.g. the m_sEntityPrefab of a catalog entry). */
export function lookup(o: FlatObject, key: string): string | undefined {
  if (key in o.props) return o.props[key];
  for (let i = o.ancestors.length - 1; i >= 0; i--) {
    const v = scalarProps(o.ancestors[i])[key];
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Short human label for an object: class + the most telling identifier we can find. */
export function describe(o: FlatObject): string {
  const cls = o.node.className ?? o.node.type;
  for (const k of ["m_eRewardID", "m_iRank", "m_sEntityPrefab", "m_sIdentifier", "m_sFactionKey", "m_eBaseType", "Name", "m_sName"]) {
    const v = lookup(o, k);
    if (v !== undefined) return `${cls} ${o.node.id ?? ""} [${k}=${k === "m_sEntityPrefab" ? stripGuid(v) : v}]`;
  }
  return `${cls} ${o.node.id ?? "(root)"}`;
}

export interface Change {
  object: string;
  property: string;
  from: string | undefined;
  to: string;
}

export type Edit = {
  match: (o: FlatObject) => boolean;
  property: string;
  /** New value, or a function of the effective current value (undefined = engine default) */
  value: string | ((current: string | undefined) => string | null);
};

/**
 * Apply edits to the effective tree and return the minimal delta (root header copied
 * from the overridden file) plus the list of value changes. Unchanged values are skipped.
 */
export function buildDelta(effective: EnfusionNode, edits: Edit[]): { delta: EnfusionNode; changes: Change[] } {
  const delta = createNode(effective.type, { inheritance: effective.inheritance });
  delta.className = effective.className;
  const changes: Change[] = [];
  const objects = flatten(effective);

  const ensurePath = (chain: EnfusionNode[]): EnfusionNode => {
    let cur = delta;
    for (const n of chain) {
      let next = cur.children.find((c) => childKey(c) === childKey(n));
      if (!next) {
        next = createNode(n.type, { id: n.id });
        next.className = n.className;
        cur.children.push(next);
      }
      cur = next;
    }
    return cur;
  };

  for (const edit of edits) {
    for (const o of objects) {
      if (!edit.match(o)) continue;
      const from = o.props[edit.property];
      const to = typeof edit.value === "function" ? edit.value(from) : edit.value;
      if (to === null || to === from) continue;
      const target = o.ancestors.length === 0 && o.node === effective ? delta : ensurePath([...o.ancestors, o.node]);
      const i = target.properties.findIndex((p) => p.key === edit.property);
      if (i >= 0) target.properties[i] = { key: edit.property, value: to };
      else target.properties.push({ key: edit.property, value: to });
      o.props[edit.property] = to; // later edits see the new value
      const label = describe(o);
      const prev = changes.find((c) => c.object === label && c.property === edit.property);
      if (prev) prev.to = to; else changes.push({ object: label, property: edit.property, from, to });
    }
  }
  return { delta, changes };
}

/** Merge a new delta into an override file the mod already has (new values win). */
export function mergeOverride(existingText: string | null, delta: EnfusionNode): string {
  if (!existingText) return serialize(delta);
  return serialize(mergeNode(parse(existingText), delta));
}

/** .meta for an override: it must carry the base resource's GUID. */
export function overrideMeta(guid: string, path: string): string {
  return `MetaFileClass {\n Name "{${guid}}${path}"\n}\n`;
}

/** Numeric helper: scale an int/float string, keeping ints as ints. */
export function scaleNumber(current: string | undefined, factor: number, fallback?: number): string | null {
  const n = current !== undefined ? Number(current) : fallback;
  if (n === undefined || Number.isNaN(n)) return null;
  const isInt = current === undefined ? Number.isInteger(n) : !/[.eE]/.test(current);
  const v = n * factor;
  return isInt ? String(Math.round(v)) : String(Math.round(v * 1000) / 1000);
}
