// The part of Pi's extension API that grunt uses, written here because the repository takes no packages
// (tools/check.ts). Pi hands the extension its real `ExtensionAPI`; these are structural subsets of the types of
// @earendil-works/pi-coding-agent 1.4. Tool parameters are plain JSON Schema, which Pi validates as such (it coerces and
// checks a schema that is not TypeBox's). Add to these as grunt uses more of Pi, from Pi's own declarations.

export type NotifyType = "info" | "warning" | "error";

export interface PiUi {
  notify(message: string, type?: NotifyType): void;
}

export interface PiCommandContext {
  ui: PiUi;
}

export interface PiCommand {
  description?: string;
  handler: (args: string, ctx: PiCommandContext) => Promise<void>;
}

export interface PiToolResult {
  content: { type: "text"; text: string }[];
  details: unknown;
  /** Ends the model's turn after this tool, when every tool of the batch agrees. */
  terminate?: boolean;
}

export interface PiTool {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: Record<string, unknown>;
  execute(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown): Promise<PiToolResult>;
}

export interface PiMessage {
  customType: string;
  content: string;
  display: boolean;
  details?: unknown;
}

export interface PiExtensionAPI {
  registerCommand(name: string, command: PiCommand): void;
  registerTool(tool: PiTool): void;
  sendMessage(message: PiMessage, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
  on(event: "session_shutdown", handler: () => void | Promise<void>): unknown;
  on(event: "before_agent_start", handler: (event: { systemPromptOptions: { customPrompt?: string; sections?: Record<string, string> } }) => void | Promise<void>): unknown;
}
