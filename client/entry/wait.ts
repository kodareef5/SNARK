// The page a game page leaves for when its server stops for an update (client/core/waiting.ts): it asks the world's
// ready.json until a new start answers whose page is built, then goes back into the game as the same survivor. Its
// script is written into its HTML by the build, so the one request that fetches it is all it needs of the old server.

import { launchKey } from "../core/entry-state.ts";
import { backAddress, readComeback, readReady, waitKey, waitOut } from "../core/waiting.ts";

const line = document.querySelector<HTMLElement>("#line")!;
const at = waitKey(location.pathname);
let who = null as ReturnType<typeof readComeback>;
try { who = readComeback(sessionStorage.getItem(at)); } catch {}

if (!who) location.replace("./");
else {
  const c = who;
  waitOut(c, {
    now: () => Date.now(),
    ask: () => fetch("ready.json", { cache: "no-store", signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.json() : null)).then(readReady, () => null),
    later: (run, ms) => void setTimeout(run, ms),
    random: () => Math.random(),
    say: (text) => void (line.textContent = text),
    enter: () => {
      try {
        // The launch the game page reads, as the title writes one for a survivor it continues.
        sessionStorage.setItem(launchKey(new URL("play.html", location.href).pathname), JSON.stringify({ intent: "resume", name: c.name, password: c.password }));
        sessionStorage.removeItem(at);
      } catch {}
      location.replace(backAddress(c));
    },
  });
}
