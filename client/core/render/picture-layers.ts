// Pictures held as layers of one texture array on the card, for a use that shows many pictures of one size: the screens
// on props (video/faces.ts) and the prints on garments (prints.ts). Layers are handed out by key, the least lately used
// given up first, and never one a draw of this frame uses. Pictures are fetched and decoded off the frame by the page
// (a PictureHost), a few at once; each that comes waits its turn to go to the card. The card's side is
// client/shell/picture-array.ts.

/** The page's side: a picture from our own server, decoded away from the page's thread at `width` by `height`. */
export interface PictureHost<T> {
  image(path: string, width: number, height: number): Promise<T>;
  /** Stops fetching the picture at `path`, which is no longer wanted. */
  drop?(path: string): void;
}

/** The layers of a pictures' array: which picture each holds, by its key, and when it was last used. */
export class PictureLayers {
  size = 0;
  readonly keys: string[] = [];
  used = new Float64Array(0);
  /** 0 empty, 1 waiting for its picture, 2 holding it. */
  state = new Uint8Array(0);
  /** Since when a layer has waited, in ms, and the last of its levels that holds its picture. */
  since = new Float64Array(0);
  top = new Uint8Array(0);
  private readonly at = new Map<string, number>();
  /** How long a layer waiting for its picture is kept from another, in ms. */
  readonly waitMs: number;

  constructor(waitMs: number) {
    this.waitMs = waitMs;
  }

  /** `n` layers, every one empty. */
  resize(n: number): void {
    this.size = n;
    this.keys.length = 0;
    for (let k = 0; k < n; k++) this.keys.push("");
    this.used = new Float64Array(n).fill(-Infinity);
    this.state = new Uint8Array(n);
    this.since = new Float64Array(n);
    this.top = new Uint8Array(n);
    this.at.clear();
  }

  /** The layer that holds or waits for `key`, marked used on `frame`, or -1. */
  find(key: string, frame: number): number {
    const k = this.at.get(key);
    if (k === undefined) return -1;
    this.used[k] = frame;
    return k;
  }

  /** Whether layer `k` holds its picture. */
  holds(k: number): boolean {
    return k >= 0 && this.state[k] === 2;
  }

  /**
   * A layer for `key`, waiting for its picture: an empty one, else the one least lately used, not on `frame`, and not
   * waiting for a picture since less than `waitMs` before `now`. -1 where every layer is wanted.
   */
  take(key: string, frame: number, now: number): number {
    let best = -1;
    for (let k = 0; k < this.size; k++) {
      if (this.state[k] === 0) {
        best = k;
        break;
      }
      if (this.used[k]! >= frame || (this.state[k] === 1 && now - this.since[k]! < this.waitMs)) continue;
      if (best < 0 || this.used[k]! < this.used[best]!) best = k;
    }
    if (best < 0) return -1;
    if (this.keys[best]) this.at.delete(this.keys[best]!);
    this.keys[best] = key;
    this.at.set(key, best);
    this.used[best] = frame;
    this.state[best] = 1;
    this.since[best] = now;
    return best;
  }

  /** Layer `k` has its picture, put there this frame, in its levels to `top`. */
  filled(k: number, top: number): void {
    this.state[k] = 2;
    this.top[k] = top;
  }

  /** Layer `k` is let go, its picture having failed. */
  empty(k: number): void {
    if (this.keys[k]) this.at.delete(this.keys[k]!);
    this.keys[k] = "";
    this.state[k] = 0;
    this.used[k] = -Infinity;
  }
}

/** A picture asked of the page: its layer's key, its path and layer, since when it has been waited for, and a count of uses. */
interface Request {
  key: string;
  path: string;
  layer: number;
  since: number;
  token: number;
}

/** A picture come from the page, waiting for the card: its layer, its key and what the page made of it. */
export interface Came<T> {
  readonly layer: number;
  readonly key: string;
  readonly source: T;
}

/**
 * The pictures asked of the page for a set of layers: at most `loads` at once, each given up and its place freed when
 * it has not come in the layers' `waitMs` or no draw wants it any more. A picture that failed is not asked for again
 * for `failedMs`. Those that came wait in turn for the card, which takes as many a frame as its user allows.
 */
export class PictureLoads<T> {
  host: PictureHost<T> | null = null;
  readonly layers: PictureLayers;
  private readonly requests: Request[] = [];
  private readonly came: Came<T>[] = [];
  /** Files that failed, and the page's clock (ms) until which they are not asked for again. */
  private readonly failed = new Map<string, number>();
  private readonly failedMs: number;
  private now = 0;

  constructor(layers: PictureLayers, loads: number, failedMs: number) {
    this.layers = layers;
    this.failedMs = failedMs;
    for (let k = 0; k < loads; k++) this.requests.push({ key: "", path: "", layer: -1, since: 0, token: 0 });
  }

  /** Pictures waiting for the card. */
  get waiting(): number {
    return this.came.length;
  }

  /** Pictures being fetched. */
  get fetching(): number {
    let n = 0;
    for (const r of this.requests) if (r.key) n++;
    return n;
  }

  /** The layers were made again: nothing that came is for them. */
  clear(): void {
    this.came.length = 0;
  }

  /** What failed is asked for again. */
  forget(): void {
    this.failed.clear();
  }

  /** Whether `path` failed lately and is not asked for again yet. */
  dead(path: string): boolean {
    const until = this.failed.get(path);
    return until !== undefined && this.now < until;
  }

  /**
   * The layer holding the picture at `path` under `key`, marked used on `frame`; asked for, at `width` by `height`,
   * where none does and a request is free. -1 until it has come.
   */
  want(key: string, path: string, width: number, height: number, frame: number, now: number): number {
    this.now = now;
    const layers = this.layers;
    const k = layers.find(key, frame);
    if (k >= 0) return layers.holds(k) ? k : -1;
    const host = this.host, r = this.free();
    if (!host || !r || this.dead(path)) return -1;
    const layer = layers.take(key, frame, now);
    if (layer < 0) return -1;
    const token = ++r.token;
    r.key = key;
    r.path = path;
    r.layer = layer;
    r.since = now;
    host.image(path, width, height).then((source) => {
      if (r.token !== token || r.key !== key) return;
      r.key = "";
      this.came.push({ layer, key, source });
    }, () => {
      if (r.token !== token || r.key !== key) return;
      r.key = "";
      this.failed.set(path, this.now + this.failedMs);
      if (layers.keys[layer] === key) layers.empty(layer);
    });
    return -1;
  }

  /**
   * At the start of `frame`: lets go of the pictures asked for that no draw of the frame before wanted, whose layer has
   * gone to another, or that have not come in the layers' `waitMs`. Each frees its place, and the page stops fetching it.
   */
  sweep(frame: number, now: number): void {
    this.now = now;
    const layers = this.layers;
    for (const r of this.requests) {
      if (!r.key) continue;
      const mine = r.layer < layers.size && layers.keys[r.layer] === r.key;
      if (mine && layers.used[r.layer]! >= frame - 1 && now - r.since <= layers.waitMs) continue;
      if (mine) layers.empty(r.layer);
      this.host?.drop?.(r.path);
      r.key = "";
    }
  }

  /** The next picture that came for a layer still waiting for it, or null. */
  next(): Came<T> | null {
    while (this.came.length > 0) {
      const c = this.came.shift()!;
      if (this.layers.keys[c.layer] === c.key) return c;
    }
    return null;
  }

  private free(): Request | null {
    for (const r of this.requests) if (!r.key) return r;
    return null;
  }
}
