// Creative mode end to end: bShowCreativeMode reaching clients, the menu's entry, the password asked of anyone without the
// role, CreativeForAll, the server's judgement of every turn of the sundial, and what a turn leaves in the journal.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { HudModel } from "../../client/core/hud.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { SkyClock } from "../../client/core/sky.ts";
import { KEY_CREATIVE_ANSWER, KEY_CREATIVE_PANEL, KEY_CREATIVE_PASSWORD, KEY_CREATIVE_UNLOCK, KEY_CREATIVE_WARNING } from "../../client/core/ui/creative.ts";
import { KEY_MENU_CREATIVE } from "../../client/core/ui/menu.ts";
import { K_SECRET } from "../../client/core/ui/nodes.ts";
import { S_MENU_WARN } from "../../client/core/ui/style.ts";
import { KEY_SUNDIAL, angleOfHour } from "../../client/core/ui/sundial.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { OP_ADMIN } from "../../server/console.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { CMD_CLOCK, REJECT_DENIED, RESULT_DENIED, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { CLOCK_SHARES, UNIT_CLOCK, hourOfDay, shareOfHour } from "../../shared/sim/clock.ts";
import { listener } from "../fixtures/module.ts";
import { Harness } from "../fixtures/net.ts";

const root = resolve(import.meta.dir, "../..");

/** Rules from the two files: lines of Game.ini's section, then whole lines of GameUserSettings.ini. */
function rulesOf(game: string[], gus: string[] = []) {
  const made = loadConfig({ game: ["[/script/shootergame.shootergamemode]", ...game].join("\n"), gus: gus.join("\n") });
  expect([made.report.refused, made.report.unknown, made.report.waiting]).toEqual([[], [], []]);
  return made.rules;
}
const CREATIVE = ["bShowCreativeMode=True"];

/** The interface of `session`, laid out once. */
function screen(session: ClientSession) {
  const ui = new Ui(), hud = new HudModel();
  const build = () => {
    ui.build(16 / 9, hud, session);
    return ui.frame;
  };
  return { ui, hud, build };
}

test("bShowCreativeMode reaches clients as it changes, and the menu's Creative entry and screen come and go with it", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  const { ui, build } = screen(ada);
  ui.openMenu();
  expect([ada.creative, build().find(KEY_MENU_CREATIVE)]).toEqual([false, null]);
  expect(h.host.setSetting("bShowCreativeMode", "True")).toBe("");
  h.run(200);
  const entry = build().find(KEY_MENU_CREATIVE)!;
  expect([ada.creative, entry.text, entry.interactive]).toEqual([true, "Creative", true]);
  ui.pointer(0, KEY_MENU_CREATIVE, 0, 0, 0, ada);
  let f = build();
  expect([ui.creative, f.find(KEY_CREATIVE_PANEL) !== null, f.find(KEY_CREATIVE_PASSWORD)?.kind, f.find(KEY_MENU_CREATIVE)]).toEqual([true, true, K_SECRET, null]);
  // Escape goes back to the menu, to the entry it came from, and again leaves the menu.
  ui.key("Escape", true, false, ada);
  expect([ui.menu, ui.creative, ui.menuFocus]).toEqual([true, false, KEY_MENU_CREATIVE]);
  ui.pointer(0, KEY_MENU_CREATIVE, 0, 0, 0, ada);
  // Switched off while the screen is open, the screen and the entry go.
  expect(h.host.setSetting("bShowCreativeMode", "False")).toBe("");
  h.run(200);
  f = build();
  expect([ada.creative, ui.creative, f.find(KEY_CREATIVE_PANEL), f.find(KEY_MENU_CREATIVE), ui.menu]).toEqual([false, false, null, null, true]);
});

test("one without the role is asked the admin password, judged and counted as enablecheats is, and told before the guess that ends the connection", () => {
  const h = new Harness({}, 1, 60, { adminPassword: "hunter2", config: rulesOf(CREATIVE) });
  const bo = h.join("bo"), cy = h.join("cy");
  h.run(500);
  const { ui, build } = screen(bo);
  ui.openMenu();
  ui.pointer(0, KEY_MENU_CREATIVE, 0, 0, 0, bo);
  let f = build();
  expect([ui.menuFocus, f.find(KEY_SUNDIAL), f.find(KEY_CREATIVE_UNLOCK)!.interactive, f.find(KEY_CREATIVE_WARNING)!.text]).toEqual([KEY_CREATIVE_PASSWORD, null, false, "Three wrong passwords end the connection."]);
  // The field has the keys it types with; Enter sends what was typed.
  expect([ui.key("KeyN", true, false, bo), ui.key("Space", true, false, bo), ui.key("ArrowLeft", true, false, bo)]).toEqual([false, false, false]);
  ui.input(KEY_CREATIVE_PASSWORD, "nope");
  expect(build().find(KEY_CREATIVE_UNLOCK)!.interactive).toBe(true);
  expect(ui.key("Enter", true, false, bo)).toBe(true);
  h.run(300);
  f = build();
  expect([f.find(KEY_CREATIVE_ANSWER)!.text, f.find(KEY_CREATIVE_WARNING)!.text, f.find(KEY_CREATIVE_PASSWORD)!.text]).toEqual(["Wrong password.", "Two more wrong passwords end the connection.", ""]);
  ui.input(KEY_CREATIVE_PASSWORD, "still not");
  ui.pointer(0, KEY_CREATIVE_UNLOCK, 0, 0, 0, bo);
  h.run(300);
  const warning = build().find(KEY_CREATIVE_WARNING)!;
  expect([warning.text, warning.style, bo.state]).toEqual(["One more wrong password ends the connection.", S_MENU_WARN, "active"]);
  // The right one gives the role, and the tools take the screen and the focus.
  ui.input(KEY_CREATIVE_PASSWORD, "hunter2");
  ui.key("Enter", true, false, bo);
  h.run(300);
  build();
  f = build();
  expect([bo.admin, f.find(KEY_SUNDIAL)?.interactive, f.find(KEY_CREATIVE_PASSWORD), ui.menuFocus]).toEqual([true, true, null, KEY_SUNDIAL]);
  expect(h.host.exec("who").split("\n").sort()).toEqual(["bo  alive  admin", "cy  alive"]);

  // The screen and the console count the same guesses: two here, one typed, and the third ends the connection.
  const other = screen(cy);
  other.ui.openMenu();
  other.ui.pointer(0, KEY_MENU_CREATIVE, 0, 0, 0, cy);
  for (const guess of ["a", "b"]) {
    other.ui.input(KEY_CREATIVE_PASSWORD, guess);
    other.ui.key("Enter", true, false, cy);
    h.run(300);
    other.build();
  }
  expect(other.build().find(KEY_CREATIVE_WARNING)!.text).toBe("One more wrong password ends the connection.");
  h.say(cy, "enablecheats c");
  expect([cy.state, cy.closeReason]).toEqual(["closed", REJECT_DENIED]);
});

test("CreativeForAll gives the role as each survivor enters while creative mode is shown, tells modules, and who says so", () => {
  const ears = listener("ears", ["session.admin"]);
  const h = new Harness({}, 1, 60, { config: rulesOf(CREATIVE, ["[SnarkSettings]", "CreativeForAll=True"]), modules: [ears.def], log: () => {} });
  const ada = h.join("ada");
  h.run(500);
  expect([ada.admin, ears.heard.lines]).toEqual([true, [`session.admin: {"pid":${h.client(ada)!.pid}}`]]);
  expect(h.host.exec("who")).toBe("ada  alive  admin");
  expect(h.say(ada, "settime 6")).toEqual(["time is 06:00"]);
  // Without creative mode shown it gives nothing; shown again while the server runs, it reaches those already in.
  expect(h.host.setSetting("bShowCreativeMode", "False")).toBe("");
  const bo = h.join("bo");
  h.run(500);
  expect(bo.admin).toBe(false);
  expect(h.host.setSetting("bShowCreativeMode", "True")).toBe("");
  h.run(200);
  expect(bo.admin).toBe(true);
  expect(h.host.exec("who").split("\n").sort()).toEqual(["ada  alive  admin", "bo  alive  admin"]);
  // Switched off, nobody loses the role before leaving, and a survivor who joins after has none.
  expect(h.host.setSetting("CreativeForAll", "False")).toBe("");
  const cy = h.join("cy");
  h.run(500);
  expect([ada.admin, bo.admin, cy.admin, ears.heard.lines.length]).toEqual([true, true, false, 2]);
});

test("the server judges every turn: one without the role is refused whatever its client claims, and everyone is while creative mode is off", () => {
  const h = new Harness({}, 1, 60, { dev: true, config: rulesOf(CREATIVE) });
  const ada = h.join("ada"), bo = h.join("bo");
  h.run(500);
  const answers = new Map<number, number>(), adas = new Map<number, number>();
  bo.onResult = (seq, code) => answers.set(seq, code);
  ada.onResult = (seq, code) => adas.set(seq, code);
  const turn = (s: ClientSession, hour: number, share = shareOfHour(hour)): number => s.command(CMD_CLOCK, (w) => (w.u16(share), w.bool(true)));
  const offset = h.world.dayOffset;
  // Its client claims the role, so its screen shows the dial and its hand turns it; the server refuses each message.
  bo.admin = true;
  const { ui, hud, build } = screen(bo);
  ui.openMenu();
  ui.pointer(0, KEY_MENU_CREATIVE, 0, 0, 0, bo);
  build();
  const box = ui.creativeScreen.sundial.box, a = angleOfHour(20, bo.clock) * Math.PI * 2;
  ui.pointer(0, KEY_SUNDIAL, box.cx + box.radius * 0.8 * Math.sin(a), box.cy - box.radius * 0.8 * Math.cos(a), 0, bo);
  build();
  ui.pointer(1, KEY_SUNDIAL, box.cx + box.radius * 0.8 * Math.sin(a), box.cy - box.radius * 0.8 * Math.cos(a), 0, bo);
  const claimed = turn(bo, 20);
  h.run(300);
  expect([[...answers.values()].every((c) => c === RESULT_DENIED), answers.size >= 3, answers.get(claimed), h.world.dayOffset]).toEqual([true, true, RESULT_DENIED, offset]);
  // Its own sky goes back to the server's hour once the turn is not taken.
  hud.hour = hourOfDay(bo.serverTick, bo.dayOffset, bo.clock);
  h.run(2500, () => build());
  expect(Number.isNaN(ui.creativeScreen.sundial.held)).toBe(true);
  // An admin's turn is taken; an hour past the day's last step is not; and with creative mode off nobody's is.
  h.say(ada, "enablecheats");
  const taken = turn(ada, 20);
  const past = turn(ada, 0, CLOCK_SHARES);
  h.run(300);
  expect([adas.get(taken), adas.get(past), Math.abs(hourOfDay(h.world.tick, h.world.dayOffset, h.world.clock) - 20) < 0.01]).toEqual([RESULT_OK, RESULT_INVALID, true]);
  expect(h.host.setSetting("bShowCreativeMode", "False")).toBe("");
  h.run(100);
  const off = h.world.dayOffset;
  const refused = turn(ada, 4);
  h.run(300);
  expect([adas.get(refused), h.world.dayOffset, h.say(ada, "settime 7")]).toEqual([RESULT_DENIED, off, ["time is 07:00"]]);
});

test("a drag of the dial is one entry in the journal, reaches everyone while it turns, and moves nothing that runs on the tick", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-creative-"));
  const db = join(dir, "world.db");
  try {
    const h = new Harness({}, 1, 60, { dev: true, dbPath: db, config: rulesOf(CREATIVE) });
    const ada = h.join("ada"), bo = h.join("bo");
    h.run(500);
    h.say(ada, "enablecheats");
    // Raw meat in bo's bag spoils on the tick, whatever the hour.
    const rec = h.host.records.byPid.get(h.client(bo)!.pid)!;
    const meat = h.reg.index.get("core:meat")!;
    expect(h.host.items.mint(rec, meat, 3)).toBeGreaterThan(0);
    const inv = h.host.items.inv(rec), slot = inv.item.indexOf(meat), spoilAt = inv.spoilAt[slot]!;
    expect(spoilAt).toBeGreaterThan(h.world.tick);

    const { ui, hud, build } = screen(ada);
    const sent: number[] = [];
    const command = ada.command.bind(ada);
    ada.command = (op, args) => {
      if (op === CMD_CLOCK) sent.push(h.world.tick);
      return command(op, args);
    };
    ui.openMenu();
    ui.pointer(0, KEY_MENU_CREATIVE, 0, 0, 0, ada);
    build();
    // Enter and Space on the dial press its middle, where the hour is read, and turn nothing.
    ui.key("Enter", true, false, ada);
    ui.key("Space", true, false, ada);
    build();
    expect([ui.menuFocus, sent.length, Number.isNaN(ui.creativeScreen.sundial.held)]).toEqual([KEY_SUNDIAL, 0, true]);
    const box = ui.creativeScreen.sundial.box;
    const at = (hour: number): [number, number] => {
      const a = angleOfHour(hour, UNIT_CLOCK) * Math.PI * 2;
      return [box.cx + box.radius * 0.8 * Math.sin(a), box.cy - box.radius * 0.8 * Math.cos(a)];
    };
    // From nine in the morning to half past five, over two seconds, through noon.
    const [tick, ms] = [h.world.tick, h.now];
    const seen = new Set<number>(), hours: number[] = [];
    // bo's sky, and the hour it is told, frame by frame.
    const sky = new SkyClock(), told: number[] = [], shown: number[] = [];
    let frame = 0;
    ui.pointer(0, KEY_SUNDIAL, ...at(9), 0, ada);
    h.run(2000, () => {
      ui.pointer(2, KEY_SUNDIAL, ...at(9 + 8.5 * Math.min(1, frame++ / 110)), 0, ada);
      hud.hour = ui.creativeScreen.sundial.held;
      build();
      seen.add(bo.dayOffset);
      hours.push(hourOfDay(h.world.tick, h.world.dayOffset, h.world.clock));
      told.push(hourOfDay(bo.serverTick, bo.dayOffset, bo.clock));
      shown.push(sky.step(bo.serverTick, bo.dayOffset, bo.clock, 1000 / 60, NaN, bo.creative));
    });
    ui.pointer(1, KEY_SUNDIAL, ...at(17.5), 0, ada);
    h.run(500, () => build());
    const now = (s: ClientSession): number => hourOfDay(s.latestSnapshot, s.dayOffset, s.clock);
    expect(Math.abs(hourOfDay(h.world.tick, h.world.dayOffset, h.world.clock) - 17.5)).toBeLessThan(0.01);
    expect(Math.abs(now(bo) - now(ada))).toBeLessThan(0.01);
    // At most ten messages a second, the last its own; the server's hour followed the hand through the day, and bo was told each step.
    expect(sent.length).toBeLessThanOrEqual(2 * 10 + 2);
    expect(sent.length).toBeGreaterThan(12);
    expect(seen.size).toBeGreaterThan(12);
    expect(hours.some((x) => x > 11 && x < 13)).toBe(true);
    // bo is told the hour in steps, and its sun sweeps between them: its largest move in a frame is a fraction of the largest step.
    const most = (list: number[]): number => Math.max(...list.slice(1).map((x, i) => Math.abs(x - list[i]!)));
    expect(most(told)).toBeGreaterThan(0.3);
    expect(most(shown)).toBeLessThan(most(told) / 3);
    // A second turn, by the arrow keys: three quarters of an hour later is one more entry.
    ui.menuFocus = KEY_SUNDIAL;
    for (let i = 0; i < 3; i++) {
      ui.key("ArrowRight", true, false, ada);
      h.run(100, () => build());
    }
    h.run(1000, () => build());
    expect(Math.abs(hourOfDay(h.world.tick, h.world.dayOffset, h.world.clock) - 18.25)).toBeLessThan(0.01);

    // The tick kept its own pace through both turns, and the meat's tick to spoil is as it was.
    expect(Math.abs(h.world.tick - tick - ((h.now - ms) * TICK_RATE) / 1000)).toBeLessThanOrEqual(1);
    expect([inv.item[slot], inv.spoilAt[slot]]).toEqual([meat, spoilAt]);
    // Nothing on the server reads the offset but where the hour is told, set, saved and kept across a change of pace.
    const readers: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && readFileSync(p, "utf8").includes("dayOffset")) readers.push(relative(root, p));
      }
    };
    walk(join(root, "server"));
    expect(readers.sort()).toEqual(["server/commands/core.ts", "server/creative.ts", "server/game.ts", "server/host.ts", "server/persist/persistence.ts", "server/world.ts"]);
    h.host.shutdown();

    const store = new WorldStore(db, h.reg);
    const lines = store.journal().filter((j) => j.op === OP_ADMIN).map((j) => new TextDecoder().decode(j.data));
    store.close();
    expect(lines).toEqual(["ada\tsettime 17:30", "ada\tsettime 18:15"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with creative mode off a server is as it was: no entry, no rule bit, and not a byte more on the wire", () => {
  const bytes = (config?: ReturnType<typeof rulesOf>): [number, boolean] => {
    const h = new Harness({}, 1, 60, { dev: true, ...(config ? { config } : {}) });
    const ada = h.join("ada");
    h.run(3000);
    return [ada.stats.bytesIn, ada.creative];
  };
  const [plain, off, on] = [bytes(), bytes(rulesOf(["bShowCreativeMode=False"])), bytes(rulesOf(CREATIVE))];
  expect([plain[1], off[1], on[1]]).toEqual([false, false, true]);
  // The bit rides in the rules' flags every client was sent before.
  expect([off[0], on[0]]).toEqual([plain[0], plain[0]]);
});
