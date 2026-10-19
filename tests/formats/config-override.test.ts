import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  resolveEffective, buildDelta, mergeOverride, overrideMeta, flatten, lookup, scaleNumber,
} from "../../src/formats/config-override.js";

// Trimmed from Configs/Campaign/XPRewards.conf and CampaignXPRewards.conf (Arma Reforger 1.8)
const files: Record<string, string> = {
  "Configs/Campaign/XPRewards.conf": `SCR_XPRewardList {
 m_aRewardList {
  SCR_XPRewardInfo "{51BC713E81C18CF3}" {
   m_eRewardID ENEMY_KILL
   m_iRewardXP 20
  }
  SCR_XPRewardInfo "{5E0E812547C995B6}" {
   m_eRewardID SUICIDE
   m_iRewardXP 0
  }
 }
}`,
  "Configs/Campaign/CampaignXPRewards.conf": `SCR_XPRewardList : "{E6FC4537B53EA00B}Configs/Campaign/XPRewards.conf" {
 m_aRewardList {
  SCR_XPRewardInfo "{5E0E812547C995B6}" {
   m_iRewardXP -40
  }
 }
}`,
};
const read = (p: string) => files[p] ?? null;

describe("config override engine", () => {
  it("merges a file over its inheritance chain", () => {
    const eff = resolveEffective(read, "{0000000000000000}Configs/Campaign/CampaignXPRewards.conf")!;
    expect(eff.chain).toEqual(["Configs/Campaign/CampaignXPRewards.conf", "Configs/Campaign/XPRewards.conf"]);
    const objs = flatten(eff.root).filter((o) => o.node.id);
    expect(objs.map((o) => [lookup(o, "m_eRewardID"), o.props.m_iRewardXP])).toEqual([["ENEMY_KILL", "20"], ["SUICIDE", "-40"]]);
    // header of the overridden file is kept
    expect(eff.root.inheritance).toBe("{E6FC4537B53EA00B}Configs/Campaign/XPRewards.conf");
  });

  it("emits only the changed values, addressed by object ID", () => {
    const eff = resolveEffective(read, "Configs/Campaign/CampaignXPRewards.conf")!;
    const { delta, changes } = buildDelta(eff.root, [
      { match: (o) => lookup(o, "m_eRewardID") === "ENEMY_KILL", property: "m_iRewardXP", value: "100" },
      { match: (o) => lookup(o, "m_eRewardID") === "SUICIDE", property: "m_iRewardXP", value: "-40" }, // unchanged
    ]);
    expect(changes).toEqual([{ object: expect.stringContaining("ENEMY_KILL"), property: "m_iRewardXP", from: "20", to: "100" }]);
    const tree = parse(mergeOverride(null, delta));
    expect(tree.type).toBe("SCR_XPRewardList");
    expect(tree.inheritance).toBe("{E6FC4537B53EA00B}Configs/Campaign/XPRewards.conf");
    const entries = tree.children[0].children;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("{51BC713E81C18CF3}");
    expect(entries[0].properties).toEqual([{ key: "m_iRewardXP", value: "100" }]);
  });

  it("keeps earlier edits when merging into an existing override", () => {
    const eff = resolveEffective(read, "Configs/Campaign/XPRewards.conf")!;
    const first = mergeOverride(null, buildDelta(eff.root, [{ match: (o) => o.props.m_eRewardID === "ENEMY_KILL", property: "m_iRewardXP", value: "50" }]).delta);
    const second = mergeOverride(first, buildDelta(eff.root, [{ match: (o) => o.props.m_eRewardID === "SUICIDE", property: "m_iRewardXP", value: "-10" }]).delta);
    const ids = parse(second).children[0].children.map((c) => [c.id, c.properties[0].value]);
    expect(ids).toEqual([["{51BC713E81C18CF3}", "50"], ["{5E0E812547C995B6}", "-10"]]);
  });

  it("writes a meta carrying the base GUID", () => {
    expect(overrideMeta("E6FC4537B53EA00B", "Configs/Campaign/XPRewards.conf")).toContain('Name "{E6FC4537B53EA00B}Configs/Campaign/XPRewards.conf"');
  });

  it("scales numbers keeping ints as ints", () => {
    expect(scaleNumber("20", 1.5)).toBe("30");
    expect(scaleNumber("88.5", 2)).toBe("177");
    expect(scaleNumber("0.25", 3)).toBe("0.75");
    expect(scaleNumber(undefined, 2)).toBeNull();
  });
});
