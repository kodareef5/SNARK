// Browser and keyboard setup shared by the live driving courses.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunningServer } from "../../server/main.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { devtools } from "../map/trip.ts";

export async function until<T>(read: () => T | undefined | false | Promise<T | undefined | false>, description: string, timeout = 45000): Promise<T> {
  const end = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await Bun.sleep(40);
  } while (Date.now() < end);
  throw new Error(description + " timed out");
}

/** Opens a separate browser profile and waits for this player's real input packets. */
export async function drivingBrowser(server: RunningServer, name: string, view?: string) {
  const query = new URLSearchParams({ tier: "lowpoly" });
  if (view) query.set("look", view);
  return gameBrowser(server, name, query);
}

/** Opens a fresh profile on a direct or shaped link and waits for its inputs. */
export async function gameBrowser(server: RunningServer, name: string, query: URLSearchParams, port = server.port) {
  const chrome = findChrome();
  if (!chrome) throw new Error("Set CHROME to an installed Chromium executable.");
  const profile = mkdtempSync(join(tmpdir(), "snark-driving-browser-"));
  const graphics = process.argv.includes("--software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : process.platform === "darwin" ? ["--use-angle=metal"] : [];
  let browser: ReturnType<typeof Bun.spawn> | undefined;
  let tab: Awaited<ReturnType<typeof devtools>> | undefined;
  const close = async () => {
    tab?.close();
    if (browser) { browser.kill(); await browser.exited; }
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", ...graphics,
      "--window-size=800,600", "--remote-debugging-port=0", "--user-data-dir="+profile, "about:blank"], { stdout: "ignore", stderr: "ignore" });
    tab = await devtools(profile);
    await tab.send("Runtime.enable");
    await tab.send("Page.enable");
    query.set("quick", "1");
    query.set("name", name);
    await tab.send("Page.navigate", { url: "http://127.0.0.1:"+port+"/?"+query });
    await tab.send("Page.bringToFront");
    const host = server.host;
    const client = await until(() => host.game.clients.find(c => c?.active && c.name === name && c.ent >= 0) ?? undefined, name+" joining", 90000);
    const input = client.newestInput;
    await until(() => client.newestInput > input && host.world.tick - client.inputAt < 12, name+" input sampling", 90000);
    return { tab, client, close };
  } catch (error) {
    if (tab) console.error(await tab.value<string>("document.body.innerText.slice(-1400)").catch(() => "Browser closed"));
    await close();
    throw error;
  }
}
