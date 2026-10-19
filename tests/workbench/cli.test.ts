import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScriptIssues, readGproj } from "../../src/workbench/cli.js";

// Lines copied from a real `-wbSilent` run on Arma Reforger Tools 1.8 with a broken addon script
const LOG = [
  `19:57:04.925    SCRIPT    (E): @"Scripts/Game/MCT_Broken.c,5": Unknown type 'UnknownType'`,
  `19:57:04.925    SCRIPT    (E): @"Scripts/Game/MCT_Broken.c,5": Unknown type 'UnknownType'`,
  `19:57:04.943    SCRIPT    (E): @"Scripts/Game/ScenarioFramework/Actions/SCR_X.c,10": Can't find class SCR_ScenarioFrameworkParam`,
  `19:56:48.624    SCRIPT    (W): @"Scripts/Game/MCT_Broken.c,3": 'Foo' is obsolete`,
  `19:57:05.013    SCRIPT    (E): Can't compile "Game" script module!`,
].join("\n");

describe("parseScriptIssues", () => {
  const addon = mkdtempSync(join(tmpdir(), "emcp-"));
  mkdirSync(join(addon, "Scripts", "Game"), { recursive: true });
  writeFileSync(join(addon, "Scripts", "Game", "MCT_Broken.c"), "");

  it("dedupes errors and flags the ones in the addon", () => {
    const errs = parseScriptIssues(LOG, addon, "E");
    expect(errs).toEqual([
      { file: "Scripts/Game/MCT_Broken.c", line: 5, message: "Unknown type 'UnknownType'", inAddon: true },
      { file: "Scripts/Game/ScenarioFramework/Actions/SCR_X.c", line: 10, message: "Can't find class SCR_ScenarioFrameworkParam", inAddon: false },
    ]);
  });

  it("reads warnings separately", () => {
    expect(parseScriptIssues(LOG, addon, "W").map((w) => w.line)).toEqual([3]);
  });
});

describe("readGproj", () => {
  it("reads quoted and bare ID/GUID/TITLE", () => {
    const d = mkdtempSync(join(tmpdir(), "emcp-"));
    const f = join(d, "a.gproj");
    writeFileSync(f, `GameProject {\n ID "My Mod"\n GUID B83297F2C2B9C62B\n TITLE "My Mod Title"\n}`);
    expect(readGproj(f)).toEqual({ id: "My Mod", guid: "B83297F2C2B9C62B", title: "My Mod Title" });
  });
});
