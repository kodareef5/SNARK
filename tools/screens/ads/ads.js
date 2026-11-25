// Shared helpers for the ad pages: the stage fitted to the window, ink filters, sunbursts, starbursts, halftoned
// creatures, sprites and paper. A page that moves defines frame(t), which draws the moment t seconds in.
// render.ts waits on window.adReady, then calls frame(t) for each picture it takes. Nothing runs on the wall clock.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const css = getComputedStyle(document.documentElement);
  /** An ink by name, or any CSS colour as it is. */
  const ink = (name) => (/^[a-z]+$/.test(name) && css.getPropertyValue(`--${name}`).trim()) || name;
  const rgb = (colour) => {
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = ink(colour);
    const hex = c.fillStyle;
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  };
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };

  const stage = document.querySelector(".ad");
  const W = Number(stage.dataset.w), H = Number(stage.dataset.h);
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  const fit = () => (stage.style.transform = `scale(${window.innerWidth / W})`);
  fit();
  window.addEventListener("resize", fit);

  // The filters live in one hidden svg.
  const defs = el("defs", {}, el("svg", { width: 0, height: 0, style: "position:absolute" }, document.body));
  // Shapes the pages share, used as <svg><use href="#man"/></svg>, drawn in currentColor.
  defs.innerHTML = `
    <symbol id="man" viewBox="0 0 100 200"><g fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
      <path d="M50 62 V124 M50 74 L22 108 M50 74 L80 50 M50 124 L32 188 M50 124 L68 188"/></g><circle cx="50" cy="32" r="21" fill="currentColor"/></symbol>
    <symbol id="run" viewBox="0 0 100 200"><g fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
      <path d="M56 62 L46 122 M54 76 L24 92 L12 72 M54 76 L80 100 L94 86 M46 122 L22 150 L10 186 M46 122 L76 152 L72 190"/></g><circle cx="60" cy="32" r="21" fill="currentColor"/></symbol>
    <symbol id="fall" viewBox="0 0 100 200"><g fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
      <path d="M50 70 V128 M50 80 L16 52 M50 80 L86 50 M50 128 L24 170 M50 128 L80 160"/></g><circle cx="50" cy="40" r="21" fill="currentColor"/></symbol>
    <symbol id="pitchman" viewBox="0 0 300 400">
      <path d="M40 400 Q40 290 150 280 Q260 290 260 400 Z" fill="#2a8c8a" stroke="#2b211d" stroke-width="5"/>
      <path d="M128 282 L150 336 L172 282 Z" fill="#fbf6e8"/>
      <path d="M130 294 L150 304 L170 294 L170 316 L150 306 L130 316 Z" fill="#e0482e"/>
      <rect x="122" y="230" width="56" height="56" fill="#f3a797"/>
      <ellipse cx="150" cy="176" rx="76" ry="84" fill="#f3a797" stroke="#2b211d" stroke-width="5"/>
      <path d="M58 112 Q150 132 242 112 L230 96 Q150 112 70 96 Z" fill="#2b211d"/>
      <path d="M82 100 Q86 40 150 38 Q214 40 218 100 Z" fill="#213a5a" stroke="#2b211d" stroke-width="5"/>
      <rect x="84" y="82" width="132" height="14" fill="#eab13a"/>
      <circle cx="124" cy="168" r="8" fill="#2b211d"/><circle cx="178" cy="168" r="8" fill="#2b211d"/>
      <path d="M110 150 q14 -10 28 0 M164 150 q14 -10 28 0" stroke="#2b211d" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M106 204 Q150 254 196 204 Q150 222 106 204 Z" fill="#fbf6e8" stroke="#2b211d" stroke-width="5" stroke-linejoin="round"/>
      <path d="M236 304 q24 -60 8 -96 q-4 -14 10 -12 q14 4 10 40 h22 q14 0 12 14 l-6 40 q-4 18 -24 18 z" fill="#f3a797" stroke="#2b211d" stroke-width="5"/></symbol>
    <symbol id="fin" viewBox="0 0 200 120"><path d="M10 118 C60 110 92 60 104 4 C128 50 150 96 196 118 Z" fill="currentColor"/></symbol>`;
  const filters = new Map();
  /** A filter that maps lightness to `inks`, darkest first, in flat bands; `gain` steepens the tones first. */
  function inkFilter(inks, gain = 1.25, lift = 0) {
    const key = `${inks.join(",")}|${gain}|${lift}`;
    if (filters.has(key)) return filters.get(key);
    const id = `inks${filters.size}`;
    const f = el("filter", { id, "color-interpolation-filters": "sRGB" }, defs);
    el("feColorMatrix", { type: "matrix", values: "0.30 0.59 0.11 0 0  0.30 0.59 0.11 0 0  0.30 0.59 0.11 0 0  0 0 0 1 0" }, f);
    const tone = el("feComponentTransfer", {}, f);
    for (const ch of ["R", "G", "B"]) el(`feFunc${ch}`, { type: "linear", slope: gain, intercept: lift - (gain - 1) / 2 }, tone);
    const map = el("feComponentTransfer", {}, f);
    const cols = inks.map(rgb);
    ["R", "G", "B"].forEach((ch, k) => el(`feFunc${ch}`, { type: "discrete", tableValues: cols.map((c) => c[k].toFixed(3)).join(" ") }, map));
    filters.set(key, id);
    return id;
  }

  /** Wedges about (cx, cy) in two colours, turned `turn` degrees. */
  function rays(svg, turn = 0) {
    const [n, cx, cy, a, b] = svg.dataset.rays.split(" ");
    svg.innerHTML = "";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    el("rect", { x: 0, y: 0, width: W, height: H, fill: ink(b) }, svg);
    const count = Number(n), r = 4 * Math.max(W, H);
    let d = "";
    for (let i = 0; i < count; i++) {
      const t0 = ((i / count) * 360 + turn) * (Math.PI / 180), t1 = (((i + 0.5) / count) * 360 + turn) * (Math.PI / 180);
      d += `M${cx},${cy}L${+cx + r * Math.cos(t0)},${+cy + r * Math.sin(t0)}L${+cx + r * Math.cos(t1)},${+cy + r * Math.sin(t1)}Z`;
    }
    el("path", { d, fill: ink(a) }, svg);
  }

  /** A star's outline as a CSS polygon: `n` points, the inner radius a share of the outer, turned `turn` degrees. */
  function starClip(n, inner, turn = 0) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? inner : 1;
      const a = (i / (n * 2)) * 2 * Math.PI + (turn * Math.PI) / 180 - Math.PI / 2;
      pts.push(`${(50 + 50 * r * Math.cos(a)).toFixed(2)}% ${(50 + 50 * r * Math.sin(a)).toFixed(2)}%`);
    }
    return `polygon(${pts.join(",")})`;
  }

  const load = (src) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => img.decode().then(() => ok(img), () => ok(img));
    img.onerror = () => fail(new Error(`no image ${src}`));
    img.src = src;
  });

  /** Halftone dots over a cutout's darker tones, drawn into a canvas the cutout's size. */
  function halftone(img, w, h, step, colour, angle = 45) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    // Where the picture is, at the size it is shown.
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale, dx = (w - dw) / 2, dy = (h - dh) / 2;
    g.drawImage(img, dx, dy, dw, dh);
    const px = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h);
    g.fillStyle = ink(colour);
    const a = (angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const reach = Math.hypot(w, h);
    for (let v = -reach; v < reach; v += step) {
      for (let u = -reach; u < reach; u += step) {
        const x = w / 2 + u * ca - v * sa, y = h / 2 + u * sa + v * ca;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (Math.floor(y) * w + Math.floor(x)) * 4;
        if (px[i + 3] < 128) continue;
        const lum = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
        const dark = Math.min(1, Math.max(0, (0.78 - lum) / 0.62));
        if (dark < 0.04) continue;
        g.beginPath();
        g.arc(x, y, step * 0.62 * Math.sqrt(dark), 0, 2 * Math.PI);
        g.fill();
      }
    }
    return c;
  }

  /** Builds a cutout creature: its picture in the page's inks, halftoned, and printed off register if asked. */
  async function dino(box) {
    const img = await load(box.dataset.src);
    const inks = (box.dataset.inks ?? "ink brick mustard cream").split(" ");
    const w = box.offsetWidth, h = box.offsetHeight;
    const shown = document.createElement("img");
    shown.src = img.src;
    shown.style.filter = `url(#${inkFilter(inks, Number(box.dataset.gain ?? 1.25), Number(box.dataset.lift ?? 0))})`;
    if (box.dataset.flip !== undefined) box.style.transform = `${box.style.transform} scaleX(-1)`;
    box.appendChild(shown);
    if (box.dataset.dots !== "none") {
      const dots = halftone(img, w, h, Number(box.dataset.dotSize ?? 5), box.dataset.dots ?? inks[0]);
      dots.style.cssText = `position:absolute;inset:0;mix-blend-mode:multiply;opacity:${box.dataset.dotAlpha ?? 0.55}`;
      box.appendChild(dots);
    }
  }

  /** Every frame of a sprite stacked; Ad.sprite shows one. */
  async function sprite(box) {
    const count = Number(box.dataset.count);
    const inks = (box.dataset.inks ?? "ink brick mustard cream").split(" ");
    const filter = `url(#${inkFilter(inks, Number(box.dataset.gain ?? 1.25), Number(box.dataset.lift ?? 0))})`;
    for (let i = 0; i < count; i++) {
      const img = await load(box.dataset.frames.replace("%02d", String(i).padStart(2, "0")));
      img.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:${filter};visibility:${i ? "hidden" : "visible"}`;
      box.appendChild(img);
    }
  }

  /** Paper fibre and mottled ink over the stage. */
  function paper() {
    const svg = el("svg", { class: "grain", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" }, stage);
    const f = el("filter", { id: "fibre", x: 0, y: 0, width: "100%", height: "100%" }, el("defs", {}, svg));
    el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.85", numOctaves: 2, seed: 7 }, f);
    el("feColorMatrix", { type: "matrix", values: "0 0 0 0 0.55  0 0 0 0 0.47  0 0 0 0 0.36  0 0 0 -1.4 0.9" }, f);
    el("rect", { width: W, height: H, filter: "url(#fibre)" }, svg);
    const wear = el("svg", { class: "wear", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" }, stage);
    const m = el("filter", { id: "mottle", x: 0, y: 0, width: "100%", height: "100%" }, el("defs", {}, wear));
    el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.035 0.05", numOctaves: 4, seed: 3 }, m);
    el("feColorMatrix", { type: "matrix", values: "0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.9  2.4 0 0 0 -1.25" }, m);
    el("rect", { width: W, height: H, filter: "url(#mottle)" }, wear);
  }

  /** The faces ads.css names that did not load: a page drawn without one would use a fallback. */
  async function missingFonts() {
    const faces = [...document.fonts].filter((f) => f.family.replace(/"/g, "").startsWith("Ad"));
    await Promise.all(faces.map((f) => f.load().catch(() => {})));
    return faces.filter((f) => f.status !== "loaded").map((f) => `${f.family} ${f.weight} ${f.style}`);
  }

  window.Ad = {
    W, H, ink, rays, starClip, inkFilter,
    /** t wrapped into [0, period). */
    wrap: (t, period) => ((t % period) + period) % period,
    /** 0 to 1 as t goes from a to b, eased in and out, held outside. */
    ease: (t, a, b) => {
      const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
      return x * x * (3 - 2 * x);
    },
    /** 1 between a and b, faded in and out over `fade` seconds at each end; 0 outside. */
    during: (t, a, b, fade = 0.3) => Ad.ease(t, a, a + fade) * (1 - Ad.ease(t, b - fade, b)),
    /** On for `duty` of each of `hz` cycles a second. */
    blink: (t, hz, duty = 0.5, phase = 0) => ((((t * hz + phase) % 1) + 1) % 1) < duty,
    /** Shows a sprite's frame for time t at `fps`. */
    sprite: (box, t, fps) => {
      const imgs = box.querySelectorAll("img");
      const k = Math.floor(t * fps) % imgs.length;
      imgs.forEach((img, i) => (img.style.visibility = i === k ? "visible" : "hidden"));
    },
  };

  window.adReady = (async () => {
    const missing = await missingFonts();
    if (missing.length) throw new Error(`fonts missing: ${missing.join(", ")}`);
    document.querySelectorAll("svg[data-rays]").forEach((svg) => rays(svg, Number(svg.dataset.turn ?? 0)));
    document.querySelectorAll("[data-star]").forEach((s) => {
      const [n, inner, turn] = s.dataset.star.split(" ").map(Number);
      s.style.clipPath = starClip(n, inner, turn || 0);
    });
    for (const box of document.querySelectorAll(".dino[data-src]")) await dino(box);
    for (const box of document.querySelectorAll(".sprite[data-frames]")) await sprite(box);
    await Promise.all([...document.images].map((img) => (img.complete ? img.decode().catch(() => {}) : load(img.src))));
    if (stage.dataset.clean === undefined) paper();
    if (typeof window.frame === "function") window.frame(Number(new URLSearchParams(location.search).get("t") ?? 0));
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    return true;
  })();
})();
