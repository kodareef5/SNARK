import { MIAMI_FLIGHT } from "../core/title-route.ts";
const box = document.querySelector<HTMLElement>("#scenery")!,
  motion = document.querySelector<HTMLButtonElement>("#motion")!;
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
let paused = reduce.matches,
  frame: HTMLIFrameElement | null = null,
  video: HTMLVideoElement | null = null,
  source = "",
  requested = "",
  rotation = 0,
  offset = 0,
  tilt = 0,
  spawn = 0,
  preview = false;
let look: number[] = [];
let subjectLeft = true;
let ready = false,
  videoFailed = false;
const send = () =>
  frame?.contentWindow?.postMessage(
    { source: "snark-title", shot: preview ? "survivor" : "flight", paused, subjectLeft, turn: rotation, yaw: offset, pitch: tilt, spawn, look },
    location.origin,
  );
const update = () => {
  motion.hidden = preview;
  motion.textContent = paused ? "Play flyover" : "Pause flyover";
  motion.setAttribute("aria-pressed", String(paused));
  if (video) {
    if (paused || ready || preview) video.pause();
    else void video.play().catch(() => {});
  }
  send();
};
function fallback() {
  if (!video && !videoFailed && !reduce.matches && !preview) {
    video = document.createElement("video");
    video.src = "title/miami-flight.webm";
    video.poster = "title/miami-flight.webp";
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.onerror = () => {
      videoFailed = true;
      video?.remove();
      video = null;
    };
    box.prepend(video);
  }
  update();
}
export function sceneFor(world: string, map: string, human: boolean, appearance: Uint8Array, at: number, turn: number, left = true) {
  subjectLeft = left;
  box.classList.toggle("portrait", human);
  box.classList.toggle("left", left);
  preview = human;
  look = Array.from(appearance);
  spawn = at;
  rotation = turn;
  const want =
    world && new URL(world).origin === location.origin && (human || map === MIAMI_FLIGHT.map) ? new URL("flight.html", world).href : "";
  // Reduced motion keeps a retaken still until the player asks for motion. A creator always has a native preview.
  requested = want;
  const url = paused && !human && !frame ? "" : want;
  if (url !== source) {
    ready = false;
    frame?.remove();
    frame = null;
    source = url;
    if (url) {
      frame = document.createElement("iframe");
      frame.title = "Native scene";
      frame.tabIndex = -1;
      frame.src = url;
      frame.onload = send;
      box.append(frame);
    }
  }
  fallback();
  update();
}
addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.source !== frame?.contentWindow || e.data?.source !== "snark-scene") return;
  if (e.data.type === "frame") send();
  if (e.data.type === "ready") {
    ready = true;
    frame?.classList.add("visible");
    update();
  }
  if (e.data.type === "failed") {
    frame?.remove();
    frame = null;
    source = "";
    ready = false;
    fallback();
  }
});
motion.onclick = () => {
  paused = !paused;
  if (!paused && !source && requested) {
    sceneFor(new URL("./", requested).href, MIAMI_FLIGHT.map, false, Uint8Array.from(look), spawn, rotation);
  }
  update();
};
reduce.addEventListener("change", (e) => {
  paused = e.matches;
  update();
});
let held = false,
  x = 0,
  y = 0;
box.onpointerdown = (e) => {
  held = true;
  x = e.clientX;
  y = e.clientY;
  box.setPointerCapture(e.pointerId);
};
box.onpointermove = (e) => {
  if (!held) return;
  offset = Math.max(-MIAMI_FLIGHT.camera.yawLimit, Math.min(MIAMI_FLIGHT.camera.yawLimit, offset + (e.clientX - x) * 0.004));
  tilt = Math.max(-MIAMI_FLIGHT.camera.pitchLimit, Math.min(MIAMI_FLIGHT.camera.pitchLimit, tilt + (e.clientY - y) * 0.003));
  x = e.clientX;
  y = e.clientY;
  send();
};
box.onpointerup = box.onpointercancel = () => {
  held = false;
  offset = tilt = 0;
  send();
};
