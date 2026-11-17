import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

// A page's address may not speak or look for its player. Only a tool's own server gives a page lines to send and a way to
// face (client/shell/main.ts asks it), and the same address on any other page sends nothing and holds nothing.
test("an address sends no line the player did not type and holds no view; a tool's orders from its own server do", () => {
  const h = new Harness();
  try {
    const sent = (tool: boolean): [string[], number, number] => {
      const session = h.join(tool ? "tool" : "player", {}, { manual: true });
      const app = new App(session, h.reg, corePack());
      const lines: string[] = [];
      const text = session.text.bind(session);
      session.text = (line: string): number => (lines.push(line), text(line));
      const address = (name: string): string | null => ({ run: "suicide|settime 3", look: "1,0.25", tier: "high" })[name] ?? null;
      app.address(address, tool, tool ? { run: ["settime 6"], look: [1, 0.25] } : null);
      app.controls.yaw = 0.3;
      app.controls.pitch = 0.1;
      h.run(3000, (now) => app.frame(now, 640, 360));
      return [lines, app.controls.yaw, app.controls.pitch];
    };
    expect(sent(false)).toEqual([[], 0.3, 0.1]);
    expect(sent(true)).toEqual([["settime 6"], 1, 0.25]);
  } finally {
    h.host.shutdown();
  }
});
