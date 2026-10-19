import AdmZip from "adm-zip";
import { resolve, join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { logger } from "../utils/logger.js";

export interface HtmlEntry {
  filename: string;
  html: string;
}

/** A Doxygen HTML docs set, read from a folder or a zip. */
export interface DocSource {
  /** Read one file by its Doxygen filename (e.g. "annotated.html"). */
  read(filename: string): string | null;
  /** Iterate HTML files whose filename matches the pattern. */
  list(pattern: RegExp): Generator<HtmlEntry>;
}

// Workbench has shipped these docs under several names over time:
// older builds had zips, current builds ship extracted folders with an html/ subdir.
const DOC_NAMES = {
  enfusion: ["EnfusionScriptAPIPublic", "EnfusionScriptAPI"],
  arma: ["ArmaReforgerScriptAPIPublic"],
} as const;

/** Docs set backed by a plain directory of Doxygen HTML files. */
export function dirDocSource(dir: string): DocSource {
  return {
    read(filename) {
      const p = join(dir, filename);
      return existsSync(p) ? readFileSync(p, "utf-8") : null;
    },
    *list(pattern) {
      let count = 0;
      for (const filename of readdirSync(dir)) {
        if (!filename.endsWith(".html") || !pattern.test(filename)) continue;
        count++;
        yield { filename, html: readFileSync(join(dir, filename), "utf-8") };
      }
      logger.info(`Read ${count} HTML files matching ${pattern} from ${dir}`);
    },
  };
}

function zipDocSource(zipPath: string, prefix: string): DocSource {
  const zip = new AdmZip(zipPath);
  return {
    read(filename) {
      const entry = zip.getEntry(prefix + filename);
      return entry ? entry.getData().toString("utf-8") : null;
    },
    *list(pattern) {
      let count = 0;
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.endsWith(".html")) continue;
        const filename = entry.entryName.startsWith(prefix)
          ? entry.entryName.slice(prefix.length)
          : entry.entryName;
        if (!pattern.test(filename)) continue;
        count++;
        yield { filename, html: entry.getData().toString("utf-8") };
      }
      logger.info(`Read ${count} HTML files matching ${pattern} from ${zipPath}`);
    },
  };
}

/**
 * Locate the Doxygen docs bundled with Arma Reforger Tools
 * (`<workbench>/Workbench/docs/...`), as a folder or a legacy zip.
 */
export function localDocSource(
  workbenchPath: string,
  source: "enfusion" | "arma"
): DocSource | null {
  const docsDir = resolve(workbenchPath, "Workbench", "docs");
  for (const name of DOC_NAMES[source]) {
    for (const dir of [join(docsDir, name, "html"), join(docsDir, name)]) {
      if (existsSync(join(dir, "annotated.html"))) {
        logger.info(`Using local docs folder ${dir}`);
        return dirDocSource(dir);
      }
    }
    const zipPath = join(docsDir, `${name}.zip`);
    if (existsSync(zipPath)) {
      logger.info(`Using local docs zip ${zipPath}`);
      return zipDocSource(zipPath, `${name}/`);
    }
  }
  logger.error(`No ${source} docs found under ${docsDir}`);
  return null;
}
