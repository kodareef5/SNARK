// The cluster's Screens page: the clip library, uploads with their poster and colour track, the channels and what each
// screen shows, over /admin/screens/ (server/video/routes.ts). Its parts that need no browser are in
// client/core/admin/screens.ts; this is the page's wiring.

import "./shell.ts";
import { esc } from "../core/admin/format.ts";
import {
  ColourTrack, POSTER_BYTES, POSTER_LONG, POSTER_QUALITIES, SAMPLE_LONG, bandMeans, base64, draftChannels, draftDiffers, draftFault, ffmpegLine,
  fitLong, freeChannelName, kbpsOf, lengthText, moveIn, overCaps, progressOf, timedOf, titleOf, type ChannelDraft, type Probe, type ScreensState, type StateClip,
} from "../core/admin/screens.ts";
import { COLOUR_PARTS } from "../../shared/video/clip.ts";
import { channelAt, screenAt, type Playing } from "../../shared/video/programme.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const API = "/admin/screens/";
const SCREEN_NAMES: Readonly<Record<string, string>> = { orb: "The Vegas ball" };

/** The page's state: the library as last read and when, the channels being edited, and the file picked to add. */
const S = {
  state: null as ScreensState | null,
  at: 0,
  draft: [] as ChannelDraft[],
  /** The saved channels the draft was taken from, as JSON. */
  base: "[]",
  renaming: "",
  file: null as File | null,
  video: null as HTMLVideoElement | null,
  probe: null as Probe | null,
  busy: false,
  loading: false,
};

/** The wall clock as the server keeps it, run on from its last answer. */
const wall = (): number => (S.state ? S.state.now + (performance.now() - S.at) : Date.now());
const clipsById = (): Map<string, StateClip> => new Map((S.state?.clips ?? []).map((c) => [c.id, c]));
const titleText = (id: string | null): string => (id ? (clipsById().get(id)?.title ?? id) : "the scenes");

function say(text: string, kind = "dim"): void {
  $("msg").textContent = text;
  $("msg").className = kind;
}
const failed = (err: unknown): void => say(err instanceof Error ? err.message : String(err), "bad");

const deferred = new Map<HTMLElement, string>();
const painted = new WeakMap<HTMLElement, string>();
/** Writes `html` into `el` when it changed, keeping what its named fields hold, but not under a field in hand: that waits until it is let go. */
function paint(el: HTMLElement, html: string): void {
  if (painted.get(el) === html) {
    deferred.delete(el);
    return;
  }
  const held = document.activeElement;
  if (held && el.contains(held) && /^(INPUT|SELECT|TEXTAREA)$/.test(held.tagName)) {
    deferred.set(el, html);
    return;
  }
  deferred.delete(el);
  const kept = [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("select[id], input[id]")].map((f) => [f.id, f.value] as const);
  el.innerHTML = html;
  painted.set(el, html);
  for (const [id, value] of kept) {
    const f = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (f && el.contains(f) && (f instanceof HTMLInputElement || [...f.options].some((o) => o.value === value))) f.value = value;
  }
}
document.addEventListener("focusout", () => setTimeout(() => {
  for (const [el, html] of [...deferred]) paint(el, html);
  drawNow();
}));

/** Takes the state a read or an edit answered. A channel draft with changes is kept. */
function take(state: ScreensState): void {
  const was = S.state;
  // A read sent before an edit may answer after it.
  if (was && state.revision < was.revision) return;
  S.state = state;
  S.at = performance.now();
  const saved = JSON.stringify(state.channels);
  if (!was || !draftDiffers(S.draft, JSON.parse(S.base))) {
    S.draft = draftChannels(state.channels);
    S.base = saved;
  }
  draw();
}

async function load(): Promise<void> {
  if (S.loading) return;
  S.loading = true;
  try {
    const r = await fetch(API + "state", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 401 ? "Sign in on the overview first." : `The library answered ${r.status}: ${await r.text()}`);
    take((await r.json()) as ScreensState);
    if ($("msg").textContent === "Loading…") say("");
    $("reload").hidden = true;
  } catch (e) {
    failed(e);
    $("reload").hidden = false;
  } finally {
    S.loading = false;
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; answer: Record<string, unknown> }> {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, answer: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

/** One change to the library at the revision shown. A stale one is refused, and the page reads the library again. */
async function edit(body: Record<string, unknown>, done = ""): Promise<boolean> {
  if (!S.state) return false;
  const { status, answer } = await post("edit", { revision: S.state.revision, ...body });
  if (status === 409) {
    say("The library changed elsewhere, so nothing was changed. It is shown as it is now: try again.", "warn");
    await load();
    return false;
  }
  if (status !== 200) {
    say(String(answer.error ?? `The edit answered ${status}.`), "bad");
    return false;
  }
  take(answer as unknown as ScreensState);
  say(done || "Saved.", "well");
  return true;
}

// ---- Screens

function screenHtml(): string {
  const st = S.state!;
  const visible = st.clips.filter((c) => !c.hidden);
  return st.screens.map((s) => {
    const name = esc(s.screen), pick = (field: string, value: string, label: string, on: boolean) =>
      `<button data-do="screen" data-screen="${name}" data-field="${field}" data-value="${value}" class="${on ? "on" : ""}" aria-pressed="${on}">${label}</button>`;
    const once = s.once ? st.clips.find((c) => c.id === s.once!.clip) : undefined;
    const showing = !!(s.once && once && wall() < s.once.from + once.seconds * 1000);
    return `<h3>${esc(SCREEN_NAMES[s.screen] ?? s.screen)}</h3><div class="knobs">
      <span>Show</span><div class="row"><select data-do="show" data-screen="${name}">
        <option value="scenes"${s.show === "scenes" ? " selected" : ""}>Scenes</option>
        ${st.channels.map((c) => `<option value="${esc(c.name)}"${s.show === c.name ? " selected" : ""}>Channel: ${esc(c.name)}</option>`).join("")}
      </select></div>
      <span>Play once</span><div class="row"><select id="once-${name}" aria-label="Clip to play once">${visible.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join("")}</select>
        <button data-do="once" data-screen="${name}"${visible.length ? "" : " disabled"}>Play once</button>
        <button data-do="stop" data-screen="${name}"${showing ? "" : " disabled"}>Stop the showing</button></div>
      <span>Picture</span><div class="row">${pick("mode", "theatre", "Theatre: faces each viewer", s.mode === "theatre")}${pick("mode", "band", "Band: wrapped round", s.mode === "band")}</div>
      <span>Frame</span><div class="row">${pick("fill", "false", "Fit whole", !s.fill)}${pick("fill", "true", "Fill the face", s.fill)}</div>
      <span>Sound</span><label><input type="checkbox" data-do="flag" data-screen="${name}" data-field="sound"${s.sound ? " checked" : ""}> Play the clip's sound near the screen</label>
      <span>When</span><label><input type="checkbox" data-do="flag" data-screen="${name}" data-field="night"${s.night ? " checked" : ""}> Night only (the scenes run by day; it is ${st.night ? "night" : "day"} now)</label>
    </div><div id="now-${name}" class="now"></div>`;
  }).join("");
}

/** A line of what plays, with its time bar. */
function nowHtml(playing: Playing | null, timed: ReturnType<typeof timedOf>, wallNow: number): string {
  if (!playing) return `<p class="dim">Now: the scenes.</p>`;
  const p = progressOf(playing, timed, wallNow);
  return `<p>Now: <b>${esc(titleText(playing.clip))}</b> <span class="dim">${lengthText(p.at)} of ${lengthText(p.of)}</span></p>
    <div class="time" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.share * 100)}"><i style="width:${(p.share * 100).toFixed(1)}%"></i></div>
    <p class="dim">Next: ${esc(titleText(playing.next))}</p>`;
}

/** What every screen and saved channel plays now; run each second between reads. */
function drawNow(): void {
  const st = S.state;
  if (!st) return;
  const timed = timedOf(st.clips), channels = new Map(st.channels.map((c) => [c.name, c])), now = wall();
  for (const s of st.screens) {
    const el = document.getElementById(`now-${s.screen}`);
    if (el) paint(el, nowHtml(screenAt(s, channels, timed, now, st.night), timed, now));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-now-channel]")) {
    const c = channels.get(el.dataset.nowChannel!);
    const playing = c ? channelAt(c, timed, now) : null;
    paint(el, !c ? "Not saved yet." : !playing ? "Nothing it lists can play." : `Now ${esc(titleText(playing.clip))} (${lengthText(progressOf(playing, timed, now).at)} in), next ${esc(titleText(playing.next))}.`);
  }
}

// ---- Library

function clipHtml(c: StateClip): string {
  const on = S.state!.screens.filter((s) => s.playing?.clip === c.id).map((s) => SCREEN_NAMES[s.screen] ?? s.screen);
  const badges = [c.starter ? "Starter" : "Uploaded", c.hidden ? "Hidden" : "", c.audio ? "Sound" : "Silent", on.length ? `On ${on.join(", ")}` : ""].filter(Boolean);
  const edit = S.renaming === c.id
    ? `<label class="dim">Title <input id="rename-title" maxlength="80" value="${esc(c.title)}"></label>
       <label class="dim">Who made it and why we may show it <input id="rename-rights" maxlength="240" value="${esc(c.rights)}"></label>
       <div class="bar"><button class="primary" data-do="rename-save" data-clip="${c.id}">Save</button><button data-do="rename-cancel">Cancel</button></div>`
    : `<div class="bar"><button data-do="play" data-clip="${c.id}"${c.hidden ? " disabled" : ""}>Play once on the ball</button>
       ${c.starter
         ? `<button data-do="${c.hidden ? "unhide" : "hide"}" data-clip="${c.id}">${c.hidden ? "Unhide" : "Hide"}</button>`
         : `<button data-do="rename" data-clip="${c.id}">Rename</button><button class="risk" data-do="delete" data-clip="${c.id}">Delete</button>`}</div>`;
  return `<article class="clip${c.hidden ? " hidden-clip" : ""}">
    <img src="${esc(c.poster)}" alt="" loading="lazy" width="320" height="180">
    <div class="body"><h3>${esc(c.title)}</h3>
      <div class="row">${badges.map((b) => `<span class="chip">${esc(b)}</span>`).join("")}</div>
      <span>${lengthText(c.seconds)} · ${(c.bytes / 1048576).toFixed(1)} MB · ${c.width}×${c.height} · ${c.kbps} kbit/s</span>
      <span class="dim">About ${c.kBps} KB/s for each player watching</span>
      <span class="rights">${esc(c.rights)}</span>${edit}</div></article>`;
}

function waitingHtml(): string {
  const p = S.state!.pending;
  if (!p.length) return "";
  return `<h3>Uploaded, not yet published</h3><ul>${p.map((u) => `<li>${u.width}×${u.height}, ${lengthText(u.seconds)}, ${(u.bytes / 1048576).toFixed(1)} MB, sent ${Math.max(0, Math.round((wall() - u.at) / 60000))} min ago</li>`).join("")}</ul>
    <p class="faint">Pick the same file again to finish one. An upload left waiting for an hour is removed.</p>`;
}

// ---- Channels

function channelsHtml(): string {
  const st = S.state!, all = st.clips;
  const shownOn = (name: string): string[] => st.screens.filter((s) => s.show === name).map((s) => SCREEN_NAMES[s.screen] ?? s.screen);
  if (!S.draft.length) return `<p class="dim">No channels. A screen shows the scenes until one is made.</p>`;
  return S.draft.map((d, i) => {
    const items = d.items.map((id, j) => {
      const c = all.find((x) => x.id === id);
      return `<li><span class="row"><span class="grow">${esc(c?.title ?? id)}${c?.hidden ? ' <span class="chip">Hidden</span>' : ""} <span class="dim">${c ? lengthText(c.seconds) : ""}</span></span>
        <button data-do="item-up" data-ch="${i}" data-at="${j}" aria-label="Move up"${j === 0 ? " disabled" : ""}>↑</button>
        <button data-do="item-down" data-ch="${i}" data-at="${j}" aria-label="Move down"${j === d.items.length - 1 ? " disabled" : ""}>↓</button>
        <button data-do="item-out" data-ch="${i}" data-at="${j}" aria-label="Remove">✕</button></span></li>`;
    }).join("");
    const on = shownOn(d.name);
    return `<div class="channel">
      <div class="row"><input data-do="ch-name" data-ch="${i}" value="${esc(d.name)}" maxlength="40" aria-label="Channel name">
        <button data-do="ch-order" data-ch="${i}" data-value="false" class="${d.shuffle ? "" : "on"}" aria-pressed="${!d.shuffle}">Loop in order</button>
        <button data-do="ch-order" data-ch="${i}" data-value="true" class="${d.shuffle ? "on" : ""}" aria-pressed="${d.shuffle}">Shuffle</button>
        <label><input type="checkbox" data-do="ch-reset" data-ch="${i}"${d.reset ? " checked" : ""}> Restart from the top on save</label>
        <span class="grow"></span><button class="risk" data-do="ch-delete" data-ch="${i}">Delete channel</button></div>
      ${on.length ? `<p class="dim">Shown on ${esc(on.join(", "))}.</p>` : ""}
      <p class="dim" data-now-channel="${esc(d.name)}"></p>
      ${items ? `<ol>${items}</ol>` : `<p class="faint">No clips yet.</p>`}
      <div class="row"><select id="add-${i}" aria-label="Clip to add">${all.map((c) => `<option value="${c.id}">${esc(c.title)}${c.hidden ? " (hidden)" : ""}</option>`).join("")}</select>
        <button data-do="item-add" data-ch="${i}"${all.length ? "" : " disabled"}>Add to the channel</button></div>
    </div>`;
  }).join("");
}

function drawChannelBar(): void {
  const st = S.state!, dirty = draftDiffers(S.draft, st.channels), moved = S.base !== JSON.stringify(st.channels), fault = draftFault(S.draft);
  $<HTMLButtonElement>("save-channels").disabled = !dirty || !!fault;
  $<HTMLButtonElement>("undo-channels").disabled = !dirty;
  $("channels-say").textContent = fault || (moved ? "The channels were changed elsewhere since you began. Undo your changes to see theirs." : dirty ? "Unsaved changes." : "");
  $("channels-say").className = fault || moved ? "warn" : "dim";
}

function draw(): void {
  const st = S.state;
  if (!st) return;
  $("cap-wide").textContent = String(st.caps.wide);
  $("cap-high").textContent = String(st.caps.high);
  paint($("screens"), screenHtml());
  paint($("clips"), st.clips.length ? st.clips.map(clipHtml).join("") : `<p class="dim">The library is empty.</p>`);
  paint($("waiting"), waitingHtml());
  paint($("channels"), channelsHtml());
  drawChannelBar();
  drawNow();
  void drawBall();
}

// ---- Preview

const PREVIEW_SIZE = 160;
/** Where the preview's own bundle is served; a name the bundler does not follow. */
const PREVIEW_URL: string = "/admin/ui/screens-preview.js";
type PreviewModule = typeof import("../core/admin/screens-preview.ts");
let previewModule: Promise<PreviewModule> | null = null;
let previewKey = "";
/** The ball showing the clip it plays, else the one picked to play once, drawn by the game's own twin when either changes. */
async function drawBall(): Promise<void> {
  const st = S.state, orb = st?.screens.find((s) => s.screen === "orb");
  if (!st || !orb) return;
  const id = orb.playing?.clip ?? document.querySelector<HTMLSelectElement>("#once-orb")?.value ?? "";
  const clip = st.clips.find((c) => c.id === id), key = `${id} ${orb.mode} ${orb.fill}`;
  if (!clip || key === previewKey) return;
  previewKey = key;
  const poster = new Image();
  poster.src = clip.poster;
  let twin: PreviewModule;
  try {
    [twin] = await Promise.all([(previewModule ??= import(PREVIEW_URL) as Promise<PreviewModule>), poster.decode()]);
  } catch {
    previewModule = null;
    previewKey = "";
    return;
  }
  if (previewKey !== key) return;
  const flat = document.createElement("canvas");
  flat.width = poster.naturalWidth;
  flat.height = poster.naturalHeight;
  const fc = flat.getContext("2d")!;
  fc.drawImage(poster, 0, 0);
  const picture = fc.getImageData(0, 0, flat.width, flat.height).data;
  const canvas = document.querySelector<HTMLCanvasElement>("#preview canvas")!;
  canvas.width = PREVIEW_SIZE * twin.PREVIEW_VIEWS.length;
  canvas.height = PREVIEW_SIZE;
  const out = new ImageData(canvas.width, canvas.height);
  twin.drawPreview(out.data, PREVIEW_SIZE, picture, flat.width, flat.height, Uint8Array.from(atob(clip.colours), (ch) => ch.charCodeAt(0)), orb.mode === "theatre", orb.fill);
  canvas.getContext("2d")!.putImageData(out, 0, 0);
  $("preview").querySelector("p")!.textContent = `${clip.title} at night, ${twin.PREVIEW_VIEWS.map((v) => v.label).join(", ")}.`;
}

/** The draft changed: draw the channels again. */
function redrawDraft(): void {
  paint($("channels"), channelsHtml());
  drawChannelBar();
  drawNow();
}

async function saveChannels(): Promise<void> {
  if (S.base !== JSON.stringify(S.state!.channels)) {
    say("The channels were changed elsewhere. Undo your changes to see theirs, then make yours again.", "warn");
    return;
  }
  const channels = S.draft.map((d) => ({ name: d.name, items: d.items, shuffle: d.shuffle, reset: d.reset }));
  if (!(await edit({ op: "channels", channels }, "Channels saved."))) return;
  S.draft = draftChannels(S.state!.channels);
  S.base = JSON.stringify(S.state!.channels);
  draw();
}

// ---- Upload

/** Waits for one of a media element's events. */
const once = (el: HTMLMediaElement, ok: string, no = "error"): Promise<void> =>
  new Promise((resolve, reject) => {
    const done = (): void => (el.removeEventListener(no, fail), resolve());
    const fail = (): void => (el.removeEventListener(ok, done), reject(new Error("The browser could not read the clip.")));
    el.addEventListener(ok, done, { once: true });
    el.addEventListener(no, fail, { once: true });
  });

async function seek(v: HTMLVideoElement, t: number): Promise<void> {
  const wait = once(v, "seeked");
  v.currentTime = t;
  await wait;
}

async function pick(file: File): Promise<void> {
  if (S.busy) return;
  forget();
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  // Kept in the page, unseen: a browser may not hand frames of a video outside it to the frame callback.
  v.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.append(v);
  S.file = file;
  S.video = v;
  v.src = URL.createObjectURL(file);
  let probe: Probe = { width: 0, height: 0, seconds: 0, bytes: file.size };
  try {
    await once(v, "loadedmetadata");
    probe = { width: v.videoWidth, height: v.videoHeight, seconds: Number.isFinite(v.duration) ? v.duration : 0, bytes: file.size };
  } catch {
    v.remove();
    S.video = null;
  }
  S.probe = probe;
  $("picked").hidden = false;
  $("work").hidden = true;
  $<HTMLInputElement>("title").value = titleOf(file.name);
  showPicked();
}

function showPicked(): void {
  const p = S.probe, file = S.file, st = S.state;
  if (!p || !file || !st) return;
  const over = S.video ? overCaps(p, st.caps) : ["This browser cannot play it, so the ball could not either. It may not be H.264 in an MP4."];
  const facts = [esc(file.name), p.width ? `${p.width}×${p.height}` : "", p.seconds ? lengthText(p.seconds) : "", `${(p.bytes / 1048576).toFixed(1)} MB`,
    p.seconds ? `${kbpsOf(p)} kbit/s` : "", p.seconds ? `about ${Math.round(p.bytes / p.seconds / 100) / 10} KB/s for each player watching` : ""];
  $("facts").innerHTML = facts.filter(Boolean).map((f) => `<span>${f}</span>`).join("");
  $("over").innerHTML = over.length
    ? `<p class="bad">${over.map(esc).join(" ")}</p><p>This line makes a copy that fits:</p><code class="line" id="line">${esc(ffmpegLine(file.name, p, st.caps))}</code>
       <div class="bar send"><button id="copy-line">Copy the line</button></div>`
    : `<p class="well">It fits the caps.</p>`;
  const copy = document.getElementById("copy-line");
  if (copy) copy.onclick = () => void navigator.clipboard.writeText($("line").textContent ?? "").then(() => say("The line is copied.", "well"), failed);
  $<HTMLButtonElement>("send").disabled = S.busy || over.length > 0;
}

function forget(): void {
  if (S.busy) return;
  if (S.video) {
    URL.revokeObjectURL(S.video.src);
    S.video.remove();
  }
  S.file = S.video = S.probe = null;
  $("picked").hidden = true;
  $<HTMLInputElement>("file").value = "";
}

/** Sends the file with its upload's progress, which fetch cannot show. */
function upload(file: File, title: string, progress: (share: number) => void): Promise<{ status: number; answer: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${API}upload?name=${encodeURIComponent(title)}`);
    x.setRequestHeader("content-type", "video/mp4");
    x.upload.onprogress = (e) => e.lengthComputable && progress(e.loaded / e.total);
    x.onload = () => {
      let answer: Record<string, unknown> = {};
      try {
        answer = JSON.parse(x.responseText) as Record<string, unknown>;
      } catch {
        answer = { error: x.responseText || `The upload answered ${x.status}.` };
      }
      resolve({ status: x.status, answer });
    };
    x.onerror = () => resolve({ status: 0, answer: { error: "The upload broke off." } });
    x.send(file);
  });
}

/** A frame at a tenth of the clip as a JPEG of POSTER_BYTES at most, in base64. */
async function posterOf(v: HTMLVideoElement): Promise<string> {
  await seek(v, v.duration * 0.1);
  const c = document.createElement("canvas"), g = c.getContext("2d")!;
  let { width, height } = fitLong(v.videoWidth, v.videoHeight, POSTER_LONG);
  while (width >= 16 && height >= 16) {
    [c.width, c.height] = [width, height];
    g.drawImage(v, 0, 0, width, height);
    for (const q of POSTER_QUALITIES) {
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", q));
      if (blob && blob.size <= POSTER_BYTES) return base64(new Uint8Array(await blob.arrayBuffer()));
    }
    [width, height] = [Math.round(width * 0.75), Math.round(height * 0.75)];
  }
  throw new Error("The poster would not fit in 64 KB.");
}

/** Plays the clip muted and fast, reading each new frame's bands into the colour track. */
async function coloursOf(v: HTMLVideoElement, rate: number, progress: (share: number) => void, stopped: () => boolean): Promise<ColourTrack> {
  const track = new ColourTrack(rate), { width, height } = fitLong(v.videoWidth, v.videoHeight, SAMPLE_LONG);
  const c = document.createElement("canvas");
  [c.width, c.height] = [width, height];
  const g = c.getContext("2d", { willReadFrequently: true })!, means = new Float64Array(COLOUR_PARTS * 3);
  const sample = (t: number): void => {
    g.drawImage(v, 0, 0, width, height);
    track.add(t, bandMeans(g.getImageData(0, 0, width, height).data, width, height, means));
    progress(v.duration > 0 ? t / v.duration : 0);
  };
  await seek(v, 0);
  sample(0);
  // A browser that refuses a rate throws or keeps the old one.
  for (const r of [16, 8, 4, 2, 1]) {
    try {
      v.playbackRate = r;
      if (v.playbackRate === r) break;
    } catch {
      continue;
    }
  }
  return new Promise((resolve) => {
    let over = false, seen = -1, still = 0;
    const finish = (): void => {
      if (over) return;
      over = true;
      clearInterval(watch);
      v.pause();
      resolve(track);
    };
    v.addEventListener("ended", finish, { once: true });
    if (typeof v.requestVideoFrameCallback === "function") {
      const step = (_: number, meta: VideoFrameCallbackMetadata): void => {
        if (over) return;
        sample(meta.mediaTime);
        v.requestVideoFrameCallback(step);
      };
      v.requestVideoFrameCallback(step);
    } else {
      let last = -1;
      const step = (): void => {
        if (over) return;
        if (v.currentTime !== last) sample((last = v.currentTime));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    // A clip that stops moving is nudged, then taken as it is: the gaps are eased over.
    const watch = setInterval(() => {
      if (stopped()) return finish();
      if (v.currentTime !== seen) return void ((seen = v.currentTime), (still = 0));
      if (++still === 3) void v.play().catch(() => undefined);
      if (still >= 10) finish();
    }, 1000);
    void v.play().catch(finish);
  });
}

async function send(): Promise<void> {
  const file = S.file, v = S.video, st = S.state;
  if (!file || !v || !st || S.busy) return;
  const title = $<HTMLInputElement>("title").value.replace(/\s+/g, " ").trim(), rights = $<HTMLInputElement>("rights").value.replace(/\s+/g, " ").trim();
  if (!title) return say("Give the clip a title.", "bad");
  if (!rights) {
    $("rights").focus();
    return say("Say who made the clip and why we may show it.", "bad");
  }
  S.busy = true;
  $<HTMLButtonElement>("send").disabled = $<HTMLButtonElement>("forget").disabled = true;
  $("work").hidden = false;
  const up = $<HTMLProgressElement>("up"), read = $<HTMLProgressElement>("read");
  up.value = read.value = 0;
  $("work-say").textContent = "Sending the clip and reading its colours. Keep this tab in front until it is done.";
  let stop = false;
  try {
    // The upload and the reading run at once; the track's length comes from what the server read of the file.
    const sent = upload(file, title, (s) => (up.value = s)).then((r) => ((stop = r.status !== 200), r));
    const made = posterOf(v).then(async (poster) => ({ poster, track: await coloursOf(v, st.caps.colourRate, (s) => (read.value = s), () => stop) }));
    made.catch(() => undefined);
    const r = await sent;
    if (r.status !== 200) {
      await made.catch(() => undefined);
      throw new Error(r.status === 409 ? "That clip is in the library already." : String(r.answer.error ?? `The upload answered ${r.status}.`));
    }
    up.value = 1;
    const { poster, track } = await made;
    read.value = 1;
    const samples = Math.max(1, Math.round(Number(r.answer.seconds) * st.caps.colourRate));
    const done = await post("clip", { id: r.answer.id, title, rights, poster, colours: base64(track.finish(samples)) });
    if (done.status !== 200) throw new Error(String(done.answer.error ?? `Publishing answered ${done.status}.`));
    S.busy = false;
    forget();
    $<HTMLInputElement>("rights").value = "";
    say(`${title} is in the library (${track.filled} of ${samples} colour samples read from frames).`, "well");
    await load();
  } catch (e) {
    failed(e);
    $("work-say").textContent = "";
  } finally {
    S.busy = false;
    $<HTMLButtonElement>("forget").disabled = false;
    showPicked();
  }
}

// ---- Wiring

const num = (el: HTMLElement, key: string): number => Number(el.dataset[key]);

document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-do]");
  if (!b || !S.state) return;
  const clip = b.dataset.clip ?? "", screen = b.dataset.screen ?? "", d = S.draft[num(b, "ch")];
  const act = (p: Promise<unknown>): void => void p.catch(failed);
  switch (b.dataset.do) {
    case "screen":
      return act(edit({ op: "screen", screen, [b.dataset.field!]: b.dataset.field === "fill" ? b.dataset.value === "true" : b.dataset.value }));
    case "once":
      return act(edit({ op: "once", screen, clip: $<HTMLSelectElement>(`once-${screen}`).value }, "Playing it once."));
    case "stop":
      return act(edit({ op: "stop", screen }, "Stopped; the screen is back on what it shows."));
    case "play":
      return act(edit({ op: "once", screen: "orb", clip }, "Playing it once on the ball."));
    case "hide":
    case "unhide":
      return act(edit({ op: b.dataset.do, clip }, b.dataset.do === "hide" ? "Hidden: no screen plays it." : "Shown again."));
    case "delete":
      if (confirm(`Delete ${titleText(clip)}? Its file goes, and every channel loses it.`)) act(edit({ op: "delete", clip }, "Deleted."));
      return;
    case "rename":
      S.renaming = clip;
      return draw();
    case "rename-cancel":
      S.renaming = "";
      return draw();
    case "rename-save": {
      const title = $<HTMLInputElement>("rename-title").value, rights = $<HTMLInputElement>("rename-rights").value;
      return act(edit({ op: "rename", clip, title, rights }, "Renamed.").then((ok) => ok && ((S.renaming = ""), draw())));
    }
    case "ch-order":
      if (d) d.shuffle = b.dataset.value === "true";
      return redrawDraft();
    case "ch-delete":
      if (d && (!d.items.length || confirm(`Delete the channel ${d.name}?`))) S.draft.splice(num(b, "ch"), 1);
      return redrawDraft();
    case "item-up":
    case "item-down":
      if (d) moveIn(d.items, num(b, "at"), b.dataset.do === "item-up" ? -1 : 1);
      return redrawDraft();
    case "item-out":
      if (d) d.items.splice(num(b, "at"), 1);
      return redrawDraft();
    case "item-add": {
      const id = $<HTMLSelectElement>(`add-${num(b, "ch")}`).value;
      if (d && id) d.items.push(id);
      return redrawDraft();
    }
  }
});

document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement & HTMLSelectElement;
  if (el.id === "once-orb") void drawBall();
  if (!S.state || !el.dataset.do) return;
  const d = S.draft[num(el, "ch")];
  if (el.dataset.do === "show") void edit({ op: "screen", screen: el.dataset.screen, show: el.value }).catch(failed);
  else if (el.dataset.do === "flag") void edit({ op: "screen", screen: el.dataset.screen, [el.dataset.field!]: el.checked }).catch(failed);
  else if (el.dataset.do === "ch-name" && d) (d.name = el.value.replace(/\s+/g, " ").trim()), redrawDraft();
  else if (el.dataset.do === "ch-reset" && d) (d.reset = el.checked), redrawDraft();
});

$("add-channel").onclick = () => {
  S.draft.push({ name: freeChannelName(S.draft), items: [], shuffle: false, reset: false });
  redrawDraft();
};
$("save-channels").onclick = () => void saveChannels().catch(failed);
$("undo-channels").onclick = () => {
  if (!S.state) return;
  S.draft = draftChannels(S.state.channels);
  S.base = JSON.stringify(S.state.channels);
  redrawDraft();
};
$("reload").onclick = () => void load();
$("send").onclick = () => void send();
$("forget").onclick = forget;
$<HTMLInputElement>("file").onchange = () => {
  const f = $<HTMLInputElement>("file").files?.[0];
  if (f) void pick(f).catch(failed);
};
const drop = $("drop");
drop.ondragover = (e) => (e.preventDefault(), drop.classList.add("over"));
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer?.files[0];
  if (f) void pick(f).catch(failed);
};

void load();
// The library is read again every five seconds while the page is in view, and what plays is run on each second.
setInterval(() => !document.hidden && void load(), 5000);
setInterval(() => !document.hidden && drawNow(), 1000);
document.addEventListener("visibilitychange", () => !document.hidden && void load());
