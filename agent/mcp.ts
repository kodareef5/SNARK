// The Model Context Protocol as a tool server needs it: JSON-RPC 2.0, one object a line. It speaks both eras: a request whose
// `_meta` names its version (2026-07-28) is served on its own, and an `initialize` handshake serves the revisions before it.

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  outputSchema?: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  annotations?: ToolAnnotations;
}

export interface ResourceDef {
  uri: string;
  name: string;
  title?: string;
  description: string;
  mimeType: string;
}

/** What every tool answers. `refused` means nothing was done. */
export type Answer = { state: "done" | "running" | "blocked" | "danger" | "refused" } & Record<string, unknown>;

/** What a call is given besides its arguments. */
export interface CallContext {
  /** Tells the client how far a long call has got. A report that does not rise is dropped, and all are unless the client asked. */
  progress(progress: number, total: number | undefined, message: string): void;
  /** Aborted when the client cancels the request. */
  signal: AbortSignal;
}

export interface ToolHost {
  list(): ToolDef[];
  /** Null for a tool it does not have. */
  call(name: string, args: Record<string, unknown>, ctx?: CallContext): Promise<Answer> | null;
  resources?(): ResourceDef[];
  /** The text of a resource, or null for a uri it does not have. */
  read?(uri: string): string | null;
}

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const NO_METHOD = -32601;
export const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
export const UNSUPPORTED_VERSION = -32022;

/** Revisions served statelessly, by the version in each request's `_meta`. */
export const MODERN = ["2026-07-28"];
/** Revisions served after an `initialize`, newest first. They do not differ in anything used here. */
export const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_KEY = "io.modelcontextprotocol/serverInfo";
/** How long a client may keep the tool and resource lists: they change only with a new build. */
const LIST_TTL_MS = 3_600_000;

type Id = string | number | null;

const fail = (id: Id, code: number, message: string, data?: unknown): string => JSON.stringify({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });

export class Mcp {
  private readonly host: ToolHost;
  private readonly name: string;
  private readonly instructions: string;
  private readonly notify: (line: string) => void;
  /** Requests under way, by id, so a cancellation can find them. */
  private readonly inflight = new Map<string | number, AbortController>();

  /** `instructions` is shown to the model when it connects. `notify` writes a notification line, such as progress, at any time. */
  constructor(host: ToolHost, name: string, instructions: string, notify: (line: string) => void = () => {}) {
    this.host = host;
    this.name = name;
    this.instructions = instructions;
    this.notify = notify;
  }

  private capabilities(): Record<string, unknown> {
    return { tools: {}, ...(this.host.resources ? { resources: {} } : {}) };
  }

  /** One line in. Resolves with the line to write back, or null where none is owed: a notification, a blank line, a cancelled request. */
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
    const meta = (typeof params._meta === "object" && params._meta !== null ? params._meta : {}) as Record<string, unknown>;
    if (!owed) {
      if (m.method === "notifications/cancelled") {
        const which = (params as { requestId?: unknown }).requestId;
        if (typeof which === "string" || typeof which === "number") this.inflight.get(which)?.abort();
      }
      return null;
    }
    // A request that names its version is of the modern era, and its result says what kind it is and who answered.
    const asked = meta[VERSION_KEY];
    const modern = asked !== undefined;
    if (modern) {
      if (typeof asked !== "string" || !MODERN.includes(asked)) return fail(id, UNSUPPORTED_VERSION, "Unsupported protocol version", { supported: [...MODERN, ...LEGACY], requested: asked });
      if (typeof meta[CAPABILITIES_KEY] !== "object" || meta[CAPABILITIES_KEY] === null) return fail(id, INVALID_PARAMS, `_meta needs ${CAPABILITIES_KEY}`);
    }
    const reply = (result: Record<string, unknown>, cached = false): string =>
      JSON.stringify({ jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...result, ...(cached ? { ttlMs: LIST_TTL_MS, cacheScope: "public" } : {}), _meta: { [SERVER_KEY]: { name: this.name, version: "2" } } } : result });

    if (m.method === "initialize") {
      const want = params.protocolVersion;
      const version = typeof want === "string" && LEGACY.includes(want) ? want : LEGACY[0];
      return reply({ protocolVersion: version, capabilities: this.capabilities(), serverInfo: { name: this.name, version: "2" }, instructions: this.instructions });
    }
    if (m.method === "server/discover") return reply({ supportedVersions: [...MODERN, ...LEGACY], capabilities: this.capabilities(), instructions: this.instructions }, true);
    if (m.method === "ping") return reply({});
    if (m.method === "tools/list") return reply({ tools: this.host.list() }, true);
    if (m.method === "resources/list" && this.host.resources) return reply({ resources: this.host.resources() }, true);
    if (m.method === "resources/templates/list" && this.host.resources) return reply({ resourceTemplates: [] }, true);
    if (m.method === "resources/read" && this.host.read) {
      const uri = params.uri;
      const text = typeof uri === "string" ? this.host.read(uri) : null;
      if (text === null) return fail(id, INVALID_PARAMS, "Resource not found", { uri });
      const def = this.host.resources?.().find((r) => r.uri === uri);
      return reply({ contents: [{ uri, mimeType: def?.mimeType ?? "text/plain", text }] });
    }
    if (m.method === "tools/call") {
      const args = params.arguments ?? {};
      if (typeof params.name !== "string" || typeof args !== "object" || args === null || Array.isArray(args)) return fail(id, INVALID_PARAMS, "tools/call takes a name and an object of arguments");
      const abort = new AbortController();
      const token = meta.progressToken;
      let last = -Infinity;
      const ctx: CallContext = {
        signal: abort.signal,
        progress: (progress, total, message) => {
          if (typeof token !== "string" && typeof token !== "number") return;
          if (progress <= last || abort.signal.aborted) return;
          last = progress;
          this.notify(JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress, ...(total !== undefined ? { total } : {}), message } }));
        },
      };
      const pending = this.host.call(params.name, args as Record<string, unknown>, ctx);
      if (!pending) return fail(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
      if (id !== null) this.inflight.set(id, abort);
      try {
        const answer = await pending;
        // A cancelled request is owed no answer.
        if (abort.signal.aborted) return null;
        return reply({ content: [{ type: "text", text: JSON.stringify(answer) }], structuredContent: answer, isError: answer.state === "refused" });
      } catch (err) {
        console.error(err);
        return fail(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
      } finally {
        if (id !== null) this.inflight.delete(id);
      }
    }
    return fail(id, NO_METHOD, `Method not found: ${m.method}`);
  }
}
