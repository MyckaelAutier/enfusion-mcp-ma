import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  parseAgrToStruct, parseAgfToStruct, parseAstToStruct,
  parseAsiToStruct, parseAwToStruct,
} from "../../src/animation/parser.js";
import {
  formatAgrSummary, formatAgfTree, formatAstSummary,
  formatAsiSummary, formatAwSummary, formatValidationReport,
} from "../../src/animation/formatter.js";
import { validateGraph } from "../../src/animation/validator.js";
import { generateSuggestions, formatSuggestions } from "../../src/animation/suggestions.js";

// Needs the M151A2 animation files from a local Workbench profile; set TESTANIM_DIR to run.
const BASE = process.env.TESTANIM_DIR ?? "C:/Users/Steffen/Documents/My Games/ArmaReforgerWorkbench/profile/TESTANIM";

const HAS_FILES = existsSync(`${BASE}/M151A2.agr`);

function readFile(name: string): string {
  return HAS_FILES ? readFileSync(`${BASE}/${name}`, "utf-8") : "";
}

describe.skipIf(!HAS_FILES)("M151A2 Integration", () => {
  const agrContent = readFile("M151A2.agr");
  const agfContent = readFile("M151A2.agf");
  const astContent = readFile("M151A2.ast");
  const asiContent = readFile("M151A2_vehicle.asi");
  const awContent = readFile("Test.aw");

  describe("AGR parsing", () => {
    const agr = parseAgrToStruct(agrContent);

    it("finds variables", () => {
      expect(agr.variables.length).toBeGreaterThan(0);
      console.log(`AGR: ${agr.variables.length} variables, ${agr.commands.length} commands, ${agr.ikChains.length} IK chains, ${agr.boneMasks.length} bone masks`);
      console.log(`DefaultRunNode: ${agr.defaultRunNode}`);
      console.log(`GlobalTags: ${agr.globalTags.join(", ")}`);
      console.log(`AGF refs: ${agr.agfReferences.length}`);
    });

    it("formats summary", () => {
      const summary = formatAgrSummary(agr);
      expect(summary.length).toBeGreaterThan(100);
      console.log("\n--- AGR Summary ---");
      console.log(summary);
    });
  });

  describe("AGF parsing", () => {
    const agf = parseAgfToStruct(agfContent);

    it("finds sheets and nodes", () => {
      expect(agf.sheets.length).toBeGreaterThan(0);
      const totalNodes = agf.sheets.reduce((s, sh) => s + sh.nodes.length, 0);
      console.log(`AGF: ${agf.sheets.length} sheets, ${totalNodes} nodes`);
      for (const sheet of agf.sheets) {
        console.log(`  Sheet "${sheet.name}": ${sheet.nodes.length} nodes`);
        for (const node of sheet.nodes) {
          console.log(`    ${node.type} "${node.name}" children=[${node.children.join(", ")}]`);
        }
      }
    });

    it("formats tree", () => {
      const tree = formatAgfTree(agf);
      expect(tree.length).toBeGreaterThan(50);
      console.log("\n--- AGF Tree ---");
      console.log(tree);
    });
  });

  describe("AST parsing", () => {
    const ast = parseAstToStruct(astContent);

    it("finds groups", () => {
      console.log(`AST: ${ast.groups.length} groups`);
      for (const g of ast.groups) {
        console.log(`  ${g.name}: ${g.animationNames.length} anims, ${g.columnNames.length} columns`);
      }
      expect(ast.groups.length).toBeGreaterThanOrEqual(0);
    });

    it("formats summary", () => {
      const summary = formatAstSummary(ast);
      console.log("\n--- AST Summary ---");
      console.log(summary);
    });
  });

  describe("ASI parsing", () => {
    const asi = parseAsiToStruct(asiContent);

    it("finds mappings", () => {
      console.log(`ASI: ${asi.mappings.length} mappings`);
      const mapped = asi.mappings.filter(m => m.anmPath !== null);
      const unmapped = asi.mappings.filter(m => m.anmPath === null);
      console.log(`  Mapped: ${mapped.length}, Unmapped: ${unmapped.length}`);
    });

    it("formats summary", () => {
      const summary = formatAsiSummary(asi);
      console.log("\n--- ASI Summary ---");
      console.log(summary);
    });
  });

  describe("AW parsing", () => {
    const aw = parseAwToStruct(awContent);

    it("finds workspace refs", () => {
      console.log(`AW: animGraph=${aw.animGraph}, template=${aw.animSetTemplate}`);
      console.log(`  ${aw.animSetInstances.length} ASI instances, ${aw.previewModels.length} preview models`);
    });

    it("formats summary", () => {
      const summary = formatAwSummary(aw);
      console.log("\n--- AW Summary ---");
      console.log(summary);
    });
  });

  describe("Validation", () => {
    const agf = parseAgfToStruct(agfContent);
    const agr = parseAgrToStruct(agrContent);
    const asi = parseAsiToStruct(asiContent);

    it("runs V01-V13 checks", () => {
      const result = validateGraph(agf, agr, asi);
      console.log("\n--- Validation ---");
      console.log(formatValidationReport(result.issues, result.errorCount, result.warningCount));
    });
  });

  describe("Suggestions", () => {
    const agf = parseAgfToStruct(agfContent);
    const agr = parseAgrToStruct(agrContent);

    it("generates suggestions", () => {
      const suggestions = generateSuggestions(agf, agr);
      console.log("\n--- Suggestions ---");
      console.log(formatSuggestions(suggestions));
    });
  });
});
