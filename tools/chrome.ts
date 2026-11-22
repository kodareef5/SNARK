// Where the tools that drive a browser find Chrome. Each tool once carried its own list, written on a Mac: some had no
// Linux path at all, and none looked on the PATH, where a Linux machine's Chrome or Chromium usually is.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APPS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
const ON_PATH = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

const NVIDIA_EGL = "/usr/share/glvnd/egl_vendor.d/10_nvidia.json";

/**
 * How headless Chrome reaches a graphics card on Linux: the flags to pass and the environment to give it.
 * Left alone it tries ANGLE on Vulkan, fails with no window, and draws in software without saying so: no timer
 * queries, a tenth of the speed, and on a machine with two cards a crashed GPU process. ANGLE on EGL works, and
 * EGL takes Mesa's card unless told of NVIDIA's. `want` is SNARK_GPU: "nvidia", "mesa", or "software" to leave
 * Chrome as it is. A machine with no card (`card` false) is left as it is too, so a server still draws in software.
 */
export function linuxGpu(want: string | undefined, card: boolean, nvidia: boolean): { flags: string[]; env: Record<string, string> } {
  if (want === "software" || !card) return { flags: [], env: {} };
  const useNvidia = want === "nvidia" || (want !== "mesa" && nvidia);
  return { flags: ["--use-angle=gl-egl"], env: useNvidia ? { __EGL_VENDOR_LIBRARY_FILENAMES: NVIDIA_EGL } : {} };
}

const gpu = process.platform === "linux"
  ? linuxGpu(process.env.SNARK_GPU, existsSync("/dev/dri") && readdirSync("/dev/dri").some((n) => n.startsWith("renderD")), existsSync(NVIDIA_EGL) && existsSync("/proc/driver/nvidia"))
  : { flags: [], env: {} };

/**
 * Flags every launch passes after `--headless=new`. Chrome will not start as root with its sandbox on, and a Linux server
 * often runs the tools as root. What they open is the game from this machine, which the sandbox has nothing to keep out.
 */
export const CHROME_FLAGS: string[] = [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), ...gpu.flags];

/**
 * A script that starts `chrome` with `env` set, written once under the machine's cache. The tools start Chrome by its
 * path alone and a child does not see what this process sets in its own environment, so the choice of card rides here.
 */
function withEnv(chrome: string, env: Record<string, string>): string {
  const text = `#!/bin/sh\n${Object.entries(env).map(([k, v]) => `export ${k}='${v}'\n`).join("")}exec '${chrome}' "$@"\n`;
  const dir = join(process.env.SNARK_CACHE || join(homedir(), ".cache/snark"), "chrome");
  const file = join(dir, `chrome-${Bun.hash(text).toString(36)}`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text, { mode: 0o755 });
  }
  return file;
}

/** CHROME if it is set, else the first Chrome or Chromium found on this machine, else undefined. */
export function findChrome(): string | undefined {
  if (process.env.CHROME) return process.env.CHROME;
  const chrome = APPS.find((p) => existsSync(p)) ?? ON_PATH.map((name) => Bun.which(name)).find((p): p is string => p !== null);
  return chrome && Object.keys(gpu.env).length > 0 ? withEnv(chrome, gpu.env) : chrome;
}
