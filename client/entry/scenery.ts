import { connectionHint, constrainedConnection } from "./startup-budget.ts";

const box = document.querySelector<HTMLElement>("#scenery")!,
  motion = document.querySelector<HTMLButtonElement>("#motion")!;
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let allow = !reduce.matches,
  paused = !allow,
  title = false,
  human = false;
let titleIdle = false,
  titleTimer = 0,
  requested = false;
let world = "",
  frame: HTMLIFrameElement | null = null,
  url = "",
  failed = false,
  ready = false;
let look: number[] = [],
  spawn = 0,
  turn = 0,
  subjectLeft = true,
  mx = 0,
  my = 0;
function send() {
  frame?.contentWindow?.postMessage(
    {
      source: "snark-title",
      shot: human ? "survivor" : "set",
      paused: document.hidden || human || (title && paused),
      subjectLeft,
      turn,
      spawn,
      look,
      mx,
      my,
    },
    location.origin,
  );
}
function sync() {
  const automatic = allow && !constrainedConnection(connectionHint());
  if (title && automatic && !titleIdle && !titleTimer && !document.hidden) {
    titleTimer = setTimeout(() => {
      titleTimer = 0;
      const start = () => { titleIdle = true; sync(); };
      if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 700 });
      else start();
    }, 800);
  }
  const visible = ready || !document.hidden;
  const portrait = visible && human && world && new URL(world).origin === location.origin;
  const next = portrait
    ? new URL("flight.html", world).href
    : title && visible && !failed && (ready || !paused) && (requested || (automatic && titleIdle))
      ? new URL("flight.html?set=wynwood-shore", document.baseURI).href
      : "";
  if (next !== url) {
    frame?.remove();
    frame = null;
    url = next;
    ready = false;
    if (url) {
      frame = document.createElement("iframe");
      frame.title = title ? "Wynwood at sunset" : "Survivor preview";
      frame.tabIndex = -1;
      frame.src = url;
      frame.onload = send;
      box.append(frame);
    }
  }
  motion.hidden = !title;
  motion.textContent = failed ? "Retry live scene" : paused || !url ? "Play live scene" : "Pause live scene";
  motion.setAttribute("aria-pressed", String(!!url && !paused));
  if (title) document.body.dataset.titleScene = failed ? "failed" : ready ? "live" : url ? "loading" : "still";
  else delete document.body.dataset.titleScene;
  send();
}
export function sceneFor(
  address: string,
  portrait: boolean,
  appearance: Uint8Array,
  at: number,
  angle: number,
  left = true,
  opening = false,
) {
  if (opening !== title || portrait !== human || address !== world) failed = false;
  title = opening;
  human = portrait;
  world = address;
  look = Array.from(appearance);
  spawn = at;
  turn = angle;
  subjectLeft = left;
  box.classList.toggle("portrait", human);
  box.classList.toggle("left", left);
  sync();
}
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow || e.data?.source !== "snark-scene") return;
  if (e.data.type === "ready") {
    ready = true;
    if (title) document.body.dataset.titleScene = "live";
    frame.classList.add("visible");
  }
  if (e.data.type === "frame") send();
  if (e.data.type === "failed") {
    failed = true;
    paused = true;
    if (human) {
      frame.remove();
      frame = null;
    } else sync();
  }
});
motion.onclick = () => {
  if (failed || !frame) {
    failed = false;
    allow = true;
    requested = true;
    paused = false;
  } else paused = !paused;
  sync();
};
document.addEventListener("visibilitychange", sync);
reduce.addEventListener("change", () => {
  if (reduce.matches) {
    allow = false;
    requested = false;
    paused = true;
    mx = my = 0;
    sync();
  }
});
let queued = false;
function parallax(x: number, y: number) {
  mx = x;
  my = y;
  if (!queued) {
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (title && ready) frame?.contentWindow?.postMessage({ source: "snark-title", mx, my }, location.origin);
    });
  }
}
document.addEventListener(
  "pointermove",
  (e) => {
    if (title && ready && !paused && e.pointerType !== "touch")
      parallax((2 * e.clientX) / innerWidth - 1, 1 - (2 * e.clientY) / innerHeight);
  },
  { passive: true },
);
document.documentElement.addEventListener("pointerleave", () => {
  if (title && ready) parallax(0, 0);
});
