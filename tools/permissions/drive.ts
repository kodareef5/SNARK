// The Permissions page, the Admin log and the dashboard worked in headless Chrome as an admin works them, signed in with
// HTTP's basic sign-in as a person is, each act judged by what the server then holds. A survivor claims their own password
// in game over their socket, as a player does. Every console error, uncaught exception and failed request is a fault too,
// but for those a step expects. No password is printed or written down.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { joinServer } from "../../agent/join.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { OPERATOR } from "../../server/acts.ts";
import type { Host } from "../../server/host.ts";
import { idText } from "../../server/survivor-ids.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { KEY_BYTES, TEXT_CONSOLE, TEXT_GLOBAL } from "../../shared/net/protocol.ts";
import { CHAT_DOCUMENT, PERMISSIONS_API, PERMISSIONS_STATE } from "../../shared/permissions/page.ts";
import { CHROME_FLAGS } from "../chrome.ts";

/** A survivor the tool stands in the world, with the game's own client session. */
interface Survivor {
  name: string;
  pid: number;
  id: string;
  session: ClientSession;
  leave(): Promise<void>;
}

async function enter(host: Host, socket: string, name: string): Promise<Survivor> {
  const session = await joinServer(socket, name, crypto.getRandomValues(new Uint8Array(KEY_BYTES)), compileContent(CORE_CONTENT).registry!);
  const beat = setInterval(() => session.update(performance.now(), 0, 0, 0, 0, 0), 33);
  const here = () => host.game.clients.find((c) => !!c?.active && !c.closed && c.name === name && c.pid !== 0 && c.ent >= 0);
  for (let k = 0; k < 300 && !here(); k++) await Bun.sleep(50);
  const pid = here()?.pid ?? 0;
  const rec = host.records.byPid.get(pid);
  if (pid === 0 || !rec) {
    clearInterval(beat);
    session.close();
    throw new Error(`${name} did not come to stand in the world: its session is ${session.state}`);
  }
  await Bun.sleep(200);
  return {
    name, pid, id: idText(rec), session,
    leave: async () => {
      clearInterval(beat);
      session.close();
      for (let k = 0; k < 200 && host.online(pid); k++) await Bun.sleep(50);
    },
  };
}

/** Whether survivor `pid`'s session has cheats on the host. */
const cheats = (host: Host, pid: number): boolean => host.game.clients.some((c) => !!c?.active && !c.closed && c.pid === pid && c.admin);

/** Types a console line as `s` and waits for the answer, as the console shows it. */
async function say(s: Survivor, line: string): Promise<string> {
  // The server takes a console line from a session only every few ticks, and refuses one sooner.
  await Bun.sleep(300);
  const before = s.session.logVersion;
  s.session.text(line);
  for (let k = 0; k < 50; k++, await Bun.sleep(100)) {
    const fresh = s.session.log.slice(s.session.log.length - Math.min(s.session.log.length, s.session.logVersion - before));
    const answer = fresh.find((l) => l.channel === TEXT_CONSOLE);
    if (answer) return answer.text;
  }
  return "";
}

/** `s` claims their own password in game: what only their session is sent, taken out of it as the console does. */
async function claim(s: Survivor, current = ""): Promise<{ password: string; answer: string }> {
  const answer = await say(s, current === "" ? "claimpassword" : `claimpassword ${current}`);
  const password = s.session.secret;
  s.session.secret = "";
  return { password, answer };
}

interface Page {
  run(expression: string): Promise<any>;
  wait(expression: string, tenths?: number): Promise<boolean>;
  press(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  choose(selector: string, value: string): Promise<void>;
  /** Sets a colour field as its picker does, which headless Chrome cannot open. */
  colour(selector: string, hex: string): Promise<void>;
  go(url: string): Promise<void>;
  /** Waits until the page has no request under way, and what the last answer set going has run. */
  idle(): Promise<void>;
  shot(file: string): Promise<void>;
  dialogs: string[];
  /** Console errors, uncaught exceptions and failed requests, a line each. */
  errors: string[];
}

const q = (selector: string): string => `document.querySelector(${JSON.stringify(selector)})`;
const HELD_MS = 60;

/**
 * Opens `url` in headless Chrome with a profile under `scratch` and gives the page to `work`. With `auth`, the browser's
 * sign-in is answered with that name and password each time a page or a request is challenged, as a person answers it once.
 */
async function browse<T>(chrome: string, url: string, scratch: string, auth: { user: string; password: string } | null, work: (page: Page) => Promise<T>): Promise<T> {
  const profile = mkdtempSync(join(scratch, "chrome-"));
  // Chrome's sockets go under TMPDIR, whose path must be short; /tmp on this machine is memory.
  const tmp = join(homedir(), ".cache/snark/t");
  mkdirSync(tmp, { recursive: true });
  const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--disable-extensions", "--hide-scrollbars", "--window-size=1400,1000", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore", env: { ...process.env, TMPDIR: tmp } });
  try {
    let port = 0;
    const active = join(profile, "DevToolsActivePort");
    for (let k = 0; k < 100 && !port; k++, await Bun.sleep(100)) if (existsSync(active)) port = Number(readFileSync(active, "utf8").split("\n")[0]);
    if (!port) throw new Error("Chrome did not say where it listens");
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    type Answer = { id?: number; method?: string; params?: any; result?: any; error?: unknown };
    const waiting = new Map<number, (m: Answer) => void>();
    const dialogs: string[] = [];
    const errors: string[] = [];
    const urls = new Map<string, string>();
    const flying = new Set<string>();
    let id = 0;
    const answered = new Set<string>();
    const send = (method: string, params: object = {}): Promise<any> =>
      new Promise((ok, fail) => {
        const n = ++id;
        const timer = setTimeout(() => fail(new Error(`${method} took too long`)), 30000);
        waiting.set(n, (m) => (clearTimeout(timer), m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result)));
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as Answer;
      const p = m.params;
      if (m.method === "Runtime.exceptionThrown") errors.push(`uncaught: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
      if (m.method === "Runtime.consoleAPICalled" && p.type === "error") errors.push(`console: ${p.args.map((a: any) => a.value ?? a.description ?? "").join(" ")}`);
      // A browser asks every site for an icon, which a world's admin pages do not have: that is no fault of the page.
      if (m.method === "Log.entryAdded" && p.entry.level === "error" && !String(p.entry.url ?? "").endsWith("/favicon.ico")) errors.push(`log: ${p.entry.text} ${p.entry.url ?? ""}`.trim());
      if (m.method === "Network.requestWillBeSent") urls.set(p.requestId, p.request.url), flying.add(p.requestId);
      if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") flying.delete(p.requestId);
      if (m.method === "Network.responseReceived" && p.response.status >= 400 && !p.response.url.endsWith("/favicon.ico")) errors.push(`request: ${p.response.status} ${p.response.url}`);
      if (m.method === "Network.loadingFailed" && !p.canceled && !String(urls.get(p.requestId) ?? "").endsWith("/favicon.ico")) errors.push(`request: ${p.errorText} ${urls.get(p.requestId) ?? ""}`);
      if (m.method === "Page.javascriptDialogOpening") {
        dialogs.push(String(p.message));
        void send("Page.handleJavaScriptDialog", { accept: true });
      }
      if (m.method === "Fetch.requestPaused") void send("Fetch.continueRequest", { requestId: p.requestId });
      if (m.method === "Fetch.authRequired") {
        // Each request is answered once, as a person types a password once: a second challenge is a password refused.
        const give = auth && p.authChallenge.source === "Server" && !answered.has(p.requestId);
        answered.add(p.requestId);
        void send("Fetch.continueWithAuth", { requestId: p.requestId, authChallengeResponse: give ? { response: "ProvideCredentials", username: auth!.user, password: auth!.password } : { response: "CancelAuth" } });
      }
      if (m.id !== undefined) waiting.get(m.id)?.(m);
    };
    const run = async (expression: string): Promise<any> => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text} in ${expression.slice(0, 160)}`);
      return r.result.value;
    };
    const wait = async (expression: string, tenths = 100): Promise<boolean> => {
      for (let k = 0; k < tenths; k++, await Bun.sleep(100)) if (await run(`!!(${expression})`)) return true;
      return false;
    };
    const mouse = (type: string, x: number, y: number, buttons: number): Promise<unknown> => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
    const settle = (): Promise<unknown> => run("new Promise((r) => setTimeout(r, 20))");
    const press = async (selector: string): Promise<void> => {
      const at = (await run(`(() => { const e = ${q(selector)}; if (!e) return null; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`)) as [number, number] | null;
      if (!at) throw new Error(`nothing on the page is ${selector}`);
      const [x, y] = at;
      await mouse("mouseMoved", x, y, 0);
      await mouse("mousePressed", x, y, 1);
      await Bun.sleep(HELD_MS);
      await mouse("mouseReleased", x, y, 0);
      await settle();
      await page.idle();
    };
    const page: Page = {
      run, wait, press, dialogs, errors,
      type: async (selector, text) => {
        await press(selector);
        if (!(await run(`document.activeElement === ${q(selector)}`))) throw new Error(`${selector} was pressed and is not the field in hand`);
        await run("document.activeElement.select()");
        await send("Input.insertText", { text });
        await settle();
      },
      choose: async (selector, value) => {
        const had = await run(`(() => { const e = ${q(selector)}; if (!e || ![...e.options].some((o) => o.value === ${JSON.stringify(value)})) return false; e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
        if (!had) throw new Error(`${selector} offers no ${value}`);
        await settle();
      },
      colour: async (selector, hex) => {
        const had = await run(`(() => { const e = ${q(selector)}; if (!e) return false; e.focus(); e.value = ${JSON.stringify(hex)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); e.blur(); return true; })()`);
        if (!had) throw new Error(`nothing on the page is ${selector}`);
        await settle();
      },
      idle: async () => {
        for (let k = 0, quiet = 0; k < 200 && quiet < 3; k++, await Bun.sleep(30)) quiet = flying.size === 0 ? quiet + 1 : 0;
        await settle();
      },
      go: async (to) => {
        await send("Page.navigate", { url: to });
        await wait("document.readyState === 'complete'");
      },
      shot: async (file) => {
        // The window is made as tall as the page, so the rail and the skip link stand where a person sees them.
        const size = (await send("Page.getLayoutMetrics")).cssContentSize as { width: number; height: number };
        await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: Math.ceil(size.height), deviceScaleFactor: 1, mobile: false });
        await settle();
        const made = await send("Page.captureScreenshot", { format: "png" });
        await send("Emulation.clearDeviceMetricsOverride");
        writeFileSync(file, Buffer.from(made.data as string, "base64"));
        console.log(`  ${file}`);
      },
    };
    await Promise.all(["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"].map((m) => send(m)));
    if (auth) await send("Fetch.enable", { handleAuthRequests: true, patterns: [{ urlPattern: "*" }] });
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.go(url);
    try {
      return await work(page);
    } finally {
      ws.close();
    }
  } finally {
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true });
  }
}

export interface DriveOptions {
  chrome: string;
  origin: string;
  host: Host;
  socket: string;
  passwords: { map: string; cluster: string };
  scratch: string;
  /** Where pictures go, or null for none. */
  shots: string | null;
}

/** An ink as the page writes it in a style: rgb(r, g, b). */
const rgb = (hex: string): string => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
/** Whether an ink is `hex` within one step a channel: the markup keeps a colour as fractions of 1. */
const near = (ink: number | undefined, hex: string): boolean => {
  if (ink === undefined) return false;
  const want = parseInt(hex.slice(1), 16);
  return [16, 8, 0].every((s) => Math.abs(((ink >> s) & 255) - ((want >> s) & 255)) <= 1);
};

/** Works the pages. Returns what went wrong, a line each. */
export async function drive(o: DriveOptions): Promise<string[]> {
  const { chrome, origin, host, socket, passwords, scratch } = o;
  const faults: string[] = [];
  const fault = (what: string): void => {
    console.log(`  FAIL ${what}`);
    faults.push(what);
  };
  const check = (what: string, got: unknown, want: unknown): void => {
    const [g, w] = [JSON.stringify(got), JSON.stringify(want)];
    console.log(`  ${g === w ? "ok  " : "FAIL"} ${what}`);
    if (g !== w) faults.push(`${what}: ${g}, not ${w}`);
  };
  /** Takes the page's faults: each a step expected is matched once by its pattern and let go, every other is a fault. */
  const errorsOf = (page: Page, where: string, expected: RegExp[] = []): void => {
    const left = [...expected];
    for (const e of page.errors.splice(0)) {
      const k = left.findIndex((r) => r.test(e));
      if (k >= 0) left.splice(k, 1), console.log(`       as expected, ${where}: ${e}`);
      else fault(`${where}: ${e}`);
    }
  };
  const picture = async (page: Page, name: string): Promise<void> => {
    if (o.shots) await page.shot(join(o.shots, `${name}.png`));
  };
  const snap = () => host.permissions.snapshot();
  const group = (name: string) => snap().groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
  const members = (name: string) => snap().members.filter((m) => m.group.toLowerCase() === name.toLowerCase());
  const pagePath = `${origin}/admin/permissions/`;
  const here: Survivor[] = [];
  const passwordsSeen: string[] = [];
  try {
    const ada = await enter(host, socket, "Ada");
    const bea = await enter(host, socket, "Bea");
    const cy = await enter(host, socket, "Cy");
    here.push(ada, bea, cy);
    check("nobody has cheats from the start", [ada, bea, cy].map((s) => cheats(host, s.pid)), [false, false, false]);

    await browse(chrome, pagePath, scratch, { user: "Kody", password: passwords.cluster }, async (page) => {
      const text = (selector: string): Promise<string> => page.run(`${q(selector)}?.textContent ?? ""`);
      const chips = (g: string): Promise<string[]> => page.run(`[...document.querySelectorAll('.group[data-group="${g}"] .chip')].map((c) => c.firstChild.textContent.trim())`);

      // 1. The state, who is signed in, and the two groups there from the start.
      if (!(await page.wait(`${q("#me")}.textContent !== ""`, 100))) fault(`the page did not show who is signed in: ${await text("#msg")}`);
      check("the page says who is signed in, and the rank", await text("#me"), "Signed in as (Kody), by the host password, at the cluster rank, on a world outside a cluster.");
      check("the page lists Default and Admins", await page.run(`[...document.querySelectorAll("#groups .group")].map((g) => g.dataset.group)`), ["Default", "Admins"]);
      errorsOf(page, "loading the page");

      // 2. A group made, given a rank, granted two permissions and one revoked.
      const addGroup = async (name: string, rank: string): Promise<void> => {
        await page.type("#group-name", name);
        await page.choose("#group-rank", rank);
        await page.press("#add-group");
        if (!(await page.wait(`${q(`.group[data-group="${name}"]`)}`))) fault(`${name} did not show: ${await text("#msg")}`);
      };
      await addGroup("Moderators", "1");
      check("Moderators is made at the staff rank", group("Moderators")?.rank, 1);
      await page.choose('select[data-act="rank"][data-group="Moderators"]', "2");
      await page.wait(`${q('select[data-act="rank"][data-group="Moderators"]')}.value === "2" && ${q("#msg")}.textContent.includes("rank now")`);
      check("its rank is changed to admin", [group("Moderators")?.rank, await text("#msg")], [2, "Moderators is of the admin rank now."]);
      for (const p of ["Cheat.kick", "Cheat.fly"]) {
        await page.type('input[data-grant="Moderators"]', p);
        await page.press('button[data-act="grant"][data-group="Moderators"]');
        await page.wait(`${q("#msg")}.textContent === "Moderators holds ${p} now."`);
      }
      check("Moderators holds Cheat.kick and Cheat.fly, on the page and the host", [await chips("Moderators"), group("Moderators")?.permissions], [["Cheat.kick", "Cheat.fly"], ["Cheat.kick", "Cheat.fly"]]);
      await page.press('button[data-act="revoke"][data-group="Moderators"][data-perm="Cheat.fly"]');
      await page.wait(`${q("#msg")}.textContent === "Moderators no longer holds Cheat.fly."`);
      check("Cheat.fly is revoked, on the page and the host", [await chips("Moderators"), group("Moderators")?.permissions], [["Cheat.kick"], ["Cheat.kick"]]);
      await addGroup("Veterans", "0");
      await addGroup("Wardens", "3");
      check("Veterans is open and Wardens of the map's rank", [group("Veterans")?.rank, group("Wardens")?.rank], [0, 3]);
      errorsOf(page, "making groups");
      await picture(page, "groups");

      // 3. Members: one chosen by name, one by ID with hours and a delay.
      await page.press('[data-tab="members"]');
      const addMember = async (who: string, g: string, hours = "", delay = ""): Promise<void> => {
        await page.type("#member-who", who);
        await page.choose("#member-group", g);
        await page.type("#member-hours", hours === "" ? " " : hours);
        await page.type("#member-delay", delay === "" ? " " : delay);
        await page.press("#add-member");
        await page.wait(`${q("#msg")}.textContent.startsWith("Added ") || ${q("#msg")}.className === "bad" || ${q("#msg")}.className === "warn"`);
      };
      const offered = (await page.run(`[...document.querySelectorAll("#who-list option")].map((o) => o.value)`)) as string[];
      const adaWords = offered.find((w) => w.startsWith("Ada ("));
      check("the picker offers Ada by name and ID", adaWords, `Ada (${ada.id})`);
      await addMember(adaWords ?? "Ada", "Veterans");
      check("Ada is added to Veterans", [await text("#msg"), members("Veterans").map((m) => m.key)], [`Added ${adaWords} to Veterans.`, [ada.id]]);
      await addMember(cy.id, "Veterans", "2", "1");
      const cyTimed = members("Veterans").find((m) => m.key === cy.id);
      check("Cy is added to Veterans for 2 hours, starting in 1", cyTimed ? [cyTimed.forever, Math.round((cyTimed.until - cyTimed.from) / 3_600_000), Math.round((cyTimed.from - Date.now()) / 3_600_000)] : null, [false, 2, 1]);
      const rowsOf = (): Promise<string[]> => page.run(`[...document.querySelectorAll("#members tr")].map((tr) => [...tr.cells].map((c) => c.textContent.trim()).join(" | "))`);
      const rows = await rowsOf();
      check("the members table shows Ada for good", rows.some((r) => r.startsWith(`Ada ${ada.id} | Veterans open | For good`)), true);
      const cySpan = rows.find((r) => r.startsWith(`Cy ${cy.id}`))?.split(" | ")[2] ?? "";
      console.log(`       Cy's row: ${cySpan}`);
      check("and Cy with the time before it starts and how long it lasts", /^Starts in (59 min|1 h), then lasts 2 h$/.test(cySpan), true);
      await addMember(cy.id, "Wardens");
      await addMember("Bea", "Admins");
      check("Cy is in Wardens and Bea in Admins", [members("Wardens").map((m) => m.key), members("Admins").map((m) => m.key)], [[cy.id], [bea.id]]);
      errorsOf(page, "adding members");

      // 4. Bea claims her own password in game: only her session is sent it, once. The page shows that she has, and nothing more.
      const beaRow = async (): Promise<string> => (await rowsOfPasswords(page)).find((r) => r.startsWith(`Bea ${bea.id}`))?.split(" | ")[2] ?? "";
      check("Bea's row says she has not claimed a password", await beaRow(), "Not claimed yet");
      check("the staff passwords offer only a clear", await page.run(`[...new Set([...document.querySelectorAll("#passwords button")].map((b) => b.dataset.act))]`), ["clear-password"]);
      const claimed = await claim(bea);
      const password = claimed.password;
      if (password !== "") passwordsSeen.push(password);
      check("Bea's session is sent a password", /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/.test(password), true);
      check("and told it is hers, shown once", claimed.answer, "The password above is yours, shown this once. enablecheats takes it in game, and the admin pages take it with your name or ID.");
      check("no other session is sent one, and none is in Bea's log", [ada.session.secret, cy.session.secret, bea.session.log.some((l) => l.text.includes(password))], ["", "", false]);
      await page.go(`${pagePath}?again=1#members`);
      await page.wait(`${q("#me")}.textContent !== ""`);
      check("the page, read again, says Bea has claimed one", /^Claimed on \d{4}-\d\d-\d\d \d\d:\d\d$/.test(await beaRow()), true);
      const inPage = (await page.run(`document.documentElement.outerHTML.toUpperCase().includes(${JSON.stringify(password)})`)) as boolean;
      const stateText = (await page.run(`fetch(${JSON.stringify(PERMISSIONS_STATE)}, { cache: "no-store" }).then((r) => r.text())`)) as string;
      const hash = snap().secrets.find((s) => s.id === bea.id)?.hash ?? "";
      check("neither the page nor its state holds the password or its hash", [inPage, stateText.includes(password), hash !== "" && stateText.includes(hash), (JSON.parse(stateText) as { passwords: { id: string }[] }).passwords.map((p) => p.id)], [false, false, false, [bea.id]]);
      await picture(page, "passwords");

      check("Bea's sign-in in game", await say(bea, `enablecheats ${password}`), "cheats enabled");
      check("with it Bea's session becomes an admin", cheats(host, bea.pid), true);
      errorsOf(page, "claiming a password");

      // 4 and 5. Bea signs in to the page with her name and the password, at admin rank, and cannot touch the map's group.
      await browse(chrome, `${pagePath}#groups`, scratch, { user: "Bea", password }, async (as) => {
        const atext = (selector: string): Promise<string> => as.run(`${q(selector)}?.textContent ?? ""`);
        if (!(await as.wait(`${q("#me")}.textContent !== ""`))) fault(`Bea's page did not load: ${await atext("#msg")}`);
        check("Bea's page says she is signed in at the admin rank", await atext("#me"), `Signed in as Bea (${bea.id}), at the admin rank, on a world outside a cluster.`);
        const off = (selector: string): Promise<[boolean, string] | null> => as.run(`(() => { const e = ${q(selector)}; return e ? [e.disabled, e.title] : null; })()`);
        const removeWhy = await off('button[data-act="remove-group"][data-group="Wardens"]');
        const controls = await Promise.all(['select[data-act="rank"][data-group="Wardens"]', 'input[data-grant="Wardens"]', 'button[data-act="grant"][data-group="Wardens"]', 'button[data-act="remove-group"][data-group="Wardens"]'].map(off));
        check("each control on Wardens is off, with a reason as its title", controls.map((c) => c !== null && c[0] && c[1] !== ""), [true, true, true, true]);
        console.log(`       the reason: ${removeWhy?.[1] ?? ""}`);
        await as.press('[data-tab="members"]');
        const memberOff = (await as.run(`[...document.querySelectorAll("#members tr")].filter((tr) => tr.textContent.includes("Wardens")).map((tr) => { const b = tr.querySelector("button"); return b ? [b.disabled, b.title] : null; })`)) as ([boolean, string] | null)[];
        check("the remove button on Cy's Wardens row is off, with a reason", memberOff.map((c) => c !== null && c[0] && c[1] !== ""), [true]);
        const sent = (await as.run(`fetch(${JSON.stringify(PERMISSIONS_API)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ do: "op", op: { op: "removeGroup", group: "Wardens" } }) }).then(async (r) => [r.status, await r.json()])`)) as [number, { ok: boolean; why: string }];
        check("a removal of Wardens sent anyway is refused, with the title's reason", [sent[0], sent[1].ok, sent[1].why], [403, false, removeWhy?.[1] ?? ""]);
        check("and Wardens is still there", group("Wardens")?.name, "Wardens");
        const memberSent = (await as.run(`fetch(${JSON.stringify(PERMISSIONS_API)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ do: "op", op: { op: "removeMember", kind: "survivor", key: ${JSON.stringify(cy.id)}, group: "Wardens", world: 0 } }) }).then((r) => r.status)`)) as number;
        check("so is a removal of Cy from Wardens", [memberSent, members("Wardens").map((m) => m.key)], [403, [cy.id]]);
        await picture(as, "regular-admin");

        // 6. The password cleared on Kody's page: Bea's cheats go at once, the page says she has none, and her own page
        // says how to sign in again once its sign-in is refused.
        await page.press(`button[data-act="clear-password"][data-id="${bea.id}"]`);
        await page.wait(`${q("#msg")}.textContent === "Cleared the password."`);
        check("the page asked first", page.dialogs.splice(0), [`Clear the password of Bea? They lose their staff powers until they claim a new one in game.`]);
        check("Bea's session has lost its cheats", cheats(host, bea.pid), false);
        check("the page shows she has not claimed one", await beaRow(), "Not claimed yet");
        errorsOf(page, "clearing the password");
        await picture(page, "members");

        // Bea claims again. The old password is refused without being counted, and the new one signs her in.
        const again = await claim(bea);
        if (again.password !== "") passwordsSeen.push(again.password);
        check("Bea claims a new password", [/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/.test(again.password), again.password !== password], [true, true]);
        check("the old one no longer works", await say(bea, `enablecheats ${password}`), "that password was replaced or cleared");
        check("and was not counted as a guess", host.game.clients.find((c) => c?.pid === bea.pid)?.cheatAttempts, 0);
        check("the new one signs her in", await say(bea, `enablecheats ${again.password}`), "cheats enabled");
        await page.go(`${pagePath}?again=2#members`);
        await page.wait(`${q("#me")}.textContent !== ""`);
        check("the page says she has claimed one again", (await beaRow()).startsWith("Claimed on "), true);
        await as.press('[data-tab="groups"]');
        await as.type("#group-name", "Late");
        await as.press("#add-group");
        await as.wait(`${q("#msg")}.className === "bad"`);
        check("Bea's page, signed out, says how to sign in again", [await atext("#msg"), await as.run(`!${q("#reload")}.hidden`), group("Late")], ["You are signed out, or your password changed. Reload the page to sign in again.", true, undefined]);
        errorsOf(as, "Bea's page", [/request: 403 .*\/admin\/permissions\/api/, /request: 403 .*\/admin\/permissions\/api/, /log: .*403/, /log: .*403/,
          /request: 401 .*\/admin\/permissions\/api/, /log: .*401/, /request: 401 .*\/admin\/permissions\/state/, /log: .*401/]);
      });

      // 7. A chat format on Veterans with a colour and a priority, and a tag with text and colour.
      await page.press('[data-tab="chat"]');
      await page.press('button[data-act="chat-add"][data-group="Veterans"]');
      const block = '[data-chat="Veterans"]';
      if (!(await page.wait(q(`${block} [data-field="priority"]`)))) fault("Veterans' chat form did not open");
      await page.type(`${block} [data-field="priority"]`, "5");
      const SENDER = "#ff8000";
      await page.colour(`${block} input[data-colour="sender"]`, SENDER);
      const sample = (await page.run(`[...${q(`${block} [data-sample]`)}.children].map((s) => [s.textContent, s.style.color])`)) as [string, string][];
      check("the sample line has the sender in its colour", sample.some(([t, c]) => t === "Rowan" && c === rgb(SENDER)), true);
      await page.press(`button[data-act="chat-save"][data-group="Veterans"]`);
      await page.wait(`${q("#msg")}.textContent === "Saved the chat format of Veterans."`);
      const saved = JSON.parse(group("Veterans")?.chat || "{}") as { Priority?: number; FormattingParts?: { sender?: string } };
      check("the host has Veterans' format with its priority and coloured sender", [saved.Priority, /RichColor/.test(saved.FormattingParts?.sender ?? "")], [5, true]);
      const adminTag = (await page.run(`[...document.querySelectorAll("#chat-settings tr[data-tag]")].map((tr) => [tr.querySelector('[data-set="tag.name"]').value, [...tr.querySelector("[data-tag-sample]").children].map((s) => [s.textContent, s.style.color])])`)) as [string, [string, string][]][];
      check("the tags show the server's red [Admin] for Admins", adminTag, [["Admins", [["[Admin]", rgb("#ff0000")]]]]);
      const adminSample = (await page.run(`[...${q('[data-chat="Admins"] [data-sample]')}.children].map((s) => [s.textContent, s.style.color])`)) as [string, string][];
      check("and so does the Admins sample line", adminSample.some(([t, c]) => t === "[Admin]" && c === rgb("#ff0000")), true);
      await page.press('button[data-act="tag-add"]');
      const tag = await page.run(`[...document.querySelectorAll("#chat-settings tr[data-tag]")].pop().dataset.tag`);
      const row = `#chat-settings tr[data-tag="${tag}"]`;
      await page.type(`${row} [data-set="tag.name"]`, "Veterans");
      await page.type(`${row} [data-set="tag.text"]`, "[Vet]");
      const TAG = "#00ccff";
      await page.colour(`${row} [data-set="tag.colour"]`, TAG);
      const tagSample = (await page.run(`[...${q(`${row} [data-tag-sample]`)}.children].map((s) => [s.textContent, s.style.color])`)) as [string, string][];
      check("the tag's sample is coloured", tagSample, [["[Vet]", rgb(TAG)]]);
      const vetSample = (await page.run(`[...${q(`${block} [data-sample]`)}.children].map((s) => [s.textContent, s.style.color])`)) as [string, string][];
      check("Veterans' sample line carries the tag in its colour", vetSample.some(([t, c]) => t.includes("[Vet]") && c === rgb(TAG)), true);
      await page.press('button[data-act="settings-save"]');
      await page.wait(`${q("#msg")}.textContent === "Saved the chat settings."`);
      const tags = Object.keys((JSON.parse(host.permissions.document(CHAT_DOCUMENT) || "{}") as { ChatTags?: object }).ChatTags ?? {});
      check("the host has the new tag beside Admins'", tags, ["StackChatTags", "Admins", "Veterans"]);
      errorsOf(page, "the chat tab");
      await picture(page, "chat");

      const before = cy.session.log.length;
      ada.session.chat(TEXT_GLOBAL, "meet at the river");
      let line: { text: string; runs?: readonly { text: string; ink?: number }[] } | undefined;
      for (let k = 0; k < 50 && !line; k++, await Bun.sleep(100)) line = cy.session.log.slice(before).find((l) => l.text.includes("meet at the river"));
      console.log(`       Cy received: ${JSON.stringify(line?.runs ?? line?.text ?? null)}`);
      check("Cy receives Ada's line with the tag in its colour", line?.runs?.some((r) => r.text.includes("[Vet]") && near(r.ink, TAG)) ?? false, true);
      check("and Ada's name in the sender's colour", line?.runs?.some((r) => r.text === "Ada" && near(r.ink, SENDER)) ?? false, true);

      // 8. Imports: a pasted list of commands, then a CrossChat config with comments; Check changes nothing, Apply does.
      await page.press('[data-tab="import"]');
      const importOf = async (kind: string, pasted: string, name: string, would: string, made: string, changed: () => boolean): Promise<void> => {
        await page.choose("#import-kind", kind);
        await page.type("#import-text", pasted);
        await page.press("#import-check");
        await page.wait(`${q("#import-out")}.textContent.trim() !== ""`);
        const checked = (await text("#import-out")).replace(/\s+/g, " ").trim();
        check(`Check of the ${name} says what it would do`, checked.startsWith(would), true);
        console.log(`       ${checked}`);
        check(`and changes nothing`, changed(), false);
        await picture(page, `import-${kind}`);
        await page.press("#import-apply");
        await page.wait(`${q("#msg")}.textContent === "Imported."`);
        check(`Apply of the ${name} makes the changes`, [(await text("#import-out")).trim().startsWith(made), changed()], [true, true]);
      };
      await importOf("commands", "Permissions.AddGroup Builders\nPermissions.Grant Builders Cheat.fly\nPermissions.Grant Veterans Kit.vet\n", "commands", "It would make 3 changes.", "Made 3 changes.",
        () => group("Builders")?.permissions.includes("Cheat.fly") === true && group("Veterans")?.permissions.includes("Kit.vet") === true);
      check("the page asked before applying", page.dialogs.splice(0), ["Make these changes?"]);
      const CROSSCHAT = `{
  // CrossChat's config, with comments as its sample has
  "PermissionsFormatting": {
    "Builders": { "ChatFormat": "{sender}: {message}", "Priority": 3 } // builders talk plainly
  },
  "ChatTags": { "StackChatTags": true,
    "Builders": { "Priority": 2, "Icon": "", "Text": "[Build]", "CanBeDisabled": true }
  }
}`;
      await importOf("crosschat", CROSSCHAT, "CrossChat config", "It would make", "Made ", () => group("Builders")?.chat !== "" && group("Builders")?.chat !== undefined);
      check("the page asked before applying", page.dialogs.splice(0), ["Make these changes?"]);
      errorsOf(page, "the import tab");

      // 9. The Admin log: what was just done, newest first, with names, IDs, ranks and times; each filter narrows it.
      await page.go(`${origin}/admin/worlds/local/acts/`);
      if (!(await page.wait(`document.querySelectorAll("#acts tr").length > 5`, 100))) fault(`the log shows nothing: ${await text("#msg")}`);
      const actRows = async (): Promise<string[][]> => page.run(`[...document.querySelectorAll("#acts tr")].map((tr) => [...tr.cells].map((c) => c.textContent.trim()))`);
      const all = await actRows();
      check("the newest act is the CrossChat import", /import/i.test(all[0]?.[4] ?? "") && /CrossChat/i.test(all[0]?.[4] ?? ""), true);
      check("each row has a wall time", all.every((r) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r[0] ?? "")), true);
      check("Kody's changes are named, of the cluster's rank, on a page", all.some((r) => r[1] === "(Kody)" && r[2] === "cluster" && r[3] === "On a page"), true);
      check("Bea's sign-in is there with her ID and the admin rank", all.some((r) => r[1] === `Bea${bea.id}` && r[2] === "admin" && /sign-in/.test(r[4] ?? "")), true);
      check("Bea's claims are there, made by her", all.filter((r) => r[1] === `Bea${bea.id}` && /claimed their own password$/.test(r[4] ?? "")).length, 2);
      check("no row holds a password", all.some((r) => passwordsSeen.some((p) => r.join(" ").includes(p)) || r.join(" ").includes(passwords.cluster) || r.join(" ").includes(passwords.map)), false);
      const narrowed = async (what: string, set: () => Promise<void>, every: (r: string[]) => boolean, reset: () => Promise<void>): Promise<void> => {
        await set();
        const shown = await actRows();
        check(`the ${what} filter narrows the log`, [shown.length > 0, shown.length < all.length, shown.every(every)], [true, true, true]);
        await reset();
      };
      await narrowed("who", () => page.type("#who", "Bea"), (r) => r[1]!.startsWith("Bea"), () => page.type("#who", " "));
      await page.run(`${q("#who")}.value = ""; ${q("#who")}.dispatchEvent(new Event("input"))`);
      await narrowed("rank", () => page.choose("#rank", "4"), (r) => r[2] === "cluster", () => page.choose("#rank", "-1"));
      await narrowed("words", () => page.type("#words", "Wardens"), (r) => /wardens/i.test(r[4]!), async () => void (await page.run(`${q("#words")}.value = ""; ${q("#words")}.dispatchEvent(new Event("input"))`)));
      await narrowed("kind", () => page.choose("#kind", "sign-in"), (r) => /sign-in/.test(r[4]!), () => page.choose("#kind", ""));
      check("the filters let go show it all again", (await actRows()).length, all.length);
      await picture(page, "acts");
      const why = host.changePermissions(OPERATOR, { op: "addGroup", group: "Latecomers" });
      if (why !== "") fault(`the operator could not add Latecomers: ${why}`);
      check("a new act shows within a few seconds without a reload", await page.wait(`(${q("#acts tr")}?.textContent ?? "").includes("Latecomers")`, 60), true);
      errorsOf(page, "the admin log");

      // The Permissions page's tabs again, everything above in place, for the pictures.
      await page.go(`${pagePath}#chat`);
      await page.wait(`${q("#me")}.textContent !== ""`);
      await page.go(`${pagePath}#members`);
      check("a new address on the open page shows its tab", await page.run(`[${q("#tab-members")}.hidden, ${q("#tab-chat")}.hidden]`), [false, true]);
      for (const tab of ["groups", "members", "chat", "import"]) {
        await page.press(`[data-tab="${tab}"]`);
        await picture(page, `tab-${tab}`);
      }
      errorsOf(page, "the tabs again");
    });

    // 10. The dashboard signs in with the cluster's password and a typed name, then with the map's.
    await browse(chrome, `${origin}/admin/`, scratch, null, async (page) => {
      const text = (selector: string): Promise<string> => page.run(`${q(selector)}?.textContent ?? ""`);
      const signIn = async (name: string, password: string, want: string): Promise<void> => {
        if (!(await page.wait(`!${q("#password-field")}.hidden && !${q("#password")}.disabled`, 100))) fault(`the dashboard offered no sign-in: ${await text("#access-note")}`);
        await page.type("#sign-in-name", name);
        await page.type("#password", password);
        await page.press("#submit-password");
        const ok = await page.wait(`${q("#signed-in-as")}.textContent === ${JSON.stringify(want)}`, 100);
        check(`the dashboard says: ${want}`, ok ? want : await text("#signed-in-as") || await text("#access-note"), want);
      };
      await signIn("Kody", passwords.cluster, "Signed in as (Kody), at the cluster rank.");
      await picture(page, "dashboard");
      // Locked until signed in: each world's overview answers 401 to a browser that has not.
      errorsOf(page, "the dashboard, cluster password", Array.from({ length: 6 }, () => /401 .*\/admin\/(overview|me)\.json|status of 401/));
      await page.press("#sign-out");
      await signIn("", passwords.map, "Signed in as (admin), at the map rank.");
      errorsOf(page, "the dashboard, map password", Array.from({ length: 6 }, () => /401 .*\/admin\/(overview|me)\.json|status of 401/));
    });
  } catch (err) {
    fault(err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
  for (const s of here) await s.leave();
  // A password seen is never in what is said of a fault.
  return faults.map((f) => [...passwordsSeen, passwords.map, passwords.cluster].reduce((t, p) => t.split(p).join("<password>"), f));
}

const rowsOfPasswords = (page: Page): Promise<string[]> => page.run(`[...document.querySelectorAll("#passwords tr")].map((tr) => [...tr.cells].map((c) => c.textContent.trim().replace(/\\s+/g, " ")).join(" | "))`);
