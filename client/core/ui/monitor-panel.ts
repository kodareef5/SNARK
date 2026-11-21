// The resource monitor's panel (ui/monitor.ts opens it): a glass field on the left with the world in view beside it,
// or by touch a page of its own, with three tabs. Now: the rates and what they come to this visit, what waits, the
// frame's times and the disk. Chart: the last minute, a column a second, stacked network, disk and to-card bytes, a
// mark under each column with a frame over 50 ms; a column chosen (by a press, or ‹ › from column to column) says what
// its second held and what arrived in it, from the record of requests (assets/requests.ts), a page at a time. Assets:
// what is downloading now, and what came most recently. Freeze holds the chart still; the record goes on behind it. Its words are made with the strip's,
// ten times a second at most, and the panel is drawn from them.

import { ARRIVED, LOADING } from "../assets/copied.ts";
import { IS_ASKED, LOG_ROWS, requestFrom, requestName, requestTime } from "../assets/requests.ts";
import { slotName } from "../assets/look.ts";
import { AXIS_H, CHART_SECONDS, SERIES, SERIES_NAMES, SERIES_TINT, SLOW_TINT, buildAxis, buildChart, chartBox, columnAt, type ChartBox } from "./monitor-chart.ts";
import type { MonitorKit } from "./monitor-kit.ts";
import type { Monitor } from "./monitor.ts";
import { K_BAR, K_PANEL, LINE, S_HUD_COUNT, S_ICE, S_LABEL, S_MENU, S_MENU_HEADING, S_MENU_NOTE, S_TEXT, S_UNMUTE, SMALL_LINE } from "./monitor-style.ts";
import type { UiFrame } from "./nodes.ts";
import type { TouchPlan } from "./touch.ts";

/** The panel's keys: its glass, title, Freeze and Close, the line under the tabs, the tabs, then each tab's. */
export const KEY_PANEL = 8100;
const KEY_TITLE = KEY_PANEL + 1;
export const KEY_FREEZE = KEY_PANEL + 2, KEY_CLOSE = KEY_PANEL + 3;
const KEY_LINE = KEY_PANEL + 4;
export const KEY_TAB = KEY_PANEL + 10;
const KEY_NOW = KEY_PANEL + 20;
/** The chart and its button (its key + 1), its axis, legend and caption, and the ‹ › that step from column to column. */
export const KEY_CHART = 8200;
export const KEY_CHART_PICK = KEY_CHART + 1;
const KEY_AXIS = KEY_CHART + 250, KEY_LEGEND = KEY_CHART + 260, KEY_CAPTION = KEY_CHART + 270;
export const KEY_COLUMN_BACK = KEY_CHART + 271, KEY_COLUMN_ON = KEY_CHART + 272;
/** A list's rows, four keys each, and its page controls. */
const KEY_ROWS = 8480;
export const KEY_PAGE_BACK = 8650, KEY_PAGE_ON = 8651;
const KEY_PAGE_TEXT = 8652;

export const TABS = ["Now", "Chart", "Assets"];
/** The field's widest on a desktop, as the Creative screen's is. */
export const PANEL_W = 440;
/** How far above the canvas's foot the field stops: the hotbar, the line over it that says what is loaded, and a gap. */
export const PANEL_FOOT = 96;
const PAD = 24;
/** The chart's well, on a desktop and by touch. */
const CHART_H = 150, TOUCH_CHART_H = 120;
/** A row of the Now tab and its parts; its meter is where a painted meter rail will stand, METER_MIN across at least, or none. */
const ROW = 26, METER_H = 6, METER_MIN = 40, LABEL_W = 60, RATE_W = 74, TOTAL_W = 150;
/** A row of a list, and the widths of its columns but the name's. */
const LIST_ROW = LINE + 2, SIZE_W = 64, FROM_W = 96, TIME_W = 52;
/** A button a finger presses. */
const FINGER = 44;
/** The requests the Assets tab lists that came most recently. */
const RECENT = 60;

/** What the panel shows, made at the monitor's refresh. */
export class PanelWords {
  /** Now: each rate's value, its share of the chart's top, and what it comes to; then lines. */
  readonly rate = ["", "", "", ""];
  readonly share = new Float32Array(4);
  readonly total = ["", "", "", ""];
  readonly lines: string[] = [];
  /** Chart and Assets: the list's rows (a row with no size is a heading), its pages, and the chart's caption. */
  readonly name: string[] = [];
  readonly size: string[] = [];
  readonly from: string[] = [];
  readonly time: string[] = [];
  pages = 1;
  caption = "";
  /** The rows a page has room for, the field's inner width, and where the chart stands, as the panel was last laid out. */
  perPage = 8;
  inner = PANEL_W - PAD * 2;
  readonly box: ChartBox = { x: 0, y: 0, w: 0, h: 0, column: 1 };
}

const RATE_NAMES = ["Network", "Disk", "Memory", "To card"];
/** The strip's sums are network, disk, to the card and memory; the panel's rows are network, disk, memory and to the card. */
const ROW_SUM = [0, 1, 3, 2];
const MB = 1048576;
export const mb = (bytes: number): string => (bytes >= 100 * MB ? `${Math.round(bytes / MB)} MB` : `${(bytes / MB).toFixed(1)} MB`);
const rate = (bytes: number): string => (bytes >= 1000 * 1024 ? `${(bytes / MB).toFixed(1)} MB/s` : `${Math.round(bytes / 1024)} KB/s`);
export const size = (bytes: number): string => (bytes >= 1000 * 1024 ? mb(bytes) : `${Math.max(1, Math.round(bytes / 1024))} KB`);
export const seconds = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** The panel's words, as they stand at `nowMs`. */
export function panelWords(m: Monitor, nowMs: number, touch: boolean): void {
  const w = m.words, app = m.app, r = app.scene?.assets.residency ?? null, kit = m.kit, ring = app.frames;
  const s = m.sums, scale = m.live.scale;
  for (let i = 0; i < 4; i++) {
    w.rate[i] = rate(s[ROW_SUM[i]!]!);
    w.share[i] = Math.min(1, s[ROW_SUM[i]!]! / scale);
  }
  const st = r?.stats, sound = app.sounds?.library.stats;
  w.total[0] = st ? `${mb(st.fetched + st.stale + (sound ? sound.fetched + sound.stale : 0))} this visit` : "";
  w.total[1] = st ? `${mb(st.disk + (sound?.disk ?? 0))} read` : "";
  w.total[2] = st ? `${mb(st.memory + (sound ? sound.cached - sound.disk : 0))} again` : "";
  w.total[3] = r ? `${Math.round(r.ledger / MB)} of ${Math.round((Number.isFinite(r.budget) ? r.budget : r.ledger) / MB)} MB on card` : "";
  const lines = w.lines, inner = w.inner;
  lines.length = 0;
  const say = (text: string): void => kit.wrapText(text, inner, S_MENU_NOTE, lines);
  if (r && st) {
    let arrived = 0;
    for (const slot of r["under"]) if (r["state"][slot] === ARRIVED) arrived++;
    say(`${r.flying + (app.sounds?.library.flying ?? 0)} downloading · ${r.wanting()} asked · ${arrived} waiting for the card · ${st.failed + st.dead} failed`);
  }
  const latest = ring ? ring.row(0) : -1;
  if (ring && latest >= 0) {
    let worst = 0, sum = 0, n = 0;
    for (let back = 0; ; back++) {
      const k = ring.row(back);
      if (k < 0 || ring.at[k]! <= ring.at[latest]! - 1000) break;
      sum += ring.interval[k]!;
      n++;
      if (ring.interval[k]! > worst) worst = ring.interval[k]!;
    }
    if (n > 0 && sum > 0) say(`${Math.round((1000 * n) / sum)} frames a second, ${(sum / n).toFixed(1)} ms each, the slowest ${Math.round(worst)} ms`);
    say(`The last frame took ${ring.ours[latest]!.toFixed(1)} ms of ours, ${ring.uploadMs[latest]!.toFixed(1)} ms of it handing bytes to the card`);
  }
  if (app.scene) {
    const tier = app.scene.assets.tier;
    say(`Graphics ${tier.name}: ${tier.texture > 0 ? `textures up to ${tier.texture} px` : "no textures"}, at most ${mb(tier.uploadBytes)} to the card a frame`);
  }
  const cache = r?.cache ?? null;
  if (cache) say(cache.mode === "disk" ? `Saved on this device: ${mb(cache.used)} of ${mb(cache.limit)}` : cache.mode === "memory" ? "Not saving files on this device: they download again each visit" : "Every file is in the page itself");
  if (st) say(`Asked ${st.requests} times: ${st.failed} failed and were asked again, ${st.dead} given up, ${st.cancelled} no longer wanted`);
  if (m.frozen) say("The chart is held still.");

  // The chart's caption, and the Assets tab's list of what is downloading now.
  w.name.length = w.size.length = w.from.length = w.time.length = 0;
  w.caption = "";
  if (m.tab === 1) {
    const chart = m.chart, col = m.column;
    if (col < 0) w.caption = touch ? "Tap a second to see what it held" : "Choose a second to see what it held";
    else {
      const back = CHART_SECONDS - 1 - col, slow = chart.slow[col]!, worst = Math.round(chart.worst[col]!);
      let bytes = 0;
      for (let k = 0; k < SERIES; k++) bytes += chart.bytes[col * SERIES + k]!;
      const second = chart.second[col]!;
      w.caption = `${back === 0 ? "This second" : `${back} s ago`}: ${second < 0 ? "not kept" : `${slow === 0 ? "no slow frame" : slow === 1 ? `one ${worst} ms frame` : `${slow} slow frames, the longest ${worst} ms`} · ${mb(bytes)}`}`;
      // What arrived in that second, as the record of requests has it, the first first.
      const log = m.log;
      if (log && r && second >= 0) {
        for (let back = Math.min(log.rows, LOG_ROWS) - 1; back >= 0; back--) {
          const k = log.row(back);
          if (Math.floor(log.arrivedAt[k]! / 1000) !== second) continue;
          row(w, kit.fitText(requestName(r, log, k), nameWidth(w), S_MENU_NOTE), log.bytes[k]!, requestFrom(log, k), requestTime(log, k, nowMs));
        }
        if (w.name.length === 0) heading(w, "Nothing the record holds arrived in it");
      }
    }
  } else if (m.tab === 2 && r) {
    // What is downloading now, the longest under way first, then what came most recently.
    const under = r["under"], log = m.log;
    let flying = 0;
    for (const slot of under) if (r["state"][slot] === LOADING) flying++;
    heading(w, flying === 0 ? "Nothing downloading now" : `Downloading now: ${flying}`);
    for (const slot of under) {
      if (r["state"][slot] !== LOADING) continue;
      const t = slot - r["texBase"], k = log ? log.rowFor(slot) : -1;
      row(w, kit.fitText(slotName(r, slot, slot >= r["texBase"] && slot < r["clipBase"] ? r["goal"][t]! : 0), nameWidth(w), S_MENU_NOTE), r["asked"](slot), "", k >= 0 ? `for ${seconds(nowMs - log!.askedAt[k]!)}` : "");
    }
    if (log) {
      heading(w, "Came most recently");
      for (let back = 0, n = 0; back < Math.min(log.rows, LOG_ROWS) && n < RECENT; back++) {
        const k = log.row(back);
        if (log.state[k] === IS_ASKED) continue;
        row(w, kit.fitText(requestName(r, log, k), nameWidth(w), S_MENU_NOTE), log.bytes[k]!, requestFrom(log, k), requestTime(log, k, nowMs));
        n++;
      }
    }
  }
  w.pages = Math.max(1, Math.ceil(w.name.length / w.perPage));
  m.page = Math.max(0, Math.min(w.pages - 1, m.page));
}

export const nameWidth = (w: PanelWords): number => w.inner - SIZE_W - FROM_W - TIME_W - 12;

export function row(w: PanelWords, name: string, bytes: number, from: string, time: string): void {
  w.name.push(name);
  w.size.push(size(bytes));
  w.from.push(from);
  w.time.push(time);
}

export function heading(w: PanelWords, text: string): void {
  w.name.push(text);
  w.size.push("");
  w.from.push("");
  w.time.push("");
}

/**
 * The panel's field: its left edge, top, width and height. On a desktop it stands under the compass (`below`, where
 * its degrees end) and, while the sound is muted, under the offer to unmute where the two would meet (ui/menu.ts
 * unmuteButton). By touch it is a page across the canvas, under the touch layer's Close in the top right, or under the
 * offer to unmute, which stands under the bar.
 */
export function panelField(f: UiFrame, kit: MonitorKit, plan: TouchPlan | null, below: number, muted: boolean, out: { x: number; y: number; w: number; h: number }): void {
  const touch = plan !== null;
  out.x = f.left + (touch ? 12 : Math.round(Math.max(24, f.width * 0.065)));
  // On a desktop left of the vitals' column, which stands at the right. By touch across the canvas, or where it is wide
  // left of the minimap, which the touch layer's Close stands over.
  const wide = f.width >= WIDE;
  out.w = touch ? f.width - f.right - 12 - (wide ? plan.map + 8 : 0) - out.x : Math.min(PANEL_W, f.width - out.x - f.right - VITALS_W);
  // By touch under the vitals, which stand at the top, and under the offer to unmute where it shows.
  out.y = touch ? (muted ? plan.stackY : plan.under) : f.top + 40;
  // Under what the HUD keeps at the top where the field would meet it: the compass and its degrees, the minimap, its
  // frame, clock and buttons.
  for (let i = 0; i < f.count; i++) {
    const n = f.nodes[i]!, k = n.key;
    const kept = (k >= KEY_COMPASS && k < KEY_COMPASS + 100) || (k >= KEY_MINIMAP_FRAME && k <= KEY_CLOCK) || (k >= 2000000 + KEY_MINIMAP_FRAME * 16 && k < 2000000 + KEY_MINIMAP_FRAME * 16 + 9) || (k >= KEY_MINIMAP_TOGGLE && k <= KEY_MINIMAP_TOGGLE + 2);
    if (kept && n.x < out.x + out.w && out.x < n.x + n.w) out.y = Math.max(out.y, n.y + n.h + 8);
  }
  if (!touch && muted) {
    const uw = Math.ceil(kit.textWidth(UNMUTE_TEXT, S_UNMUTE)) + 32, left = f.left + 12;
    const ux = Math.max(left, Math.min(Math.round((f.width - uw) / 2), f.width - f.right - 12 - MINIMAP_SIZE - 10 - uw)), uy = Math.max(f.top + 12, below);
    if (ux < out.x + out.w && out.x < ux + uw) out.y = Math.max(out.y, uy + 44 + 8);
  }
  out.h = f.height - f.bottom - PANEL_FOOT - out.y;
}
const at = { x: 0, y: 0, w: 0, h: 0 };
/** ui/menu.ts: the unmute offer's words, and ui/hud.ts: the minimap's side, which it keeps left of. */
const UNMUTE_TEXT = "Unmute sound", MINIMAP_SIZE = 160;
/** ui/hud.ts: the vitals' column at the right, its margin and a gap. */
const VITALS_W = 12 + 38 + 8;
/** By touch a canvas this wide has the page beside the minimap, a narrower one under it. */
const WIDE = 640;
/** The keys of what the HUD keeps at the top: ui/compass.ts's, and ui/hud.ts's minimap's frame, picture and clock, and its three buttons. */
export const KEY_COMPASS = 6600, KEY_MINIMAP_FRAME = 10, KEY_CLOCK = 12, KEY_MINIMAP_TOGGLE = 5390;

/** Lays the field out for this frame, and is true where its inner width changed, which its words are wrapped to. */
export function layPanel(m: Monitor, f: UiFrame, plan: TouchPlan | null, below: number, muted: boolean): boolean {
  panelField(f, m.kit, plan, below, muted, at);
  const inner = at.w - PAD * 2, changed = inner !== m.words.inner;
  m.words.inner = inner;
  return changed;
}

/** The panel, as `layPanel` laid it out. */
export function buildPanel(m: Monitor, f: UiFrame, touch: boolean): void {
  const kit = m.kit, w = m.words;
  const x = at.x, y = at.y, inner = w.inner, left = x + PAD, right = x + at.w - PAD, button = touch ? FINGER : 36;
  f.add(KEY_PANEL + 5, K_PANEL, x, y, at.w, at.h, S_MENU);
  kit.glass(f, KEY_PANEL, x, y, at.w, at.h);
  // By touch the touch layer's Close, over the page's top right, closes it.
  const buttons = touch ? 80 : 56 + 8 + 80;
  f.text(KEY_TITLE, left, y + 16 + (button - 33) / 2, inner - buttons - 8, S_MENU_HEADING, kit.fitText("Resource monitor", inner - buttons - 8, S_MENU_HEADING));
  if (!touch) kit.smallButton(f, KEY_CLOSE, right - 56, y + 16, 56, button, "Close", "Close the resource monitor");
  kit.smallButton(f, KEY_FREEZE, right - buttons, y + 16, 80, button, m.frozen ? "Resume" : "Freeze", m.frozen ? "Let the chart move again" : "Hold the chart still", m.frozen);
  const tabY = y + 16 + button + 12, tabW = Math.min(132, inner / TABS.length), tabH = touch ? FINGER : 34;
  for (let i = 0; i < TABS.length; i++) kit.smallButton(f, KEY_TAB + i, left + i * tabW, tabY, tabW - 8, tabH, TABS[i]!, TABS[i]!, m.tab === i);
  f.add(KEY_LINE, K_PANEL, left, tabY + tabH + 6, inner, 1, S_ICE).alpha = 0.18;
  const top = tabY + tabH + 20, bottom = y + at.h - 16;
  if (m.tab === 0) buildNow(m, f, left, top, inner, bottom);
  else if (m.tab === 1) {
    const ch = touch ? TOUCH_CHART_H : CHART_H;
    chartBox(left, top, inner, ch, w.box);
    buildChart(f, kit, KEY_CHART, w.box, m.chart, m.column, true);
    buildAxis(f, KEY_AXIS, w.box, m.chart);
    let ly = top + ch + AXIS_H + 6;
    // The legend: a swatch and a word for each series, and the slow frames' mark.
    const each = inner / (SERIES + 1);
    for (let s = 0; s <= SERIES; s++) {
      const sx = left + s * each;
      const sw = f.add(KEY_LEGEND + s * 2, K_PANEL, sx, ly + (s === SERIES ? 7 : 4), 8, s === SERIES ? 3 : 8, S_ICE);
      sw.tint = s === SERIES ? SLOW_TINT : SERIES_TINT[s]!;
      f.text(KEY_LEGEND + s * 2 + 1, sx + 12, ly, each - 14, S_LABEL, kit.fitText(s === SERIES ? "over 50 ms" : SERIES_NAMES[s]!, each - 14, S_LABEL));
    }
    ly += SMALL_LINE + 8;
    const step = touch ? FINGER : 30, bw = touch ? FINGER : 32;
    f.text(KEY_CAPTION, left, ly + (step - LINE) / 2, inner - bw * 2 - 12, S_TEXT, kit.fitText(w.caption, inner - bw * 2 - 12, S_TEXT));
    kit.smallButton(f, KEY_COLUMN_BACK, right - bw * 2 - 4, ly, bw, step, "‹", "The second before");
    kit.smallButton(f, KEY_COLUMN_ON, right - bw, ly, bw, step, "›", "The second after");
    buildList(m, f, left, ly + step + 8, inner, bottom, touch);
  } else buildList(m, f, left, top, inner, bottom, touch);
}

function buildNow(m: Monitor, f: UiFrame, left: number, top: number, inner: number, bottom: number): void {
  const w = m.words, kit = m.kit;
  const meter = inner - LABEL_W - RATE_W - TOTAL_W - 24;
  let y = top;
  for (let i = 0; i < 4; i++) {
    f.text(KEY_NOW + i * 4, left, y, LABEL_W, S_MENU_NOTE, RATE_NAMES[i]!);
    f.text(KEY_NOW + i * 4 + 1, left + LABEL_W, y, RATE_W, S_HUD_COUNT, w.rate[i]!);
    if (meter >= METER_MIN) f.add(KEY_NOW + i * 4 + 2, K_BAR, left + LABEL_W + RATE_W + 12, y + (LINE - METER_H) / 2, meter, METER_H, S_ICE).value = w.share[i]!;
    f.text(KEY_NOW + i * 4 + 3, left + inner - TOTAL_W, y, TOTAL_W, S_HUD_COUNT, kit.fitText(w.total[i]!, TOTAL_W, S_HUD_COUNT));
    y += ROW;
  }
  y += 6;
  for (let i = 0; i < w.lines.length && y + LINE <= bottom; i++) {
    f.text(KEY_NOW + 20 + i, left, y, inner, S_MENU_NOTE, w.lines[i]!);
    y += LINE + 2;
  }
}

function buildList(m: Monitor, f: UiFrame, left: number, top: number, inner: number, bottom: number, touch: boolean): void {
  const w = m.words, kit = m.kit, pageH = touch ? FINGER : 30;
  w.perPage = Math.max(1, Math.floor((bottom - top - pageH - 4) / LIST_ROW));
  const from = m.page * w.perPage, nameW = nameWidth(w);
  let y = top;
  for (let i = from; i < w.name.length && i < from + w.perPage; i++) {
    const k = KEY_ROWS + (i - from) * 4, head = w.size[i] === "";
    f.text(k, left, y, head ? inner : nameW, head ? S_LABEL : S_MENU_NOTE, w.name[i]!).alpha = head ? 0.85 : 1;
    if (!head) {
      f.text(k + 1, left + nameW + 4, y, SIZE_W, S_HUD_COUNT, w.size[i]!);
      f.text(k + 2, left + nameW + SIZE_W + 12, y, FROM_W, S_MENU_NOTE, kit.fitText(w.from[i]!, FROM_W, S_MENU_NOTE));
      f.text(k + 3, left + inner - TIME_W, y, TIME_W, S_HUD_COUNT, w.time[i]!);
    }
    y += LIST_ROW;
  }
  if (w.pages <= 1) return;
  const py = bottom - pageH, bw = touch ? FINGER : 32;
  kit.smallButton(f, KEY_PAGE_BACK, left + inner - bw * 2 - 64, py, bw, pageH, "‹", "Page back");
  f.text(KEY_PAGE_TEXT, left + inner - bw - 60, py + (pageH - SMALL_LINE) / 2, 56, S_HUD_COUNT, `${m.page + 1} / ${w.pages}`);
  kit.smallButton(f, KEY_PAGE_ON, left + inner - bw, py, bw, pageH, "›", "Page on");
}

/** A press of one of the panel's controls; false for any other key. */
export function panelClick(m: Monitor, key: number, x: number): boolean {
  if (key === KEY_CLOSE) m.open = false;
  else if (key === KEY_FREEZE) {
    if (!m.frozen) m.still.copy(m.live);
    m.frozen = !m.frozen;
  } else if (key >= KEY_TAB && key < KEY_TAB + TABS.length) {
    m.tab = key - KEY_TAB;
    m.page = 0;
  } else if (key === KEY_CHART_PICK) {
    m.column = columnAt(m.words.box, x);
    m.page = 0;
  } else if (key === KEY_COLUMN_BACK || key === KEY_COLUMN_ON) {
    m.column = m.column < 0 ? CHART_SECONDS - 1 : Math.max(0, Math.min(CHART_SECONDS - 1, m.column + (key === KEY_COLUMN_ON ? 1 : -1)));
    m.page = 0;
  } else if (key === KEY_PAGE_BACK || key === KEY_PAGE_ON) m.page = Math.max(0, Math.min(m.words.pages - 1, m.page + (key === KEY_PAGE_ON ? 1 : -1)));
  else return false;
  m.refreshNow();
  return true;
}
