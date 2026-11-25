// The cluster's Screens page: the Vegas ball live as its players see it and a preview of what is picked, with tiles
// for its scenes and channels and a table of clips to pick from; then uploads and channel edits, over /admin/screens/
// (server/video/routes.ts). The ball is drawn by its own bundle (screens-stage.ts) with the game's shader. The parts
// that need no browser are in client/core/admin/screens.ts and screens-stage.ts; this is the page's wiring.

import "./shell.ts";
import { esc } from "../core/admin/format.ts";
import {
  ColourTrack, POSTER_BYTES, POSTER_LONG, POSTER_QUALITIES, SAMPLE_LONG, bandMeans, base64, draftChannels, draftDiffers, draftFault, ffmpegLine, findClips,
  fitLong, freeChannelName, kbpsOf, lengthText, moveIn, overCaps, progressOf, sortClips, timedOf, titleOf, type ChannelDraft, type ClipSort, type Probe, type ScreensState, type StateClip,
} from "../core/admin/screens.ts";
import type { StageFrame, StageLook, Target, Tile } from "../core/admin/screens-stage.ts";
import { COLOUR_PARTS } from "../../shared/video/clip.ts";
import { channelAt, screenAt } from "../../shared/video/programme.ts";
import type { PictureSlot, ScreensStage, Stage } from "./screens-stage.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const API = "/admin/screens/";
const SCREEN_NAMES: Readonly<Record<string, string>> = { orb: "The Vegas ball" };

/** The page's state: the library as last read and when, what is picked for the preview, the table's order, the channels being edited, and the file picked to add. */
const S = {
  state: null as ScreensState | null,
  at: 0,
  picked: null as Target | null,
  pickedAt: 0,
  view: 0,
  bearing: Math.PI,
  sort: "added" as ClipSort,
  down: false,
  query: "",
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
/** The world's clock in seconds, as its players' orb runs on it. */
const worldSeconds = (): number => (S.state ? S.state.world.seconds + (performance.now() - S.at) / 1000 : 0);
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
function paint(el: HTMLElement, html: string): boolean {
  if (painted.get(el) === html) {
    deferred.delete(el);
    return false;
  }
  const held = document.activeElement;
  if (held && el.contains(held) && /^(INPUT|SELECT|TEXTAREA)$/.test(held.tagName)) {
    deferred.set(el, html);
    return false;
  }
  deferred.delete(el);
  const kept = [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("select[id], input[id]")].map((f) => [f.id, f.value] as const);
  el.innerHTML = html;
  painted.set(el, html);
  for (const [id, value] of kept) {
    const f = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (f && el.contains(f) && (f instanceof HTMLInputElement || [...f.options].some((o) => o.value === value))) f.value = value;
  }
  return true;
}
document.addEventListener("focusout", () => setTimeout(() => {
  for (const [el, html] of [...deferred]) paint(el, html);
  wantThumbs();
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

// ---- The stage: the live monitor, the preview and every thumbnail, drawn by the game's own shader.

let mod: ScreensStage | null = null;
let stage: Stage | null = null;
let live: { frame: StageFrame; slot: PictureSlot; video: HTMLVideoElement } | null = null;
let preview: { frame: StageFrame; slot: PictureSlot; video: HTMLVideoElement } | null = null;
let thumb: { frame: StageFrame; slot: PictureSlot } | null = null;

/** The stage's own bundle, loaded once as a module script that leaves its exports on the page. */
function loadStage(): Promise<ScreensStage> {
  return new Promise((ok, no) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/admin/ui/screens-stage.js";
    script.onload = () => {
      const loaded = (globalThis as { screensStage?: ScreensStage }).screensStage;
      if (loaded) ok(loaded);
      else no(new Error("The ball's drawing did not load."));
    };
    script.onerror = () => no(new Error("The ball's drawing did not load."));
    document.head.append(script);
  });
}

/** A video for a monitor: muted, inline, kept in the page unseen, as a browser hands frames only of a video in it. */
function hiddenVideo(): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.loop = false;
  v.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.append(v);
  return v;
}

async function startStage(): Promise<void> {
  try {
    mod = await loadStage();
    stage = new mod.Stage();
  } catch (e) {
    $("no-stage").hidden = false;
    $("no-stage").textContent = `${e instanceof Error ? e.message : String(e)} The tiles show posters instead.`;
    return;
  }
  live = { frame: new mod.StageFrame(), slot: new mod.PictureSlot(), video: hiddenVideo() };
  preview = { frame: new mod.StageFrame(), slot: new mod.PictureSlot(), video: hiddenVideo() };
  thumb = { frame: new mod.StageFrame(), slot: new mod.PictureSlot() };
  drawViews();
  drawTiles();
  wantThumbs();
  requestAnimationFrame(frame);
}

const posters = new Map<string, HTMLImageElement>();
/** A clip's poster, decoded, or null while it loads. */
function posterImage(clip: StateClip): HTMLImageElement | null {
  let img = posters.get(clip.poster);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = clip.poster;
    posters.set(clip.poster, img);
    img.decode().then(() => wantThumbs(), () => undefined);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Plays `look`'s clip on `m`'s video where it is in step with `look`, and puts its frame, or its poster until one comes, in the slot. */
function feed(m: { slot: PictureSlot; video: HTMLVideoElement }, look: StageLook): void {
  const v = m.video, clip = look.clip;
  if (!clip) {
    if (!v.paused) v.pause();
    return;
  }
  if (!v.src.endsWith(clip.file)) {
    v.src = clip.file;
    v.load();
    // The last clip's frame is not this one's: its poster stands in until a frame comes.
    m.slot.source = null;
  }
  mod!.keepInStep(v, look.clipSeconds);
  if (v.readyState >= 2 && !v.seeking) stage!.upload(m.slot, v);
  else if (m.slot.source !== v || m.slot.width === 0) {
    const p = posterImage(clip);
    if (p) stage!.upload(m.slot, p);
  }
}

/** Sizes a canvas to its box at the screen's pixels, up to twice the box. */
function fit(c: HTMLCanvasElement): void {
  const k = Math.min(2, devicePixelRatio || 1), w = Math.round(c.clientWidth * k), h = Math.round(c.clientHeight * k);
  if (c.width !== w || c.height !== h) [c.width, c.height] = [w, h];
}

let hovered = "";
function frame(): void {
  requestAnimationFrame(frame);
  const st = S.state;
  if (!st || !stage || !mod || !live || !preview || document.hidden) return;
  const now = wall(), seconds = worldSeconds(), view = mod.STAGE_VIEWS[S.view]!, w = st.world;
  const shown = mod.liveLook(st, now);
  feed(live, shown);
  const lc = $<HTMLCanvasElement>("live");
  fit(lc);
  stage.draw(lc, live.frame, shown, view, S.bearing, seconds, w.hour, w.gain, live.slot);
  const pc = $<HTMLCanvasElement>("preview");
  fit(pc);
  if (S.picked) {
    const look = mod.targetLook(st, S.picked, performance.now() - S.pickedAt, now);
    feed(preview, look);
    stage.draw(pc, preview.frame, look, view, S.bearing, seconds, w.hour, w.gain, preview.slot);
  } else {
    feed(preview, { ...shown, clip: null });
    pc.getContext("2d")!.clearRect(0, 0, pc.width, pc.height);
  }
  // A scene's tile under the pointer moves.
  const tile = hovered ? document.querySelector<HTMLCanvasElement>(`canvas[data-thumb="${CSS.escape(hovered)}"]`) : null;
  if (tile && hovered.startsWith("scene")) drawThumb(tile, seconds);
  // Thumbnails wanting a picture, a few a frame.
  for (let n = 0; n < 4 && thumbQueue.length; n++) {
    const c = thumbQueue.shift()!;
    if (c.isConnected) drawThumb(c, seconds);
  }
}

/** The tiles and the table's rows, by key. */
let tiles = new Map<string, Tile>();

/** A thumbnail: the ball showing its tile's target from the street, still, its clip at its poster. */
function drawThumb(c: HTMLCanvasElement, seconds: number): void {
  const st = S.state, t = tiles.get(c.dataset.thumb ?? "");
  if (!st || !t || !stage || !mod || !thumb) return;
  fit(c);
  let look = mod.targetLook(st, t.target, 0, wall());
  if (t.clip) {
    const p = posterImage(t.clip);
    if (!p) return;
    stage.upload(thumb.slot, p);
    look = { ...look, clip: t.clip, clipSeconds: t.clip.seconds * 0.1 };
  }
  stage.draw(c, thumb.frame, look, mod.STAGE_VIEWS[0]!, Math.PI, seconds, st.world.hour, st.world.gain, thumb.slot, true);
  c.dataset.drawn = thumbStamp();
}

/** What a drawn thumbnail depends on beyond its tile: the clips' mode and fill, and night or day. */
function thumbStamp(): string {
  const orb = S.state?.screens.find((s) => s.screen === "orb");
  return `${orb?.mode} ${orb?.fill} ${S.state?.night}`;
}

const thumbQueue: HTMLCanvasElement[] = [];
/** Thumbnails come into view, or the way they look changed: each is drawn again once. */
const seen = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting && (e.target as HTMLCanvasElement).dataset.drawn !== thumbStamp()) thumbQueue.push(e.target as HTMLCanvasElement);
  })
  : null;
function wantThumbs(): void {
  if (!stage) return;
  for (const c of document.querySelectorAll<HTMLCanvasElement>("canvas[data-thumb]")) {
    if (c.dataset.drawn === thumbStamp()) continue;
    seen?.unobserve(c);
    if (seen) seen.observe(c);
    else thumbQueue.push(c);
  }
}

// ---- What is live, what is picked, and the tiles.

function pickTarget(target: Target): void {
  S.picked = target;
  S.pickedAt = performance.now();
  if (preview) preview.frame = new mod!.StageFrame();
  drawPicked();
  for (const el of document.querySelectorAll<HTMLElement>("[data-pick]")) el.classList.toggle("picked", el.dataset.pick === mod?.targetKey(target));
}

function drawPicked(): void {
  const st = S.state, t = S.picked;
  if (!st || !mod) return;
  const button = $<HTMLButtonElement>("take");
  if (!t) {
    button.disabled = true;
    $("pv-note").textContent = "";
    return;
  }
  const key = mod.targetKey(t), tile = tiles.get(key), isLive = mod.liveKey(st, wall()) === key;
  $("pv-title").textContent = tile?.title ?? "";
  button.disabled = isLive;
  button.textContent = isLive ? "It is live" : "Go live";
  const orb = st.screens.find((s) => s.screen === "orb");
  const back = orb ? (orb.show === "scenes" ? "the scenes in turn" : orb.show.startsWith("scene:") ? (tiles.get(orb.show)?.title ?? "its scene") : `the channel ${orb.show}`) : "";
  $("pv-note").textContent = isLive ? "This is on the ball now." : t.kind === "clip" ? `Plays once, then the ball goes back to ${back}.` : (tile?.note ?? "");
}

/** The line under the live monitor: what plays, how far in, and what comes next. */
function drawLiveLine(): void {
  const st = S.state;
  if (!st || !mod) return;
  const now = wall(), look = mod.liveLook(st, now), orb = st.screens.find((s) => s.screen === "orb");
  const playing = orb ? screenAt(orb, new Map(st.channels.map((c) => [c.name, c])), timedOf(st.clips), now, st.night) : null;
  const next = mod.nextWords(st, now);
  let html = `<b>${esc(mod.lookWords(st, look))}</b>`;
  if (playing) {
    const p = progressOf(playing, timedOf(st.clips), now);
    html += ` <span class="dim">${lengthText(p.at)} of ${lengthText(p.of)}</span><div class="time"><i style="width:${(p.share * 100).toFixed(1)}%"></i></div>`;
  } else if (orb?.night && !st.night) html += ` <span class="dim">Clips wait for night here; the scenes run by day.</span>`;
  if (next) html += `<span class="dim">Next: ${esc(next)}</span>`;
  paint($("live-line"), html);
  const hour = st.world.hour, h = Math.floor(hour), m = Math.floor((hour - h) * 60);
  $("clock").textContent = `It is ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} in the world, ${st.night ? "night" : "day"}.`;
}

function tileHtml(t: Tile, liveNow: string): string {
  const on = t.key === liveNow, picked = S.picked && mod?.targetKey(S.picked) === t.key;
  const art = stage ? `<canvas data-thumb="${esc(t.key)}"></canvas>` : t.clip ? `<img src="${esc(t.clip.poster)}" alt="" loading="lazy">` : `<span class="art"></span>`;
  return `<button class="tile${on ? " live" : ""}${picked ? " picked" : ""}" data-pick="${esc(t.key)}" title="Click to preview; double-click to go live">
    ${art}${on ? `<span class="tag on-air">Live</span>` : ""}<span class="t-title">${esc(t.title)}</span><span class="t-note">${esc(t.note)}</span></button>`;
}

function drawTiles(): void {
  const st = S.state;
  if (!st || !mod) return;
  tiles = new Map(mod.stageTiles(st).map((t) => [t.key, t]));
  const now = mod.liveKey(st, wall()), all = [...tiles.values()];
  const scenes = all.filter((t) => t.group === "scenes"), channels = all.filter((t) => t.group === "channels");
  paint($("tiles-scenes"), scenes.map((t) => tileHtml(t, now)).join(""));
  paint($("tiles-channels"), channels.length ? channels.map((t) => tileHtml(t, now)).join("") : `<p class="dim">No channel has clips yet.</p>`);
  drawClips(now);
}

function drawViews(): void {
  if (!mod) return;
  paint($("views"), mod.STAGE_VIEWS.map((v, i) => `<button data-do="view" data-at="${i}" class="${i === S.view ? "on" : ""}" aria-pressed="${i === S.view}">${esc(v.label)}</button>`).join(""));
}

// ---- The clips' table.

function clipRow(c: StateClip, liveNow: string): string {
  const key = `clip:${c.id}`, on = key === liveNow, picked = S.picked && mod?.targetKey(S.picked) === key;
  const inChannels = S.state!.channels.filter((ch) => ch.items.includes(c.id)).map((ch) => ch.name);
  const badges = [on ? `<span class="tag on-air">Live</span>` : "", c.starter ? `<span class="chip">Starter</span>` : "", c.hidden ? `<span class="chip">Hidden</span>` : "", c.audio ? `<span class="chip">Sound</span>` : ""].join("");
  const art = stage ? `<canvas data-thumb="${key}"></canvas>` : `<img src="${esc(c.poster)}" alt="" loading="lazy">`;
  const actions = S.renaming === c.id
    ? `<label class="dim">Title <input id="rename-title" maxlength="80" value="${esc(c.title)}"></label>
       <label class="dim">Source <input id="rename-rights" maxlength="240" value="${esc(c.rights)}"></label>
       <div class="row"><button class="primary" data-do="rename-save" data-clip="${c.id}">Save</button><button data-do="rename-cancel">Cancel</button></div>`
    : `<div class="row"><button data-do="go" data-clip="${c.id}"${c.hidden || on ? " disabled" : ""}>Go live</button>
       ${c.starter ? `<button data-do="${c.hidden ? "unhide" : "hide"}" data-clip="${c.id}">${c.hidden ? "Unhide" : "Hide"}</button>`
         : `<button data-do="rename" data-clip="${c.id}">Rename</button><button class="risk" data-do="delete" data-clip="${c.id}">Delete</button>`}</div>`;
  return `<tr class="${on ? "live" : ""}${picked ? " picked" : ""}${c.hidden ? " hidden-clip" : ""}" data-pick="${key}">
    <td class="art">${art}</td>
    <td><b>${esc(c.title)}</b> ${badges}<div class="rights">${esc(c.rights)}</div>${inChannels.length ? `<div class="faint">In ${esc(inChannels.join(", "))}</div>` : ""}</td>
    <td>${lengthText(c.seconds)}</td><td>${(c.bytes / 1048576).toFixed(1)} MB<div class="faint">${c.width}×${c.height}</div></td>
    <td>${c.kbps} kbit/s<div class="faint">${c.kBps} KB/s a player</div></td><td>${c.starter ? "Starter" : "Uploaded"}</td><td class="acts">${actions}</td></tr>`;
}

function drawClips(liveNow = mod && S.state ? mod.liveKey(S.state, wall()) : ""): void {
  const st = S.state;
  if (!st) return;
  const hidden = $<HTMLInputElement>("show-hidden").checked, all = hidden ? st.clips : st.clips.filter((c) => !c.hidden);
  const rows = sortClips(findClips(all, S.query), S.sort, S.down, st.clips);
  const html = rows.length ? rows.map((c) => clipRow(c, liveNow)).join("") : `<tr><td colspan="7" class="dim">${st.clips.length ? "No clip has those words." : "The library is empty."}</td></tr>`;
  paint($("clips"), html);
  const shownHidden = st.clips.filter((c) => c.hidden).length;
  $("clips-count").textContent = `${rows.length} of ${st.clips.length} clips${shownHidden && !hidden ? `, ${shownHidden} hidden` : ""}. Click a row to preview it; Go live plays it once, then the ball goes back.`;
  for (const b of document.querySelectorAll<HTMLButtonElement>("th button[data-sort]")) {
    const on = b.dataset.sort === S.sort;
    b.classList.toggle("on", on);
    b.closest("th")!.setAttribute("aria-sort", on ? (S.down ? "descending" : "ascending") : "none");
    b.textContent = b.textContent!.replace(/ [↑↓]$/, "") + (on ? (S.down ? " ↓" : " ↑") : "");
  }
  wantThumbs();
}

// ---- How clips sit on the ball.

function knobsHtml(): string {
  const st = S.state!, s = st.screens.find((x) => x.screen === "orb");
  if (!s) return "";
  const pick = (field: string, value: string, label: string, on: boolean) =>
    `<button data-do="screen" data-screen="orb" data-field="${field}" data-value="${value}" class="${on ? "on" : ""}" aria-pressed="${on}">${label}</button>`;
  return `<span>Turned</span><div class="row">${pick("mode", "facing", "To face each player", s.mode === "facing")}${pick("mode", "fixed", "Fixed to the ball", s.mode === "fixed")}</div>
    <span>Size</span><div class="row">${pick("fill", "true", "Fill the ball", s.fill)}${pick("fill", "false", "Whole picture, with a glow round it", !s.fill)}</div>
    <span>Sound</span><label><input type="checkbox" data-do="flag" data-screen="orb" data-field="sound"${s.sound ? " checked" : ""}> Play the clip's sound near the ball</label>
    <span>When</span><label><input type="checkbox" data-do="flag" data-screen="orb" data-field="night"${s.night ? " checked" : ""}> Clips only by night; the scenes run by day</label>`;
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

/** What plays now on the ball and on each saved channel; run each second between reads. */
function drawNow(): void {
  const st = S.state;
  if (!st) return;
  drawLiveLine();
  drawPicked();
  // What is live moves on as clips end, so the tiles and the rows marked live follow it.
  const now = mod ? mod.liveKey(st, wall()) : "";
  if (now !== liveShown) {
    liveShown = now;
    drawTiles();
  }
  const timed = timedOf(st.clips), channels = new Map(st.channels.map((c) => [c.name, c])), at = wall();
  for (const el of document.querySelectorAll<HTMLElement>("[data-now-channel]")) {
    const c = channels.get(el.dataset.nowChannel!);
    const playing = c ? channelAt(c, timed, at) : null;
    paint(el, !c ? "Not saved yet." : !playing ? "Nothing it lists can play." : `Now ${esc(titleText(playing.clip))} (${lengthText(progressOf(playing, timed, at).at)} in), next ${esc(titleText(playing.next))}.`);
  }
}
let liveShown = "";

function draw(): void {
  const st = S.state;
  if (!st) return;
  $("cap-wide").textContent = String(st.caps.wide);
  $("cap-high").textContent = String(st.caps.high);
  // A picked clip or channel that is gone is let go.
  if (S.picked && mod && !mod.stageTiles(st).some((t) => t.key === mod!.targetKey(S.picked!))) S.picked = null;
  liveShown = mod ? mod.liveKey(st, wall()) : "";
  drawTiles();
  if (!mod) drawClips();
  paint($("knobs"), knobsHtml());
  paint($("waiting"), waitingHtml());
  paint($("channels"), channelsHtml());
  drawChannelBar();
  drawNow();
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

/** Takes `target` live on the ball. */
async function goLive(target: Target): Promise<void> {
  if (!mod) return;
  const tile = tiles.get(mod.targetKey(target));
  await edit(mod.takeBody(target), `${tile?.title ?? "It"} is live. Players see it within two seconds.`);
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
/** The target a tile or a row picks, by its key. */
const targetOf = (key: string): Target | null => tiles.get(key)?.target ?? (key.startsWith("clip:") ? { kind: "clip", clip: key.slice(5) } : null);

document.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const sort = el.closest<HTMLElement>("th button[data-sort]");
  if (sort) {
    const key = sort.dataset.sort as ClipSort;
    S.down = S.sort === key ? !S.down : key !== "title" && key !== "added";
    S.sort = key;
    return drawClips();
  }
  const b = el.closest<HTMLElement>("button[data-do]");
  if (!b) {
    // A tile or a row: picked for the preview, unless a field in it was clicked.
    const p = el.closest<HTMLElement>("[data-pick]");
    if (p && !el.closest("input,label")) {
      const t = targetOf(p.dataset.pick!);
      if (t) pickTarget(t);
    }
    return;
  }
  if (!S.state) return;
  const clip = b.dataset.clip ?? "", screen = b.dataset.screen ?? "", d = S.draft[num(b, "ch")];
  const act = (p: Promise<unknown>): void => void p.catch(failed);
  switch (b.dataset.do) {
    case "view":
      S.view = num(b, "at");
      return drawViews();
    case "screen":
      return act(edit({ op: "screen", screen, [b.dataset.field!]: b.dataset.field === "fill" ? b.dataset.value === "true" : b.dataset.value }));
    case "go":
      pickTarget({ kind: "clip", clip });
      return act(goLive({ kind: "clip", clip }));
    case "hide":
    case "unhide":
      return act(edit({ op: b.dataset.do, clip }, b.dataset.do === "hide" ? "Hidden: no screen plays it." : "Shown again."));
    case "delete":
      if (confirm(`Delete ${titleText(clip)}? Its file goes, and every channel loses it.`)) act(edit({ op: "delete", clip }, "Deleted."));
      return;
    case "rename":
      S.renaming = clip;
      return drawClips();
    case "rename-cancel":
      S.renaming = "";
      return drawClips();
    case "rename-save": {
      const title = $<HTMLInputElement>("rename-title").value, rights = $<HTMLInputElement>("rename-rights").value;
      return act(edit({ op: "rename", clip, title, rights }, "Renamed.").then((ok) => ok && ((S.renaming = ""), drawClips())));
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

document.addEventListener("dblclick", (e) => {
  const p = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
  if (!p || (e.target as HTMLElement).closest("button[data-do],input,label")) return;
  const t = targetOf(p.dataset.pick!);
  if (t) {
    pickTarget(t);
    void goLive(t).catch(failed);
  }
});

document.addEventListener("pointerover", (e) => {
  const c = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]")?.querySelector<HTMLCanvasElement>("canvas[data-thumb]");
  hovered = c?.dataset.thumb ?? "";
});

document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement & HTMLSelectElement;
  if (el.id === "show-hidden") return drawClips();
  if (!S.state || !el.dataset.do) return;
  const d = S.draft[num(el, "ch")];
  if (el.dataset.do === "flag") void edit({ op: "screen", screen: el.dataset.screen, [el.dataset.field!]: el.checked }).catch(failed);
  else if (el.dataset.do === "ch-name" && d) (d.name = el.value.replace(/\s+/g, " ").trim()), redrawDraft();
  else if (el.dataset.do === "ch-reset" && d) (d.reset = el.checked), redrawDraft();
});

$<HTMLInputElement>("find").oninput = () => {
  S.query = $<HTMLInputElement>("find").value;
  drawClips();
};
$("take").onclick = () => S.picked && void goLive(S.picked).catch(failed);

// Dragging a monitor walks round the ball.
for (const id of ["live", "preview"]) {
  const c = $<HTMLCanvasElement>(id);
  let from: number | null = null;
  c.onpointerdown = (e) => ((from = e.clientX), c.setPointerCapture(e.pointerId));
  c.onpointermove = (e) => {
    if (from === null) return;
    S.bearing -= ((e.clientX - from) / Math.max(1, c.clientWidth)) * Math.PI;
    from = e.clientX;
  };
  c.onpointerup = c.onpointercancel = () => (from = null);
}

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

void load().then(() => startStage());
// The library is read again every five seconds while the page is in view, and what plays is run on each second.
setInterval(() => !document.hidden && void load(), 5000);
setInterval(() => !document.hidden && drawNow(), 1000);
document.addEventListener("visibilitychange", () => !document.hidden && void load());
