import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolDefs } from "../../agent/defs.ts";
import { RESOURCES } from "../../agent/lookup.ts";
import { TRAVEL_DEFS } from "../../agent/travel.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { find } from "../../shared/content/find.ts";
import { compileContent } from "../../shared/content/registry.ts";
import type { GuideData } from "../../shared/pages/types.ts";
import { MCP_EXAMPLES, publicMcpTools, renderMcp } from "../../tools/pages/mcp.ts";

function validate(value: unknown, schema: any): void {
  if (schema.oneOf) { expect(schema.oneOf.some((part: any) => part.type === typeof value || (part.type === "integer" && Number.isInteger(value)))).toBe(true); return; }
  if (schema.type === "integer") expect(Number.isInteger(value)).toBe(true);
  else if (schema.type) expect(typeof value).toBe(schema.type);
  if (schema.enum) expect(schema.enum).toContain(value);
  if (schema.minimum !== undefined) expect(value as number).toBeGreaterThanOrEqual(schema.minimum);
  if (schema.maximum !== undefined) expect(value as number).toBeLessThanOrEqual(schema.maximum);
  if (schema.type !== "object") return;
  const object = value as Record<string, unknown>;
  for (const key of schema.required ?? []) expect(object).toHaveProperty(key);
  for (const [key, v] of Object.entries(object)) {
    expect(schema.properties).toHaveProperty(key);
    validate(v, schema.properties[key]);
  }
}

test("MCP reference stays aligned with every declared tool and its real argument schema", () => {
  const tools = publicMcpTools();
  expect(tools).toEqual([...toolDefs(true), ...TRAVEL_DEFS]);
  expect(tools.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name)).toEqual(["observe", "status"]);
  for (const tool of tools) {
    expect(MCP_EXAMPLES).toHaveProperty(tool.name);
    validate(MCP_EXAMPLES[tool.name], tool.inputSchema);
  }
});

test("MCP pages publish schemas and examples without connecting or exposing runtime state", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-mcp-"));
  const data: GuideData = { version: 1, generatedAt: "2026-11-16T12:00:00Z", revision: "test", cluster: { id: "local", label: "Wiki", mode: "catalogue", description: "" }, entries: [], maps: [], servers: [], models: {}, sounds: [], music: [] };
  Object.assign(data, { password: "PRIVATE_PASSWORD_CANARY", privateKey: "PRIVATE_KEY_CANARY" });
  try {
    await renderMcp(data, root);
    const html = await readFile(join(root, "mcp/index.html"), "utf8");
    expect(html).toContain("data-filter-area");
    expect(html).toContain("data-record-list");
    expect(html).toContain("data-copy-target");
    expect(html).not.toContain("PRIVATE_");
    expect(html).not.toMatch(/\s(?:onclick|onload|style)=/);
    const exported = JSON.parse(await readFile(join(root, "mcp/tools.json"), "utf8"));
    expect(exported.resources).toEqual(RESOURCES);
    expect(exported.tools.find((tool: any) => tool.name === "console").availability).toBe("--console");
    expect(exported.tools.filter((tool: any) => tool.availability === "default")).toHaveLength(toolDefs(false).length + TRAVEL_DEFS.length);
    for (const tool of publicMcpTools()) expect((await stat(join(root, `mcp/${tool.name}/index.html`))).isFile()).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP examples resolve actual craft, building and transfer items, not just schema-shaped names", () => {
  const registry = compileContent(CORE_CONTENT).registry!;
  const craft = find(registry, String(MCP_EXAMPLES.craft!.recipe), "item");
  const place = find(registry, String(MCP_EXAMPLES.place!.item), "item");
  const transfer = find(registry, String(MCP_EXAMPLES.move_item!.item), "item");
  for (const found of [craft, place, transfer]) expect(found.kinds).toHaveLength(1);
  expect(registry.recipeOf[craft.kinds[0]!]!.length).toBeGreaterThan(0);
  expect((registry.defs[place.kinds[0]!] as { places?: string[] }).places?.length).toBeGreaterThan(0);
});
