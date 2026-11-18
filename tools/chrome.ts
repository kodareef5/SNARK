// Where the tools that drive a browser find Chrome. Each tool once carried its own list, written on a Mac: some had no
// Linux path at all, and none looked on the PATH, where a Linux machine's Chrome or Chromium usually is.

import { existsSync } from "node:fs";

const APPS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
const ON_PATH = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

/**
 * Flags every launch passes after `--headless=new`. Chrome will not start as root with its sandbox on, and a Linux server
 * often runs the tools as root. What they open is the game from this machine, which the sandbox has nothing to keep out.
 */
export const CHROME_FLAGS: string[] = process.getuid?.() === 0 ? ["--no-sandbox"] : [];

/** CHROME if it is set, else the first Chrome or Chromium found on this machine, else undefined. */
export function findChrome(): string | undefined {
  if (process.env.CHROME) return process.env.CHROME;
  return APPS.find((p) => existsSync(p)) ?? ON_PATH.map((name) => Bun.which(name)).find((p): p is string => p !== null);
}
