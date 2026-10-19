import { resolve } from "node:path";
import { localDocSource, dirDocSource, type DocSource } from "./source-local.js";
import { downloadDocs } from "./source-remote.js";
import {
  parseAnnotatedPage,
  parseClassPage,
  parseHierarchyPage,
  parseGroupPage,
  parseTutorialPage,
} from "./doxygen-parser.js";
import { writeOutput, type ScrapeOutput } from "./writer.js";
import { logger } from "../utils/logger.js";
import type { ClassInfo, GroupInfo, HierarchyNode, WikiPage } from "../index/types.js";

export interface ScrapeOptions {
  source: "local" | "remote";
  workbenchPath: string;
  dataDir: string;
  /** Remote only: where downloaded pages are kept (default: <repo>/.scraper-cache). */
  cacheDir?: string;
  /** Remote only: reuse pages already in the cache instead of re-downloading. */
  resume?: boolean;
}

function scrapeDocs(
  docs: DocSource,
  source: "enfusion" | "arma"
): {
  classes: ClassInfo[];
  groups: GroupInfo[];
  hierarchy: HierarchyNode[];
  wikiPages: WikiPage[];
} {
  const classes: ClassInfo[] = [];
  const groups: GroupInfo[] = [];
  let hierarchy: HierarchyNode[] = [];
  const wikiPages: WikiPage[] = [];

  // 1. Parse annotated.html for the class list
  const annotatedHtml = docs.read("annotated.html");
  if (!annotatedHtml) {
    logger.error(`Could not read annotated.html from ${source} docs`);
    return { classes, groups, hierarchy, wikiPages };
  }

  const classList = parseAnnotatedPage(annotatedHtml);
  logger.info(`Found ${classList.length} classes in ${source} annotated.html`);

  // 2. Parse hierarchy.html
  const hierarchyHtml = docs.read("hierarchy.html");
  if (hierarchyHtml) {
    hierarchy = parseHierarchyPage(hierarchyHtml);
    logger.info(`Parsed ${hierarchy.length} hierarchy nodes from ${source}`);
  }

  // 3. Parse each class page
  let processed = 0;
  for (const entry of docs.list(/^interface[A-Za-z].*\.html$/)) {
    // Skip -members.html files
    if (entry.filename.includes("-members")) continue;

    try {
      const classInfo = parseClassPage(entry.html, source, entry.filename);
      if (classInfo.name) {
        classes.push(classInfo);
      }
    } catch (e) {
      logger.warn(`Failed to parse ${entry.filename}: ${e}`);
    }

    processed++;
    if (processed % 200 === 0) {
      logger.info(`  Parsed ${processed} class pages from ${source}...`);
    }
  }
  logger.info(`Parsed ${classes.length} classes from ${source}`);

  // 4. Parse group pages
  for (const entry of docs.list(/^group__.*\.html$/)) {
    try {
      const group = parseGroupPage(entry.html);
      if (group.name) {
        groups.push({ ...group, source });
      }
    } catch (e) {
      logger.warn(`Failed to parse group ${entry.filename}: ${e}`);
    }
  }
  logger.info(`Parsed ${groups.length} groups from ${source}`);

  // 5. Parse tutorial pages (Page_*.html)
  for (const entry of docs.list(/^Page_.*\.html$/)) {
    try {
      const page = parseTutorialPage(entry.html, source, entry.filename);
      if (page.title) {
        wikiPages.push(page);
      }
    } catch (e) {
      logger.warn(`Failed to parse tutorial ${entry.filename}: ${e}`);
    }
  }
  logger.info(`Parsed ${wikiPages.length} tutorial pages from ${source}`);

  // 6. Cross-reference hierarchy with class data.
  //
  // The hierarchy parsed from hierarchy.html is the authoritative source for
  // inheritance relationships.  The <map><area> diagram parser in parseClassPage
  // is a heuristic that frequently reverses parent/child direction (especially
  // for root classes with no ancestors), so we override its results with
  // hierarchy data whenever available.
  const hChildMap = new Map<string, string[]>();  // parent → children
  const hParentMap = new Map<string, string[]>(); // child → parents

  for (const node of hierarchy) {
    for (const child of node.children) {
      // parent → child
      let children = hChildMap.get(node.name);
      if (!children) {
        children = [];
        hChildMap.set(node.name, children);
      }
      children.push(child);

      // child → parent (inverted)
      let parents = hParentMap.get(child);
      if (!parents) {
        parents = [];
        hParentMap.set(child, parents);
      }
      if (!parents.includes(node.name)) {
        parents.push(node.name);
      }
    }
  }

  const classesInHierarchy = new Set([...hChildMap.keys(), ...hParentMap.keys()]);

  for (const cls of classes) {
    if (classesInHierarchy.has(cls.name)) {
      // Hierarchy data is authoritative — override map-derived relationships
      cls.parents = hParentMap.get(cls.name) ?? [];
      cls.children = hChildMap.get(cls.name) ?? [];
    }
    // Classes not in the hierarchy keep their map-derived data (best-effort).
  }

  // 7. Validate: detect and fix circular parent references.
  //    If A.parents includes B AND B.parents includes A, one direction is wrong.
  //    Remove the less-likely direction.
  const classMap = new Map(classes.map((c) => [c.name, c]));
  for (const cls of classes) {
    cls.parents = cls.parents.filter((parentName) => {
      const parentCls = classMap.get(parentName);
      if (!parentCls) return true; // keep refs to unknown classes
      if (parentCls.parents.includes(cls.name)) {
        // Circular reference detected. Use heuristic: SCR_X extends X, not vice versa.
        // Also: a class with MORE descendants is more likely the parent.
        const clsIsScr = cls.name.startsWith("SCR_") && !parentName.startsWith("SCR_");
        if (clsIsScr) return true; // SCR_X extends X — this direction is correct
        const parentIsScr = parentName.startsWith("SCR_") && !cls.name.startsWith("SCR_");
        if (parentIsScr) return false; // X says parent is SCR_X — wrong
        // For non-SCR pairs, keep the one where parent has more children
        return (parentCls.children.length >= cls.children.length);
      }
      return true;
    });
  }

  logger.info(
    `Hierarchy cross-reference: ${classesInHierarchy.size} classes updated from hierarchy data`
  );

  return { classes, groups, hierarchy, wikiPages };
}

export async function scrape(options: ScrapeOptions): Promise<void> {
  logger.info(`Starting scrape (source: ${options.source})`);

  const cacheDir = options.cacheDir ?? resolve(options.dataDir, "..", ".scraper-cache");
  const openDocs = async (source: "enfusion" | "arma"): Promise<DocSource> => {
    if (options.source === "remote") {
      const fallback = localDocSource(options.workbenchPath, source);
      return dirDocSource(
        await downloadDocs(source, resolve(cacheDir, source), options.resume, fallback)
      );
    }
    const docs = localDocSource(options.workbenchPath, source);
    if (!docs) throw new Error(`No local ${source} docs in ${options.workbenchPath}; try --source remote`);
    return docs;
  };

  logger.info("=== Scraping Enfusion Engine API ===");
  const enfusion = scrapeDocs(await openDocs("enfusion"), "enfusion");

  logger.info("=== Scraping Arma Reforger API ===");
  const arma = scrapeDocs(await openDocs("arma"), "arma");

  // Never overwrite a good index with an empty one (e.g. download blocked).
  if (enfusion.classes.length === 0 || arma.classes.length === 0) {
    throw new Error(
      `Scrape produced no classes (enfusion=${enfusion.classes.length}, arma=${arma.classes.length}); data/ left untouched`
    );
  }

  const output: ScrapeOutput = {
    enfusionClasses: enfusion.classes,
    armaClasses: arma.classes,
    hierarchy: [...enfusion.hierarchy, ...arma.hierarchy],
    groups: [...enfusion.groups, ...arma.groups],
    wikiPages: [...enfusion.wikiPages, ...arma.wikiPages],
  };

  writeOutput(options.dataDir, output);
}
