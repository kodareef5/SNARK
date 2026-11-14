// The Model Context Protocol as a tool server needs it: JSON-RPC 2.0, one object a line. Whoever owns the pipe reads the lines
// and writes what `handle` returns, so a test calls it with no pipe at all.

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

/** What every tool answers. `refused` means nothing was done. */
export type Answer = { state: "done" | "running" | "blocked" | "danger" | "refused" } & Record<string, unknown>;

export interface ToolHost {
  list(): ToolDef[];
  /** Null for a tool it does not have. */
  call(name: string, args: Record<string, unknown>): Promise<Answer> | null;
}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const NO_METHOD = -32601;
export const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/** The revisions spoken, newest first. They do not differ in anything used here. */
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Id = string | number | null;

const reply = (id: Id, result: unknown): string => JSON.stringify({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string): string => JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

export class Mcp {
  private readonly host: ToolHost;
  private readonly name: string;
  private readonly instructions: string;

  /** `instructions` is shown to the model when it connects. */
  constructor(host: ToolHost, name: string, instructions: string) {
    this.host = host;
    this.name = name;
    this.instructions = instructions;
  }

  /** One line in. Resolves with the line to write back, or null where none is owed: a notification, a blank line. */
  async handle(line: string): Promise<string | null> {
    if (line.trim() === "") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return fail(null, PARSE_ERROR, "Parse error");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail(null, INVALID_REQUEST, "Invalid Request");
    const m = parsed as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    const id = typeof m.id === "string" || typeof m.id === "number" ? m.id : null;
    if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
      // An answer to something this never asked is let pass.
      return "result" in m || "error" in m ? null : fail(id, INVALID_REQUEST, "Invalid Request");
    }
    const owed = m.id !== undefined;
    const params = (typeof m.params === "object" && m.params !== null ? m.params : {}) as Record<string, unknown>;
    if (m.method === "initialize") {
      const asked = params.protocolVersion;
      const version = typeof asked === "string" && VERSIONS.includes(asked) ? asked : VERSIONS[0];
      return reply(id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: this.name, version: "1" }, instructions: this.instructions });
    }
    if (m.method === "ping") return owed ? reply(id, {}) : null;
    if (m.method === "tools/list") return reply(id, { tools: this.host.list() });
    if (m.method === "tools/call") {
      const args = params.arguments ?? {};
      if (typeof params.name !== "string" || typeof args !== "object" || args === null || Array.isArray(args)) return fail(id, INVALID_PARAMS, "tools/call takes a name and an object of arguments");
      const pending = this.host.call(params.name, args as Record<string, unknown>);
      if (!pending) return fail(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
      try {
        const answer = await pending;
        return owed ? reply(id, { content: [{ type: "text", text: JSON.stringify(answer) }], isError: answer.state === "refused" }) : null;
      } catch (err) {
        console.error(err);
        return fail(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
      }
    }
    return owed ? fail(id, NO_METHOD, `Method not found: ${m.method}`) : null;
  }
}
