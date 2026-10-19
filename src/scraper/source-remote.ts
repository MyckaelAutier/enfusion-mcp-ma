import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../utils/logger.js";
import type { DocSource } from "./source-local.js";

/** Official Doxygen docs published by Bohemia Interactive. */
export const REMOTE_BASE_URL =
  "https://community.bistudio.com/wikidata/external-data/arma-reforger/";

export const REMOTE_DIRS = {
  enfusion: "EnfusionScriptAPIPublic",
  arma: "ArmaReforgerScriptAPIPublic",
} as const;

// Index pages whose links lead to every page the scraper parses.
const INDEX_PAGES = ["annotated.html", "hierarchy.html", "topics.html", "pages.html"];
// interface pages include lowercase core types (string, array-1-g, vector, ...)
const PAGE_PATTERN = /^(interface[A-Za-z][\w-]*|group__\w+|Page_\w+)\.html$/;
const CONCURRENCY = 8;
const RETRIES = 3;

async function fetchPage(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      // community.bistudio.com answers 403 (Cloudflare challenge) with no User-Agent, or one containing a URL.
      const res = await fetch(url, {
        headers: { "User-Agent": "enfusion-mcp-scraper/0.1.0" },
      });
      if (res.status === 404) throw Object.assign(new Error(`HTTP 404 for ${url}`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || attempt >= RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

/** Collect the linked page filenames (deduped, anchors stripped) matching PAGE_PATTERN. */
export function extractPageLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="([^"#?]+)/g)) {
    if (PAGE_PATTERN.test(m[1]) && !m[1].includes("-members")) out.add(m[1]);
  }
  return [...out];
}

/**
 * Mirror the parts of a remote Doxygen docs set the scraper needs into `cacheDir`.
 * With `resume`, files already in the cache are not downloaded again.
 * Some pages are permanently behind a Cloudflare JS challenge (403 "Just a moment...");
 * those are taken from `fallback` (the local Workbench copy of the same docs) when given.
 * Returns `cacheDir` so it can be read with `dirDocSource`.
 */
export async function downloadDocs(
  source: "enfusion" | "arma",
  cacheDir: string,
  resume = false,
  fallback: DocSource | null = null
): Promise<string> {
  if (!resume) rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(cacheDir, { recursive: true });
  const base = `${REMOTE_BASE_URL}${REMOTE_DIRS[source]}/`;

  const pages = new Set<string>();
  for (const index of INDEX_PAGES) {
    try {
      const html = await fetchPage(base + index);
      writeFileSync(join(cacheDir, index), html, "utf-8");
      for (const link of extractPageLinks(html)) pages.add(link);
    } catch (e) {
      logger.warn(`Could not fetch ${base}${index}: ${e}`);
    }
  }
  if (!existsSync(join(cacheDir, "annotated.html"))) {
    throw new Error(`Could not download ${base}annotated.html`);
  }

  const todo = [...pages].filter((p) => !(resume && existsSync(join(cacheDir, p))));
  logger.info(`${source}: ${pages.size} pages linked, ${todo.length} to download from ${base}`);

  let done = 0;
  const failed: string[] = [];
  const worker = async () => {
    for (let name = todo.pop(); name; name = todo.pop()) {
      try {
        writeFileSync(join(cacheDir, name), await fetchPage(base + name), "utf-8");
      } catch (e) {
        failed.push(name);
        logger.warn(`Failed ${name}: ${e}`);
      }
      if (++done % 500 === 0) logger.info(`  ${source}: ${done} pages downloaded...`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const missing = failed.filter((name) => {
    const html = fallback?.read(name);
    if (html) writeFileSync(join(cacheDir, name), html, "utf-8");
    return !html;
  });
  if (failed.length) {
    logger.warn(
      `${source}: ${failed.length} pages failed to download, ${failed.length - missing.length} taken from local Workbench docs, ${missing.length} missing`
    );
  }
  return cacheDir;
}
