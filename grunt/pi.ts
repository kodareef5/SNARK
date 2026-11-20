// The part of Pi's extension API that grunt uses, written here because the repository takes no packages
// (tools/check.ts). Pi hands the extension its real `ExtensionAPI`; these are structural subsets of the types of
// @earendil-works/pi-coding-agent 1.4, so that one is accepted where this is asked for. Add to them as grunt uses
// more of Pi, from Pi's own declarations.

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

export interface PiExtensionAPI {
  registerCommand(name: string, command: PiCommand): void;
}
