import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHierarchyPage, parseClassPage } from "../../src/scraper/doxygen-parser.js";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("parseHierarchyPage", () => {
  const html = readFileSync(resolve(fixturesDir, "sample-hierarchy.html"), "utf-8");
  const nodes = parseHierarchyPage(html);
  const nodeMap = new Map(nodes.map((n) => [n.name, n]));

  it("parses nodes from the table-based Doxygen 1.13 format", () => {
    expect(nodes.length).toBeGreaterThan(100);
  });

  it("correctly identifies root nodes (no parent in the tree)", () => {
    // ActionManager is a root entry in the hierarchy (row_0_)
    expect(nodeMap.has("ActionManager")).toBe(true);
    // AlignableSlot is another root (row_1_)
    expect(nodeMap.has("AlignableSlot")).toBe(true);
  });

  it("correctly identifies parent-child relationships", () => {
    // ActionManager → InputManager
    const am = nodeMap.get("ActionManager");
    expect(am).toBeDefined();
    expect(am!.children).toContain("InputManager");

    // AlignableSlot → ButtonSlot, GridSlot, LayoutSlot, etc.
    const as_ = nodeMap.get("AlignableSlot");
    expect(as_).toBeDefined();
    expect(as_!.children).toContain("ButtonSlot");
    expect(as_!.children).toContain("GridSlot");
    expect(as_!.children).toContain("LayoutSlot");
  });

  it("correctly identifies multi-level nesting", () => {
    // AlignableSlot → LayoutSlot → HorizontalLayoutSlot
    const ls = nodeMap.get("LayoutSlot");
    expect(ls).toBeDefined();
    expect(ls!.children).toContain("HorizontalLayoutSlot");
    expect(ls!.children).toContain("VerticalLayoutSlot");
  });

  it("ScriptComponent is a child of GenericComponent", () => {
    const gc = nodeMap.get("GenericComponent");
    expect(gc).toBeDefined();
    expect(gc!.children).toContain("ScriptComponent");
  });

  it("GenericEntity is a child of IEntity", () => {
    const ie = nodeMap.get("IEntity");
    expect(ie).toBeDefined();
    expect(ie!.children).toContain("GenericEntity");
  });

  it("does not produce circular relationships", () => {
    for (const node of nodes) {
      for (const childName of node.children) {
        const child = nodeMap.get(childName);
        if (child) {
          expect(child.children).not.toContain(node.name);
        }
      }
    }
  });
});

describe("parseClassPage inheritance (map-area heuristic)", () => {
  const html = readFileSync(resolve(fixturesDir, "sample-class.html"), "utf-8");
  const cls = parseClassPage(html, "enfusion", "interfaceIEntity.html");

  it("parses the class name", () => {
    expect(cls.name).toBe("IEntity");
  });

  it("identifies Managed as a parent (above subject in diagram)", () => {
    expect(cls.parents).toContain("Managed");
  });

  it("identifies GenericEntity as a direct child", () => {
    expect(cls.children).toContain("GenericEntity");
  });

  it("does not include grandchildren (indented x) in children", () => {
    // AutotestGrid etc. are at x=179 (indented) — should be excluded
    expect(cls.children).not.toContain("AutotestGrid");
    expect(cls.children).not.toContain("CinematicEntity");
  });

  it("does not classify children as parents", () => {
    // GenericEntity should NOT appear in parents
    expect(cls.parents).not.toContain("GenericEntity");
    // No grandchildren in parents either
    expect(cls.parents).not.toContain("AutotestGrid");
  });
});

describe("parseClassPage member parsing (Doxygen 1.13)", () => {
  // Trimmed from interfaceWorldEditorAPI.html: the param type is itself a link.
  const html = `<div class="headertitle"><div class="title">WorldEditorAPI Interface Reference</div></div>
<div class="contents"><table class="memberdecls">
<tr class="heading"><td colspan="2"><h2 class="groupheader"><a id="pub-methods" name="pub-methods"></a>Public Member Functions</h2></td></tr>
<tr class="memitem:abc"><td class="memItemLeft">proto external IEntity&#160;</td><td class="memItemRight"><a class="el" href="#abc">SourceToEntity</a> (<a class="el" href="interfaceIEntitySource.html">IEntitySource</a> entSrc)</td></tr>
</table>
<a id="abc" name="abc"></a><h2 class="memtitle"><span class="permalink"><a href="#abc">&#9670;</a></span>SourceToEntity()</h2>
<div class="memitem"><div class="memproto">proto</div><div class="memdoc"><p>Returns the entity created from the source.</p></div></div>
<hr/>The documentation for this interface was generated from the following file:<ul><li>Workbench/<b>WorldEditorAPI.c</b></li></ul>
</div>`;
  const cls = parseClassPage(html, "enfusion", "interfaceWorldEditorAPI.html");

  it("takes the member name from the first link only", () => {
    expect(cls.methods.map((m) => m.name)).toEqual(["SourceToEntity"]);
    expect(cls.methods[0].params).toEqual([{ name: "entSrc", type: "IEntitySource", defaultValue: "" }]);
  });

  it("reads the detailed description from the memdoc block", () => {
    expect(cls.methods[0].description).toBe("Returns the entity created from the source.");
  });

  it("reads the source file from the generated-from list", () => {
    expect(cls.sourceFile).toBe("Workbench/WorldEditorAPI.c");
  });
});

describe("parseClassPage title", () => {
  it("strips template args from core template types", () => {
    const html = `<div class="headertitle"><div class="title">array&lt; Class T &gt; Interface Template Reference</div></div><div class="contents"></div>`;
    expect(parseClassPage(html, "enfusion", "interfacearray-1-g.html").name).toBe("array");
  });
});

describe("parseClassPage stray proto declarations", () => {
  // Doxygen dumped the tail of WorldEditorAPI into a code fragment.
  const html = `<div class="headertitle"><div class="title">WorldEditorAPI Interface Reference</div></div>
<div class="contents"><div class="memdoc"><div class="fragment">
<div class="line">WorldEditor we = Workbench.GetModule(WorldEditor);</div>
<div class="line">proto external <span class="keywordtype">bool</span> DeleteEntity(notnull IEntitySource ent);</div>
<div class="line">  *  Checks whether a layer is explicitly locked.</div>
<div class="line"><span class="stringliteral">proto external bool IsEntityLayerLocked(int subscene, int layerId);</span></div>
</div></div></div>`;
  const cls = parseClassPage(html, "enfusion", "interfaceWorldEditorAPI.html");

  it("recovers proto declarations and ignores example code", () => {
    expect(cls.methods.map((m) => m.name)).toEqual(["DeleteEntity", "IsEntityLayerLocked"]);
    expect(cls.methods[0].signature).toBe("proto external bool DeleteEntity (notnull IEntitySource ent)");
    expect(cls.methods[1].description).toBe("Checks whether a layer is explicitly locked.");
    expect(cls.methods[1].params.map((p) => p.name)).toEqual(["subscene", "layerId"]);
  });
});
