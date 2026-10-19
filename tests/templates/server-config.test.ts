import { describe, it, expect } from "vitest";
import { generateServerConfig, validateAgainstSchema } from "../../src/templates/server-config.js";

describe("generateServerConfig", () => {
  it("returns valid JSON", () => {
    const result = generateServerConfig({ name: "Test Server" });
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
  });

  it("sets server name", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "My Server" })
    );
    expect(result.game.name).toBe("My Server");
  });

  it("defaults port to 2001", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test" })
    );
    expect(result.bindPort).toBe(2001);
  });

  it("defaults maxPlayers to 32", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test" })
    );
    expect(result.game.maxPlayers).toBe(32);
  });

  it("defaults visible to false", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test" })
    );
    expect(result.game.visible).toBe(false);
  });

  it("uses custom port", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test", port: 3000 })
    );
    expect(result.bindPort).toBe(3000);
    expect(result.publicPort).toBe(3000);
  });

  it("uses custom maxPlayers", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test", maxPlayers: 64 })
    );
    expect(result.game.maxPlayers).toBe(64);
  });

  it("sets password", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test", password: "secret" })
    );
    expect(result.game.password).toBe("secret");
  });

  it("includes mod entry when modName provided", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test", modName: "MyMod", modId: "ABC123" })
    );
    expect(result.game.mods).toHaveLength(1);
    expect(result.game.mods[0].name).toBe("MyMod");
    expect(result.game.mods[0].modId).toBe("ABC123");
  });

  it("has empty mods when no mod info provided", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test" })
    );
    expect(result.game.mods).toHaveLength(0);
  });

  it("sets scenarioId", () => {
    const result = JSON.parse(
      generateServerConfig({
        name: "Test",
        scenarioId: "{AABB}Missions/Header.conf",
      })
    );
    expect(result.game.scenarioId).toBe("{AABB}Missions/Header.conf");
  });

  it("disables battlEye by default", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test" })
    );
    expect(result.game.gameProperties.battlEye).toBe(false);
  });

  it("sets a2s port", () => {
    const result = JSON.parse(
      generateServerConfig({ name: "Test", a2sPort: 18888 })
    );
    expect(result.a2s.port).toBe(18888);
  });
});

describe("server.json follows the 1.8 schema", () => {
  it("uses bindAddress/bindPort/publicPort, not the removed gameHost* keys", () => {
    const cfg = JSON.parse(generateServerConfig({ name: "T" }));
    expect(Object.keys(cfg)).not.toContain("gameHostBindPort");
    expect(cfg).toMatchObject({ bindAddress: "0.0.0.0", bindPort: 2001, publicPort: 2001, a2s: { port: 17777 } });
  });

  it("adds rcon only with a password, and lists workshop mods", () => {
    expect(JSON.parse(generateServerConfig({ name: "T" })).rcon).toBeUndefined();
    const cfg = JSON.parse(generateServerConfig({ name: "T", rconPassword: "pw", mods: [{ modId: "5F2944B7474F043F", name: "X" }] }));
    expect(cfg.rcon).toMatchObject({ password: "pw", permission: "admin" });
    expect(cfg.game.mods).toEqual([{ modId: "5F2944B7474F043F", name: "X" }]);
  });
});

describe("validateAgainstSchema", () => {
  const schema = {
    type: "object", required: ["game"], additionalProperties: false,
    properties: {
      bindPort: { type: "integer", minimum: 1, maximum: 65535 },
      game: { type: "object", additionalProperties: false, properties: {
        scenarioId: { type: "string", pattern: "^\\{[0-9A-F]{16}\\}[a-zA-Z0-9_./ -]+$", patternDesc: "Param must start with ResourceGUID" },
      } },
    },
  };
  it("accepts a valid document", () => {
    expect(validateAgainstSchema({ bindPort: 2001, game: { scenarioId: "{ECC61978EDCC2B5A}Missions/23_Campaign.conf" } }, schema)).toEqual([]);
  });
  it("reports unknown keys, missing required, bad types and patterns", () => {
    const errs = validateAgainstSchema({ gameHostBindPort: 1, bindPort: "x" }, schema);
    expect(errs).toEqual(expect.arrayContaining(["$.game: required", "$.gameHostBindPort: unknown key", "$.bindPort: expected integer, got string"]));
    expect(validateAgainstSchema({ game: { scenarioId: "Missions/x.conf" } }, schema)).toEqual(["$.game.scenarioId: Param must start with ResourceGUID"]);
  });
});
