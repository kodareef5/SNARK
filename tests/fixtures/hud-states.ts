// A survivor in a real session, walked through the HUD's states, for tests that look at every frame's nodes.
import { App } from "../../client/core/app.ts";
import { HUD_WIDGETS } from "../../client/core/hud/widgets.ts";
import { KEY_CONSOLE_INPUT } from "../../client/core/ui/console.ts";
import { WIDGET_OWNER, baseKey, type UiNode } from "../../client/core/ui/nodes.ts";
import * as touch from "../../client/core/ui/touch.ts";
import { installFieldIcons } from "../../client/core/ui/field-icons.ts";
import { V_OXYGEN, V_TORPOR } from "../../shared/sim/vitals.ts";
import { Harness } from "./net.ts";
import { corePack } from "./pack.ts";

export interface HudState { name: string; nodes: UiNode[] }

/** Who drew a node, by name: a screen's, a widget's, or "ui" for the interface's own. */
export function drawer(app: App, n: UiNode): string {
  if (n.owner >= 0) return "screen:" + app.ui.screens[n.owner]!.name;
  if (n.owner <= WIDGET_OWNER) return "widget:" + HUD_WIDGETS[WIDGET_OWNER - n.owner]!.name;
  return "ui";
}

/** Keys drawn twice in one frame, with who drew each. */
export function clashes(app: App, nodes: UiNode[]): string[] {
  const seen = new Map<number, UiNode>(), out: string[] = [];
  for (const n of nodes) {
    const was = seen.get(n.key);
    if (was) out.push(`${n.key} (base ${baseKey(n.key)}): ${drawer(app, was)} and ${drawer(app, n)}`);
    else seen.set(n.key, n);
  }
  return out;
}

/** Calls `look` with the frame's nodes in each state the HUD is reached in. */
export function walkHudStates(look: (app: App, state: string) => void): void {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("States", { latencyMs: 20 }, { manual: true }), h.reg, corePack());
  installFieldIcons(app.ui.frame, { icons: "field-icons.webp", equipment: "field-equipment.webp", parts: "field-parts.webp", touch: "field-touch.webp" });
  app.ui.layer = touch;
  let w = 1440, ht = 810;
  const run = (ms = 64) => h.run(ms, now => app.frame(now, w, ht));
  const press = (code: string) => { app.key(code, true); app.key(code, false); run(); };
  const say = (line: string) => { press("Backquote"); app.textInput(KEY_CONSOLE_INPUT, line); press("Enter"); press("Backquote"); run(200); };
  run(600);
  say("enablecheats");
  for (const item of ["berry 5", "waterskin", "spyglass", "pick", "bow", "torch"]) say("give " + item);
  run(300);
  const both = (state: string) => {
    for (const device of [0, 2]) {
      app.ui.inputDevice = device;
      [w, ht] = device ? [844, 390] : [1440, 810];
      run(); run();
      look(app, state + (device ? " by touch" : ""));
    }
    app.ui.inputDevice = 0; [w, ht] = [1440, 810]; run();
  };
  both("at rest");
  const rec = h.host.records.byPid.get(h.client(app.session)!.pid)!;
  h.host.survival.add(rec, V_TORPOR, 40);
  h.host.survival.add(rec, V_OXYGEN, -30);
  run(400);
  both("torpor and oxygen");
  app.ui.settings.diagnostics = true; both("diagnostics");
  app.ui.settings.vitalLabels = true; both("vital labels");
  app.ui.settings.diagnostics = app.ui.settings.vitalLabels = false;
  app.ui.settings.muted = true; both("muted"); app.ui.settings.muted = false;
  app.ui.inspect = true; both("inspect"); app.ui.inspect = false;
  app.ui.settings.minimap = false; both("no minimap"); app.ui.settings.minimap = true;
  press("F2"); look(app, "field menu"); press("Escape");
  press("F4"); look(app, "action families"); press("Enter"); look(app, "whistles"); press("Escape"); press("Escape");
  press("KeyM"); look(app, "corner chart"); press("KeyM");
  press("KeyI"); look(app, "inventory"); press("KeyI");
  press("Enter"); look(app, "chat"); press("Escape");
  [w, ht] = [390, 844]; app.ui.inputDevice = 2; run(); run(); look(app, "upright phone");
}
