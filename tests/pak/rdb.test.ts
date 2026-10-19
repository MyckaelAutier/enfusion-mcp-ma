import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { parseResourceDatabase, resourceName } from "../../src/pak/rdb.js";

/** Build one rdb record the way Arma Reforger 1.8 stores it. */
function record(path: string, guidHex: string): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(path.length + 1);
  return Buffer.concat([len, Buffer.from(path + "\0", "latin1"), Buffer.from([6, 0, 0, 0, 0, 0]), Buffer.from(guidHex, "hex").reverse(), Buffer.alloc(8)]);
}

describe("parseResourceDatabase", () => {
  it("reads path → GUID records (GUID stored little-endian)", () => {
    const buf = Buffer.concat([Buffer.from("FORM\0\0\0\0RDBC"), record("Prefabs/Characters/Core/Character_Base.et", "37578B1666981FCE"), record("Configs/Campaign/XPRewards.conf", "E6FC4537B53EA00B")]);
    const map = parseResourceDatabase(buf);
    expect(map.get("prefabs/characters/core/character_base.et")).toEqual({ guid: "37578B1666981FCE", path: "Prefabs/Characters/Core/Character_Base.et" });
    expect(map.get("configs/campaign/xprewards.conf")?.guid).toBe("E6FC4537B53EA00B");
  });
});

const GAME = "C:/Program Files (x86)/Steam/steamapps/common/Arma Reforger";
describe.skipIf(!existsSync(`${GAME}/addons/data/resourceDatabase.rdb`))("installed game resource database", () => {
  it("resolves known base-game GUIDs", () => {
    expect(resourceName(GAME, "prefabs/vehicles/core/vehicle_base.et")).toBe("{4085446E2B406849}Prefabs/Vehicles/Core/Vehicle_Base.et");
  });
});
