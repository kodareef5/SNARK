import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_CONSOLE_INPUT, KEY_CONSOLE_ROW } from "../../client/core/ui/console.ts";
import { KEY_CHAT_INPUT, KEY_CHAT_ROW, KEY_CHAT_TAG } from "../../client/core/ui/chat.ts";
import { KEY_BANNER, KEY_CROSS, KEY_PROMPT, KEY_READOUT, KEY_STATUS, KEY_TALKER, KEY_VITAL, KEY_VOICE } from "../../client/core/ui/hud.ts";
import { KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { KEY_SETTINGS_MIC, KEY_SETTINGS_TAB } from "../../client/core/ui/settings.ts";
import { KEY_MENU_OPEN, KEY_MENU_RESUME } from "../../client/core/ui/menu.ts";
import { BTN_JUMP, BTN_MELEE } from "../../shared/sim/character.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(corePackBytes());

/** A whole client on the harness's virtual clock. */
function client(h: Harness, name: string): App {
  return new App(h.join(name, { latencyMs: 20 }, { manual: true }), h.reg, pack);
}

function consoleRows(app: App): string[] {
  const out: string[] = [];
  const f = app.ui.frame;
  for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_CONSOLE_ROW && f.nodes[i]!.key < KEY_CONSOLE_ROW + 60) out.push(f.nodes[i]!.text);
  return out;
}

test("opening the menu releases held movement and attacks until a deliberate resume", () => {
  const h = new Harness();
  const app = client(h, "menu");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  run(500);
  app.key("KeyW", true);
  app.mouseButton(0, true);
  run(200);
  app.pointer(0, KEY_MENU_OPEN, 0, 0, 0);
  expect(app.controls.buttons).toBe(0);
  expect(app.controls.moveZ).toBe(0);
  run(500);
  const z = app.session.own.z;
  app.key("KeyW", true);
  app.key("KeyR", true);
  app.mouseButton(0, true);
  app.look(200, 100);
  run(500);
  expect(app.session.own.z).toBe(z);
  expect(app.controls.buttons).toBe(0);
  expect(app.controls.yaw).toBe(0);
  app.pointer(0, KEY_MENU_RESUME, 0, 0, 0);
  run(200);
  expect(app.controls.moveZ).toBe(0);
  app.key("KeyW", true);
  run(500);
  expect(app.session.own.z).toBeGreaterThan(z);
});

test("a headless client boots, draws, walks, and its interface says where it is", () => {
  const h = new Harness();
  const app = client(h, "ada");
  app.ui.settings.diagnostics = true;
  expect(app.frame(0, 1280, 720)).toBeNull();
  expect(app.ui.frame.find(KEY_STATUS)!.text).toBe("connecting");
  let packet = null;
  h.run(500, (now) => (packet = app.frame(now, 1280, 720)));
  expect(packet).not.toBeNull();
  expect(packet!.drawCount).toBeGreaterThan(5);
  expect(app.ui.frame.find(KEY_STATUS)).toBeNull();
  expect(app.ui.frame.find(KEY_CROSS)).not.toBeNull();
  expect(app.ui.frame.find(KEY_READOUT)!.text).toBe("53.1 lat  50.0 lon  N 0");
  expect(app.ui.frame.find(KEY_VITAL + 3)!.value).toBe(1); // stamina, from the predicted body

  app.key("KeyW", true);
  h.run(2000, (now) => app.frame(now, 1280, 720));
  app.key("KeyW", false);
  h.run(500, (now) => app.frame(now, 1280, 720));
  const e = h.ent(app.session);
  expect(h.world.ents.z[e]! - 240).toBeGreaterThan(7);
  expect(app.session.own.z).toBe(h.world.ents.z[e]!);
  expect(app.cam.z).toBe(app.session.own.z);
  expect(app.cam.y).toBeCloseTo(app.session.own.y + 1.62, 5);
  expect(app.ui.frame.find(KEY_READOUT + 1)!.text).toContain(`z ${app.session.own.z.toFixed(1)}`);
});

test("the console is typed into, answered by the server, and holds the keyboard while it is open", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = client(h, "ada");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  run(500);
  const e = h.ent(app.session);
  const ents = h.world.ents;

  // Opening the console releases the held key, so the body stops.
  app.key("KeyW", true);
  run(500);
  expect(app.key("Backquote", true)).toBe(true);
  expect(app.ui.captureKeyboard).toBe(true);
  run(500);
  const z = ents.z[e]!;
  expect(z).toBeGreaterThan(241);
  expect(app.key("KeyW", true)).toBe(false);
  app.mouseButton(0, true);
  app.look(500, 0);
  run(500);
  expect(ents.z[e]).toBe(z);
  expect(app.controls.buttons).toBe(0);
  expect(app.controls.yaw).toBe(0);

  app.textInput(KEY_CONSOLE_INPUT, "help");
  app.key("Enter", true);
  run(300);
  expect(app.ui.frame.find(KEY_CONSOLE_INPUT)!.text).toBe("");
  const rows = consoleRows(app);
  expect(rows[0]).toBe("> help");
  expect(rows).toContain("enablecheats <password>");
  expect(rows).not.toContain("kick <name>");

  app.textInput(KEY_CONSOLE_INPUT, "enablecheats");
  app.key("Enter", true);
  run(300);
  app.textInput(KEY_CONSOLE_INPUT, "spectate");
  app.key("Enter", true);
  run(300);
  expect(consoleRows(app).at(-1)).toContain("spectating");
  expect(app.ui.frame.find(KEY_BANNER)!.text).toBe("SPECTATING");
  expect(app.ui.frame.find(KEY_CROSS)).toBeNull();
  expect(app.session.admin).toBe(true);
  // A spectator's camera is the body itself, with no eye height. The change of viewpoint is smoothed, so it is exact only after a wait.
  expect(Math.abs(app.cam.y - app.session.own.y)).toBeLessThan(0.2);
  run(900);
  expect(app.cam.y).toBe(app.session.own.y);

  app.key("ArrowUp", true);
  run(50);
  expect(app.ui.frame.find(KEY_CONSOLE_INPUT)!.text).toBe("spectate");
  app.key("Escape", true);
  expect(app.ui.captureKeyboard).toBe(false);
  run(50);
  expect(app.ui.frame.find(KEY_CONSOLE_INPUT)).toBeNull();
  app.key("KeyW", true);
  run(500);
  expect(app.session.own.z).toBeGreaterThan(z + 3);
});

test("a closed connection is reported on the interface", () => {
  const h = new Harness();
  const app = client(h, "ada");
  h.run(300, (now) => app.frame(now, 1280, 720));
  h.server.reject(h.client(app.session)!, 7);
  let packet: unknown = 1;
  h.run(300, (now) => (packet = app.frame(now, 1280, 720)));
  expect(packet).toBeNull();
  expect(app.ui.frame.find(KEY_STATUS)!.text).toBe("disconnected (reason 7)");
});

test("the inventory screen moves and eats through the server, and the HUD bars are the server's numbers", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = client(h, "ada");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  const type = (line: string) => {
    app.key("Backquote", true);
    app.textInput(KEY_CONSOLE_INPUT, line);
    app.key("Enter", true);
    app.key("Backquote", true);
    run(300);
  };
  run(500);
  type("enablecheats");
  type("give stone 150");
  type("give berry 5");
  const rec = h.host.records.byPid.get(h.client(app.session)!.pid)!;
  const inv = h.host.items.inv(rec);
  h.host.survival.add(rec, V_FOOD, -30);
  run(300);
  expect(app.ui.frame.find(KEY_VITAL + 5)!.value).toBeCloseTo(h.host.survival.value(rec, V_FOOD) / 100, 4);

  app.key("KeyI", true);
  run(50);
  const slot = (s: number) => KEY_INV_SLOT + s * 3;
  expect(app.ui.frame.find(slot(0) + 2)!.text).toBe("100");
  expect(app.ui.frame.find(slot(1) + 2)!.text).toBe("50");
  app.pointer(0, slot(1), 0, 0, 0);
  app.pointer(0, slot(9), 0, 0, 0);
  run(300);
  expect(inv.count[9]).toBe(50);
  expect(inv.item[1]).toBe(0);
  expect(app.ui.frame.find(slot(9) + 2)!.text).toBe("50");
  expect(app.ui.frame.find(slot(1) + 2)).toBeNull();
  // Eat a berry with a right click.
  const berries = app.session.inventory!.item.indexOf(h.reg.index.get("core:berry")!);
  const food = h.host.survival.value(rec, V_FOOD);
  app.pointer(0, slot(berries), 0, 0, 2);
  run(300);
  expect(inv.count[berries]).toBe(4);
  expect(h.host.survival.value(rec, V_FOOD)).toBeGreaterThan(food + 1.4);
  expect(app.ui.frame.find(slot(berries) + 2)!.text).toBe("4");
  // The open inventory screen leaves the keyboard to the body.
  const z = h.world.ents.z[h.ent(app.session)]!;
  app.key("KeyW", true);
  run(1000);
  expect(h.world.ents.z[h.ent(app.session)]!).toBeGreaterThan(z + 2);
  expect(h.host.items.audit()).toEqual([]);
});

test("two whole clients form a tribe, talk on three channels through the chat box, and each is told who it is looking at", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = client(h, "ada");
  const bob = client(h, "bob");
  const run = (ms: number) =>
    h.run(ms, (now) => {
      ada.frame(now, 1280, 720);
      bob.frame(now, 1280, 720);
    });
  const type = (app: App, line: string): void => {
    app.session.text(line);
    run(300);
  };
  const chatRows = (app: App): string[] => {
    const out: string[] = [];
    const f = app.ui.frame;
    for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_CHAT_ROW && f.nodes[i]!.key < KEY_CHAT_ROW + 14) out.push(f.nodes[i]!.text);
    return out;
  };
  const say = (app: App, key: string, words: string): void => {
    expect(app.key(key, true)).toBe(true);
    app.key(key, false);
    run(50);
    app.textInput(KEY_CHAT_INPUT, words);
    app.key("Enter", true);
    app.key("Enter", false);
    run(300);
  };
  run(600);
  // Face to face on level ground, a metre and a half apart.
  const g = flatGround(h, 10, 10);
  for (const app of [ada, bob]) type(app, "enablecheats");
  type(ada, `tp ${(g.x + 5).toFixed(3)} ${(g.z + 4).toFixed(3)}`);
  type(bob, `tp ${(g.x + 5).toFixed(3)} ${(g.z + 5.5).toFixed(3)}`);
  bob.controls.yaw = Math.PI;
  run(300);
  expect(ada.ui.frame.find(KEY_PROMPT)!.text).toBe("bob  level 1");
  expect(bob.ui.frame.find(KEY_PROMPT)!.text).toBe("ada  level 1");

  type(ada, "tribe create Night Shift");
  type(ada, "tribe invite bob");
  expect(chatRows(bob).join(" ")).toContain("ada invites you to join Night Shift.");
  type(bob, "tribe accept");
  expect(chatRows(ada)).toContain("bob joined Night Shift.");
  expect(ada.ui.frame.find(KEY_PROMPT)!.text).toBe("bob (tribe)  level 1");
  expect(bob.ui.frame.find(KEY_PROMPT)!.text).toBe("ada (tribe)  level 1");

  say(ada, "Enter", "hello, island");
  say(bob, "Insert", "right behind you");
  expect(bob.key("Slash", true)).toBe(true);
  run(50);
  expect(bob.ui.frame.find(KEY_CHAT_TAG)!.text).toBe("Tribe");
  expect(bob.ui.captureKeyboard).toBe(true);
  bob.textInput(KEY_CHAT_INPUT, "the wall is up");
  bob.key("Enter", true);
  run(300);
  expect(bob.ui.chat.open).toBe(false);
  for (const app of [ada, bob]) expect(chatRows(app).slice(-3)).toEqual(["ada: hello, island", "[Local] bob: right behind you", "[Tribe] bob: the wall is up"]);
  // W typed into the open chat box does not move the body.
  const z = h.world.ents.z[h.ent(bob.session)]!;
  bob.key("Enter", true);
  bob.key("KeyW", true);
  run(500);
  bob.key("KeyW", false);
  bob.key("Escape", true);
  expect(h.world.ents.z[h.ent(bob.session)]).toBe(z);
  expect(ada.ui.console.lines.some((l) => l.includes("hello, island"))).toBe(false);
  expect(ada.session.stats.undecodable + bob.session.stats.undecodable).toBe(0);
});

test("the talk key: held to talk, let go by anything that takes the keyboard, and the screen says when the microphone is live or why it is not", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = client(h, "ada");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  run(500);
  // With no voice port the app still takes the key, and does nothing.
  expect(app.key("KeyB", true)).toBe(true);
  expect(app.key("KeyB", false)).toBe(true);
  run(50);
  expect(app.ui.frame.find(KEY_VOICE)).toBeNull();

  const calls: boolean[] = [];
  const told: number[][] = [];
  const speakers = new Map<number, { handle: number; name: string; speaking: boolean }>();
  const modes: [number, boolean][] = [];
  const volumes: number[] = [];
  const port = {
    notice: "",
    level: 0,
    sending: true,
    talk: (on: boolean, mode: number, open: boolean) => void (calls.push(on), modes.push([mode, open])),
    volume: (gain: number) => void volumes.push(gain),
    speakers,
    hear: (d: Float32Array, n: number) => void told.push([...d.subarray(0, n * 3)]),
  };
  app.voice = port;
  app.key("KeyB", true);
  app.key("KeyB", true, true); // a key repeat, so talk is called once
  run(50);
  expect(calls).toEqual([true]);
  expect(app.ui.frame.find(KEY_VOICE)!.text).toBe("TALKING");
  app.key("KeyB", false);
  run(50);
  expect(calls).toEqual([true, false]);
  expect(app.ui.frame.find(KEY_VOICE)).toBeNull();
  // The chat box takes the keyboard, so B is then a letter.
  app.key("KeyB", true);
  app.key("Enter", true);
  expect(calls).toEqual([true, false, true, false]);
  expect(app.key("KeyB", true)).toBe(false);
  expect(calls.length).toBe(4);
  app.key("Escape", true);
  app.key("KeyB", true);
  app.blur();
  expect(calls).toEqual([true, false, true, false, true, false]);
  port.notice = "voice: no microphone (refused, or none to be had)";
  run(50);
  expect(app.ui.frame.find(KEY_VOICE)!.text).toBe(port.notice);
  app.key("KeyB", true);
  run(50);
  expect(app.ui.frame.find(KEY_VOICE)!.text).toBe(port.notice);
  // The session received its voice token.
  expect(app.session.voice.version).toBe(1);

  // hear() gets three numbers per speaker: the speaker number, the distance (-1 if unseen) and the pan.
  expect(told.length).toBe(0);
  const bob = h.join("bob");
  run(500);
  h.say(bob, "enablecheats");
  const me = h.world.ents;
  const e = h.ent(app.session);
  h.say(bob, `tp ${(me.x[e]! + 6).toFixed(3)} ${(me.z[e]! + 8).toFixed(3)}`);
  run(300);
  speakers.set(7, { handle: bob.ownHandle, name: "bob", speaking: false });
  speakers.set(9, { handle: 0xfffff, name: "cy", speaking: true });
  port.notice = "";
  run(50);
  // Bob is 10 m off (6 in X, 8 in Z), ahead and to the left. Facing +Z, +X is the left. This client cannot see Cy.
  app.controls.yaw = 0;
  run(50);
  const last = told.at(-1)!;
  expect([last[0], last[3], last[4], last[5]]).toEqual([7, 9, -1, 0]);
  expect(last[1]).toBeCloseTo(10, 1);
  expect(last[2]).toBeCloseTo(-0.6, 2);
  app.controls.yaw = Math.PI;
  run(50);
  expect(told.at(-1)![2]).toBeCloseTo(0.6, 2);
  const talkers = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < 8; i++) {
      const n = app.ui.frame.find(KEY_TALKER + i);
      if (n) out.push(n.text);
    }
    return out;
  };
  expect(talkers()).toEqual(["cy"]);
  speakers.get(7)!.speaking = true;
  speakers.get(9)!.speaking = false;
  run(50);
  expect(talkers()).toEqual(["bob"]);
});

test("the talk key with Alt is a whisper and with Shift a yell; set to switch, one press opens the microphone and the next shuts it", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = client(h, "ada");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  run(500);
  const calls: [boolean, number, boolean][] = [];
  const volumes: number[] = [];
  const port = { notice: "", level: 0.25, sending: false, speakers: new Map(), hear: () => {}, volume: (g: number) => void volumes.push(g), talk: (on: boolean, mode: number, open: boolean) => void calls.push([on, mode, open]) };
  app.voice = port;
  const label = (): string | undefined => app.ui.frame.find(KEY_VOICE)?.text;
  const press = (code: string, mods: string[] = []): void => {
    for (const m of mods) app.key(m, true);
    app.key(code, true);
    run(50);
  };
  const lift = (code: string, mods: string[] = []): void => {
    app.key(code, false);
    for (const m of mods) app.key(m, false);
    run(50);
  };
  press("KeyB");
  expect(label()).toBe("TALKING");
  lift("KeyB");
  expect(app.key("AltLeft", true)).toBe(true); // handled, so Alt does not open the browser's menu
  app.key("AltLeft", false);
  press("KeyB", ["AltLeft"]);
  expect(label()).toBe("WHISPERING");
  lift("KeyB", ["AltLeft"]);
  press("KeyB", ["ShiftLeft"]);
  expect(label()).toBe("YELLING");
  // The mode is fixed at key down. Releasing Shift after does not change it.
  app.key("ShiftLeft", false);
  run(50);
  expect(label()).toBe("YELLING");
  lift("KeyB");
  expect(label()).toBeUndefined();
  expect(calls).toEqual([[true, 1, false], [false, 1, false], [true, 0, false], [false, 0, false], [true, 2, false], [false, 2, false]]);

  calls.length = 0;
  app.ui.settings.toggleTalk = true;
  press("KeyB");
  lift("KeyB");
  expect(calls).toEqual([[true, 1, true]]);
  expect(label()).toBe("MIC OPEN");
  port.sending = true;
  run(50);
  expect(label()).toBe("TALKING");
  // Neither the chat box nor a blur shuts a microphone that was switched on.
  app.key("Enter", true);
  app.key("Escape", true);
  app.blur();
  expect(calls.length).toBe(1);
  press("KeyB");
  lift("KeyB");
  expect(calls).toEqual([[true, 1, true], [false, 1, true]]);
  expect(label()).toBeUndefined();

  // The port gets the volume once each time the setting changes. The settings meter shows the port's level.
  expect(volumes).toEqual([1]);
  app.ui.settings.voiceVolume = 0.5;
  run(100);
  expect(volumes).toEqual([1, 0.5]);
  app.key("KeyO", true);
  run(50);
  app.pointer(0, KEY_SETTINGS_TAB + 1, 0, 0, 0);
  run(50);
  expect(Array.from({length:16},(_,i)=>app.ui.frame.find(KEY_SETTINGS_MIC+1+i)!).filter(n=>n.alpha>.5 && !n.interactive).length).toBe(13);
});

test("the melee key reaches the controls through the whole client, and F does not", () => {
  const h = new Harness();
  const app = client(h, "ada");
  h.run(500, (now) => app.frame(now, 1280, 720));
  app.key("KeyG", true);
  expect(app.controls.buttons & BTN_MELEE).toBe(BTN_MELEE);
  app.key("KeyG", false);
  app.key("KeyF", true);
  expect(app.controls.buttons & BTN_MELEE).toBe(0);
});

test("controller releases survive an inventory screen, and hiding the minimap stops its image work", () => {
  const h = new Harness(), app = client(h,"hud-map");
  const run = (ms:number) => h.run(ms,now=>app.frame(now,1280,720));
  run(500);
  const pad={connected:true,mapping:"standard",axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  pad.buttons[7]!.pressed=true; app.gamepads([pad],0);
  expect(app.controls.buttons).not.toBe(0);
  app.key("KeyI",true); app.gamepads([pad],16);
  expect(app.ui.inventory.open).toBe(true); expect(app.controls.buttons).toBe(0);
  app.key("KeyI",true); app.gamepads([pad],32);
  expect(app.controls.buttons).toBe(0);
  pad.buttons[7]!.pressed=false; app.gamepads([pad],48);
  pad.buttons[7]!.pressed=true; app.gamepads([pad],64);
  expect(app.controls.buttons).not.toBe(0); app.gamepads([],80); expect(app.controls.buttons).toBe(0);
  const chart=app.hud.chart!;
  app.key("KeyL",true); run(100); const version=chart.mini.image.version;
  app.key("KeyW",true); run(500); app.key("KeyW",false);
  expect(chart.mini.image.version).toBe(version);
  app.key("KeyL",true); run(100); expect(chart.mini.image.version).toBeGreaterThan(version);
  app.key("KeyH",true); const zoom=chart.miniZoom;
  app.key("Equal",true); expect(chart.miniZoom).toBe(Math.min(3,zoom+1));
  expect(app.ui.settings.minimapZoom).toBe(chart.miniZoom);
  app.key("KeyH",false); expect(app.ui.wantsPointerLock).toBe(true);
});

test("Leave disconnects deliberately and Reconnect asks the page to reload once through its existing identity path",()=>{
  const h=new Harness(),app=client(h,"hud-return");
  h.run(500,now=>app.frame(now,1280,720));
  let reloads=0;
  app.page={origin:"http://localhost:8788",protocol:"http:",hostname:"localhost",go(){},arrived(){},reload(){reloads++;},cluster:async()=>({world:0,name:"",url:"",port:8788,servers:[]})};
  app.key("Escape",true); app.frame(600,1280,720);
  app.pointer(0,5405,0,0,2); expect(app.session.state).toBe("active");
  app.pointer(0,5405,0,0,0); app.frame(620,1280,720);
  expect(app.session.state).toBe("closed"); expect(app.ui.frame.find(KEY_MENU_RESUME)!.text).toBe("Reconnect");
  app.pointer(0,KEY_MENU_RESUME,0,0,0); app.frame(640,1280,720); app.frame(660,1280,720);
  expect(reloads).toBe(1); expect(app.session.name).toBe("hud-return");
});

test("a controller drives a car: the left stick throttles and steers, A holds the brake, and Y gets out", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = client(h, "pad-driver");
  const pad = { connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const run = (ms: number) => h.run(ms, (now) => { app.gamepads([pad], now); app.frame(now, 1280, 720); });
  run(500);
  const s = app.session;
  s.text("enablecheats");
  run(300);
  const g = flatGround(h, 60, 60), x = g.x + 30, z = g.z + 10;
  s.text(`tp ${x + 1.6} ${z + 0.12}`);
  run(500);
  const me = h.client(s)!;
  const car = h.host.spawnVehicle("core:compact", x, z, h.host.records.byPid.get(me.pid)!.team, 0);
  expect(h.host.urban.mount(me, car)).toBe(RESULT_OK);
  run(800);
  expect(s.driving).toBe(car);
  const ents = h.world.ents, yaw = ents.vehicleYaw[ents.vrow[car]!]!;
  pad.axes[1] = -1;
  run(2000);
  expect(app.hud.vehicle!.speed).toBeGreaterThan(3);
  expect(Math.hypot(ents.x[car]! - x, ents.z[car]! - z)).toBeGreaterThan(3);
  pad.axes[0] = 1;
  run(1000);
  expect(Math.abs(ents.vehicleYaw[ents.vrow[car]!]! - yaw)).toBeGreaterThan(0.2);
  pad.axes[0] = pad.axes[1] = 0;
  pad.buttons[0]!.pressed = true;
  run(100);
  expect(app.controls.buttons & BTN_JUMP).toBe(BTN_JUMP);
  expect(app.hud.vehicle!.handbrake).toBe(true);
  pad.buttons[0]!.pressed = false;
  run(2000);
  pad.buttons[3]!.pressed = true;
  run(100);
  pad.buttons[3]!.pressed = false;
  run(800);
  expect(s.driving).toBe(-1);
  h.host.shutdown();
});
