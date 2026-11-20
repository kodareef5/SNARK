// grunt: a Pi extension that plays a game as a player, through the grunt protocol (protocol.md). Pi loads this file
// (package.json's `pi.extensions`) under Node, so nothing here uses Bun's own APIs (tools/check.ts).
// Version 0.0: the package and the protocol's types. Connecting comes with the mock game server.

import { fileURLToPath } from "node:url";
import type { PiExtensionAPI } from "./pi.ts";
import { GRUNT_VERSION } from "./protocol.ts";

export const GRUNT_PACKAGE_VERSION = "0.0.1";
const SPEC = fileURLToPath(new URL("./protocol.md", import.meta.url));

export default function grunt(pi: PiExtensionAPI): void {
  pi.registerCommand("grunt", {
    description: "grunt: play a game as a player (status, protocol)",
    handler: async (args, ctx) => {
      const sub = args.trim().split(/\s+/)[0] || "status";
      if (sub === "protocol") {
        ctx.ui.notify(`grunt protocol ${GRUNT_VERSION} (draft): ${SPEC}`, "info");
      } else if (sub === "status") {
        ctx.ui.notify(`grunt ${GRUNT_PACKAGE_VERSION}, protocol ${GRUNT_VERSION} (draft). Not connected: no game speaks it yet.`, "info");
      } else {
        ctx.ui.notify(`grunt: unknown subcommand "${sub}". Try /grunt status or /grunt protocol.`, "warning");
      }
    },
  });
}
