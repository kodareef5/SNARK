// The HUD and its screens through the whole client, for pictures: `bun run snap -- --hud MODE` (--size WxH).
// Modes: play, menu, settings, audio, controls, controller, drive, drive-hidden (the minimap hidden, H held), ride, riding, station,
// creative (the sundial at 17:30, facing the low sun), creative-night (at 22:30) and creative-locked (the password asked).

import type { App } from "../../client/core/app.ts";
import { BOX_SELF, CMD_MOVE, CMD_STRUCT } from "../../shared/net/protocol.ts";
import { KEY_MENU_CREATIVE } from "../../client/core/ui/menu.ts";
import { NO_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../../tests/fixtures/arena.ts";
import type { Harness } from "../../tests/fixtures/net.ts";

export const HUD_MODES = ["play", "menu", "settings", "audio", "controls", "controller", "drive", "drive-hidden", "ride", "riding", "station", "creative", "creative-night", "creative-locked"] as const;
export type HudMode = (typeof HUD_MODES)[number];

/** The setup for clientPicture (tools/snap.ts): a survivor with things in her hotbar, then the screen or scene `mode` names. */
export function hudScene(app: App, run: (ms: number) => void, h: Harness, mode: HudMode): void {
  const s = app.session, ents = h.world.ents, id = (name: string): number => h.reg.index.get(`core:${name}`)!;
  s.text("enablecheats");
  run(300);
  for (const line of ["give spear", "give pick", "give hatchet", "give bow", "give arrow_stone 40", "give waterskin", "give torch", "give berry 24"]) {
    s.text(line);
    run(100);
  }
  // What was given goes to the hotbar's first slots, as a player drags it there.
  const inv = s.inventory!;
  for (let from = 0, to = 0; from < inv.hotbar && to < 8; from++) {
    if (inv.item[from] === 0) continue;
    const [slot, item] = [inv.hotbar + to++, inv.item[from]!];
    s.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(slot), w.u16(0), w.u16(item)));
    run(100);
  }
  const g = flatGround(h, 60, 60), x = g.x + 30, z = g.z + 10;
  s.text(`tp ${x.toFixed(3)} ${z.toFixed(3)}`);
  run(500);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const c = app.controls;
  c.yaw = 0;
  c.pitch = -0.1;
  if (mode === "menu" || mode === "settings" || mode === "audio" || mode === "controls" || mode === "controller") {
    app.ui.openMenu();
    app.ui.options = mode === "settings" || mode === "audio";
    app.ui.settings.tab = mode === "audio" ? 1 : 0;
    app.ui.help = mode === "controls" || mode === "controller";
    app.ui.helpDevice = mode === "controller" ? 1 : 0;
  } else if (mode === "drive" || mode === "drive-hidden") {
    const car = h.host.spawnVehicle("core:compact", x - 1.6, z - 0.12, me.team, 0);
    if (h.host.urban.mount(h.client(s)!, car) !== 0) throw new Error("could not get into the car");
    run(800);
    app.key("KeyW", true);
    run(2500);
    if (mode === "drive-hidden") {
      app.ui.settings.minimap = false;
      app.key("KeyH", true);
    }
  } else if (mode === "ride" || mode === "riding") {
    const e = h.host.spawnCreature("core:raptor", x, z + 3, 30);
    const rec = h.host.records.byPid.get(ents.pid[e]!)!;
    rec.team = me.team;
    rec.saddle = id("saddle_raptor");
    h.host.refreshBody(rec);
    h.host.creatures.claimed(e);
    h.host.creatures.mind.stay(e, 0xffffffff);
    run(400);
    if (mode === "riding") {
      h.host.riding.mount(h.client(s)!, e);
      run(1200);
    }
  } else if (mode === "creative" || mode === "creative-night" || mode === "creative-locked") {
    if (h.host.setSetting("bShowCreativeMode", "True") !== "") throw new Error("creative mode would not come on");
    s.text(`settime ${mode === "creative-night" ? "22:30" : "17:30"}`);
    run(400);
    // Toward where the sun sets (render/sky.ts, +X), seen past the panel on the left.
    c.yaw = Math.PI / 2;
    c.pitch = 0.04;
    if (mode === "creative-locked") {
      const me = h.client(s)!;
      me.admin = false;
      me.ownDirty = true;
      run(200);
    }
    app.ui.openMenu();
    app.ui.pointer(0, KEY_MENU_CREATIVE, 0, 0, 0, s);
    run(400);
  } else if (mode === "station") {
    const fire = h.world.structs.add(id("campfire"), x, g.y + h.reg.halfY[id("campfire")]!, z + 2, 0, me.team, 100);
    const rec = h.host.fixtures.ensure(fire);
    h.host.items.mint(rec, id("wood"), 10);
    h.host.items.mint(rec, id("meat"), 3);
    s.command(CMD_STRUCT, (w) => (w.u32(fire), w.u8(STRUCT_USE), w.u16(NO_PIN)));
    run(400);
  }
  run(200);
}
