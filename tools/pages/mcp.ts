// The public reference reads declarations only. It never starts an agent, socket or protocol host.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toolDefs } from "../../agent/defs.ts";
import { RESOURCES } from "../../agent/lookup.ts";
import type { ToolDef } from "../../agent/mcp.ts";
import { TRAVEL_DEFS } from "../../agent/travel.ts";
import type { GuideData } from "../../shared/pages/types.ts";
import { escape, icon, sectionHead } from "./view/html.ts";
import { filterBar, heading, layout, noResults } from "./view/layout.ts";

export const MCP_EXAMPLES: Record<string, Record<string, unknown>> = {
  observe: { radius: 16, cell: 1, list: 8 }, status: { wait_s: 0 },
  go_to: { id: "s65539", run: false, wait_s: 10 },
  harvest: { id: "n12.3", until: { item: "wood", count: 5 }, wait_s: 10 },
  attack: { id: "e7", wait_s: 10 }, open: { id: "s65539", wait_s: 10 },
  move_item: { from: "self", item: "wood", to: "box", count: 5 },
  craft: { recipe: "core:pick", count: 1, learn: true }, use_item: { item: "water" },
  mount: { id: "e7", wait_s: 10 }, carry: { put: "down" }, order: { id: "e7", order: "follow" },
  place: { item: "core:piece_foundation_wood", x: 10, z: 10, wait_s: 10 },
  structure: { id: "s65539", do: "repair", wait_s: 10 }, rise: { place: 0 },
  level_up: { stat: "weight" }, say: { channel: "local", text: "Hello." }, cancel: {}, travel: {}, console: { line: "help" },
};

export function publicMcpTools(): ToolDef[] { return [...toolDefs(true), ...TRAVEL_DEFS]; }
const mode = (tool: ToolDef): string => tool.name === "console" ? "opt-in" : tool.annotations?.readOnlyHint ? "read" : "action";
const modeLabel = (tool: ToolDef): string => ({ read: "Read", action: "Player action", "opt-in": "Opt-in console" })[mode(tool)]!;
const json = (value: unknown): string => JSON.stringify(value, null, 2);

function code(id: string, value: string, label: string): string {
  return `<div class="code-block"><div class="section-head"><span class="eyebrow">${escape(label)}</span><button class="button" type="button" data-copy-target="${id}" aria-label="Copy ${escape(label)}">Copy</button></div><pre><code id="${id}">${escape(value)}</code></pre></div>`;
}

function schemaRows(tool: ToolDef): string {
  const properties = Object.entries(tool.inputSchema.properties);
  if (!properties.length) return '<p class="muted">No arguments.</p>';
  return `<div class="table-scroll"><table class="schema-table"><thead><tr><th>Argument</th><th>Type</th><th>Details</th></tr></thead><tbody>${properties.map(([key, raw]) => {
    const value = raw as { type?: string; description?: string; enum?: unknown[]; minimum?: number; maximum?: number; oneOf?: { type?: string }[] };
    const type = value.type ?? value.oneOf?.map((v) => v.type).join(" / ") ?? "value";
    const range = [value.minimum === undefined ? "" : `Min ${value.minimum}`, value.maximum === undefined ? "" : `Max ${value.maximum}`].filter(Boolean).join(" · ");
    return `<tr><th scope="row"><code>${escape(key)}</code>${tool.inputSchema.required?.includes(key) ? ' <span class="small-label">Required</span>' : ""}</th><td>${escape(type)}</td><td>${escape(value.description ?? "")}${value.enum ? `<div class="tag-list">${value.enum.map((v) => `<code>${escape(v)}</code>`).join(" ")}</div>` : ""}${range ? `<small>${escape(range)}</small>` : ""}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function toolBody(tool: ToolDef): string {
  const example = MCP_EXAMPLES[tool.name];
  return `<p>${escape(tool.description)}</p>${tool.name === "console" ? '<p class="notice">Requires <code>--console</code>. The server checks permissions for each command. <a href="/commands/">Command reference</a></p>' : ""}${sectionHead("Arguments")}${schemaRows(tool)}${example ? code(`example-${tool.name}`, json({ name: tool.name, arguments: example }), "tools/call params") : ""}<details class="reference-details"><summary>Full input and output schemas</summary><pre class="code-block">${escape(json({ inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations }))}</pre></details>`;
}

export async function renderMcp(data: GuideData, outDir: string): Promise<void> {
  const tools = publicMcpTools();
  const write = async (path: string, title: string, body: string, detail = false): Promise<void> => {
    const dir = join(outDir, path); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), layout(data, title, "mcp", body, detail ? [{ label: "MCP", href: "/mcp/" }] : []));
  };
  const connect = code("mcp-command", "bun agent/main.ts --url ws://localhost:8787/ws --name Scout", "Run from the repository") +
    `<details class="reference-details"><summary>MCP client configuration</summary>${code("mcp-config", json({ mcpServers: { survivor: { command: "bun", args: ["/path/to/SNARK/agent/main.ts", "--url", "ws://localhost:8787/ws", "--name", "Scout"] } } }), "stdio client example")}<p>Replace the repository path, game server URL and character name. Keep join credentials in the client process environment (<code>SNARK_PASSWORD</code>), outside this wiki.</p></details>`;
  const steps = [
    ["Look", "observe", "Find nearby things and their IDs."],
    ["Check", "status", "Read your inventory, vitals and available spawn choices."],
    ["Act", "go_to", "Use an observed ID, then follow progress with status."],
    ["Stop", "cancel", "Release the running task before starting another."],
  ];
  const workflow = `<div class="reference-grid">${steps.map(([label, name, detail], i) => `<a class="reference-card" href="/mcp/${name}/"><span class="eyebrow">0${i + 1} · ${label}</span><h3><code>${name}</code> ${icon("arrow")}</h3><p>${detail}</p></a>`).join("")}</div>`;
  const resourceCards = RESOURCES.map((resource) => `<article class="reference-card"><span class="eyebrow">${escape(resource.mimeType)}</span><h3>${escape(resource.title ?? resource.name)}</h3><code>${escape(resource.uri)}</code><p>${escape(resource.description)}</p>${code(`resource-${resource.name}`, json({ uri: resource.uri }), "resources/read params")}</article>`).join("");
  const records = tools.map((tool) => `<details class="reference-card reference-details" data-record data-name="${escape(tool.name)}" data-kind="${mode(tool)}" data-query="${escape(`${tool.name} ${tool.title} ${tool.description}`.toLowerCase())}"><summary><span><code>${escape(tool.name)}</code><small>${escape(tool.title ?? tool.name)}</small></span><span class="small-label">${modeLabel(tool)}</span></summary><a class="text-link" href="/mcp/${escape(tool.name)}/">Open reference ${icon("arrow")}</a>${toolBody(tool)}</details>`).join("");
  const body = heading("MCP", "Tools & automation", "Play through tools. One agent, one survivor.") +
    `<div class="tab-bar"><a href="#connect">Connect</a><a href="#tools">Tools</a><a href="#resources">Resources</a><a href="#examples">Examples</a><a href="/mcp/tools.json">JSON reference</a></div>` +
    `<section id="connect">${sectionHead("Connect an agent", "Local stdio connector → game server")}${connect}<p class="muted">The connector joins as a player. This wiki only publishes documentation.</p></section>` +
    `<section id="examples">${sectionHead("First session")}${workflow}<p class="muted">Example IDs and coordinates are placeholders. Use the values returned by your session.</p>${code("mcp-observe", json({ name: "observe", arguments: MCP_EXAMPLES.observe }), "First tools/call params")}<details class="reference-details"><summary>Tasks, results and cluster travel</summary><p>One task runs at a time. <code>wait_s</code> returns control while a task continues; <code>status</code> checks it and <code>cancel</code> stops it. Results carry <code>done</code>, <code>running</code>, <code>blocked</code>, <code>danger</code> or <code>refused</code>.</p><p><code>travel {}</code> lists the connected cluster. Supply a returned server name as <code>to</code> to walk to a terminal and transfer. This changes the active game server.</p><p>Resources reflect content tuned by the connected server. Wiki catalogue values remain base values unless a published setting says otherwise.</p></details></section>` +
    `<section id="tools" data-filter-area>${sectionHead("Tool reference", `${tools.length - 1} player tools · console available by opt-in`)}${filterBar(tools.length, [{ value: "read", label: "Read" }, { value: "action", label: "Player actions" }, { value: "opt-in", label: "Opt-in console" }], "Find a tool or action")}<div class="reference-list" data-record-list>${records}</div>${noResults}</section>` +
    `<section id="resources">${sectionHead("Resources", "Read through your MCP client") }<div class="reference-grid">${resourceCards}</div></section>`;
  await write("mcp", "MCP", body);
  for (const tool of tools) await write(`mcp/${tool.name}`, tool.name, heading(tool.title ?? tool.name, `MCP · ${modeLabel(tool)}`) + `<article class="reference-card">${toolBody(tool)}</article>`, true);
  await writeFile(join(outDir, "mcp/tools.json"), json({ version: 1, revision: data.revision, transport: "stdio", tools: tools.map((tool) => ({ ...tool, availability: tool.name === "console" ? "--console" : "default" })), resources: RESOURCES }));
}
