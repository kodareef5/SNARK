// Bit-level wire codec, least-significant bit first. Neither side throws on bad data. The writer and the reader set `overflow`
// and carry on, the reader returning zeros. The caller checks the flag once at the end, so a hostile packet costs bounded work.

const F32 = new Float32Array(1);
const F32_BITS = new Uint32Array(F32.buffer);
const F64 = new Float64Array(1);
const F64_BITS = new Uint32Array(F64.buffer);

const TWO_32 = 4294967296;
/** The fewest bytes of a blob worth copying whole, where it lies on a byte boundary. */
const WHOLE = 8;

export class BitWriter {
  readonly buf: Uint8Array;
  /** In bits. */
  pos = 0;
  overflow = false;
  private readonly capBits: number;
  private dirtyBytes = 0;

  constructor(capacityBytes: number) {
    this.buf = new Uint8Array(capacityBytes);
    this.capBits = capacityBytes * 8;
  }

  reset(): void {
    this.buf.fill(0, 0, Math.max(this.dirtyBytes, this.byteLength));
    this.pos = 0;
    this.dirtyBytes = 0;
    this.overflow = false;
  }

  get byteLength(): number {
    return (this.pos + 7) >>> 3;
  }

  /** A view, valid until the next reset. */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.byteLength);
  }

  /** Writes the low `n` bits of `value`. 0 <= n <= 32. */
  bits(value: number, n: number): void {
    let p = this.pos;
    if (p + n > this.capBits) {
      this.overflow = true;
      return;
    }
    let v = value >>> 0;
    const buf = this.buf;
    while (n > 0) {
      const off = p & 7;
      const room = 8 - off;
      const take = room < n ? room : n;
      buf[p >>> 3]! |= (v & ((1 << take) - 1)) << off;
      v >>>= take;
      p += take;
      n -= take;
    }
    this.pos = p;
    const used = (p + 7) >>> 3;
    if (used > this.dirtyBytes) this.dirtyBytes = used;
  }

  /** Discards everything written after `pos`. */
  rewind(pos: number): void {
    const from = pos >>> 3;
    const to = this.byteLength;
    const keep = pos & 7;
    if (keep !== 0) {
      this.buf[from]! &= (1 << keep) - 1;
      this.buf.fill(0, from + 1, to);
    } else {
      this.buf.fill(0, from, to);
    }
    this.pos = pos;
  }

  bool(b: boolean): void {
    this.bits(b ? 1 : 0, 1);
  }

  u8(v: number): void {
    this.bits(v, 8);
  }

  u16(v: number): void {
    this.bits(v, 16);
  }

  u32(v: number): void {
    this.bits(v, 32);
  }

  /** Two's complement in `n` bits. */
  sbits(v: number, n: number): void {
    this.bits(v, n);
  }

  /** Unsigned 32-bit integer, 1 to 5 bytes. */
  varint(v: number): void {
    v >>>= 0;
    while (v >= 0x80) {
      this.bits((v & 0x7f) | 0x80, 8);
      v >>>= 7;
    }
    this.bits(v, 8);
  }

  /** Signed 32-bit integer, zig-zag encoded. */
  svarint(v: number): void {
    this.varint(((v << 1) ^ (v >> 31)) >>> 0);
  }

  /** Non-negative safe integer below 2^53 (persistent ids). */
  uint53(v: number): void {
    this.bits(v % TWO_32, 32);
    this.bits(Math.floor(v / TWO_32), 21);
  }

  f32(v: number): void {
    F32[0] = v;
    this.bits(F32_BITS[0]!, 32);
  }

  f64(v: number): void {
    F64[0] = v;
    this.bits(F64_BITS[0]!, 32);
    this.bits(F64_BITS[1]!, 32);
  }

  /** Raw bytes with a varint length prefix. */
  blob(src: Uint8Array): void {
    this.varint(src.length);
    const p = this.pos;
    const end = p + src.length * 8;
    // On a byte boundary, more than a few bytes that fit are copied whole.
    if ((p & 7) !== 0 || src.length < WHOLE || end > this.capBits) {
      for (let i = 0; i < src.length; i++) this.bits(src[i]!, 8);
      return;
    }
    this.buf.set(src, p >>> 3);
    this.pos = end;
    if (end >>> 3 > this.dirtyBytes) this.dirtyBytes = end >>> 3;
  }

  /** What another writer holds, as a blob, with no view of it made. */
  blobOf(from: BitWriter): void {
    const n = from.byteLength;
    const src = from.buf;
    this.varint(n);
    const p = this.pos;
    const end = p + n * 8;
    if ((p & 7) !== 0 || end > this.capBits) {
      for (let i = 0; i < n; i++) this.bits(src[i]!, 8);
      return;
    }
    const at = p >>> 3;
    if (n < 64) for (let i = 0; i < n; i++) this.buf[at + i] = src[i]!;
    else this.buf.set(src.subarray(0, n), at);
    this.pos = end;
    if (end >>> 3 > this.dirtyBytes) this.dirtyBytes = end >>> 3;
  }

  /** UTF-8 with a varint byte-length prefix. */
  string(s: string): void {
    this.varint(utf8Length(s));
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
        c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      }
      if (c < 0x80) this.bits(c, 8);
      else if (c < 0x800) {
        this.bits(0xc0 | (c >> 6), 8);
        this.bits(0x80 | (c & 63), 8);
      } else if (c < 0x10000) {
        this.bits(0xe0 | (c >> 12), 8);
        this.bits(0x80 | ((c >> 6) & 63), 8);
        this.bits(0x80 | (c & 63), 8);
      } else {
        this.bits(0xf0 | (c >> 18), 8);
        this.bits(0x80 | ((c >> 12) & 63), 8);
        this.bits(0x80 | ((c >> 6) & 63), 8);
        this.bits(0x80 | (c & 63), 8);
      }
    }
  }
}

/** `s` cut at a whole character so that its UTF-8 takes at most `max` bytes. */
export function fitBytes(s: string, max: number): string {
  if (utf8Length(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (utf8Length(out + ch) > max) break;
    out += ch;
  }
  return out;
}

/** Bytes of `s` as UTF-8, as `string` writes it. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export class BitReader {
  private buf: Uint8Array = new Uint8Array(0);
  private limitBits = 0;
  pos = 0;
  overflow = false;

  constructor(data?: Uint8Array) {
    if (data) this.reset(data);
  }

  reset(data: Uint8Array): void {
    this.buf = data;
    this.limitBits = data.length * 8;
    this.pos = 0;
    this.overflow = false;
  }

  get remainingBits(): number {
    return this.limitBits - this.pos;
  }

  bits(n: number): number {
    let p = this.pos;
    if (p + n > this.limitBits) {
      this.overflow = true;
      this.pos = this.limitBits;
      return 0;
    }
    const buf = this.buf;
    let v = 0;
    let shift = 0;
    while (n > 0) {
      const off = p & 7;
      const room = 8 - off;
      const take = room < n ? room : n;
      v |= ((buf[p >>> 3]! >>> off) & ((1 << take) - 1)) << shift;
      shift += take;
      p += take;
      n -= take;
    }
    this.pos = p;
    return v >>> 0;
  }

  bool(): boolean {
    // bits(1) without its loop.
    const p = this.pos;
    if (p >= this.limitBits) {
      this.overflow = true;
      this.pos = this.limitBits;
      return false;
    }
    this.pos = p + 1;
    return ((this.buf[p >>> 3]! >>> (p & 7)) & 1) === 1;
  }

  u8(): number {
    return this.bits(8);
  }

  u16(): number {
    return this.bits(16);
  }

  u32(): number {
    return this.bits(32);
  }

  sbits(n: number): number {
    const shift = 32 - n;
    return (this.bits(n) << shift) >> shift;
  }

  varint(): number {
    let v = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.bits(8);
      v |= (b & 0x7f) << shift;
      if (b < 0x80) return v >>> 0;
      shift += 7;
    }
    this.overflow = true;
    return 0;
  }

  svarint(): number {
    const v = this.varint();
    return (v >>> 1) ^ -(v & 1);
  }

  uint53(): number {
    const lo = this.bits(32);
    return this.bits(21) * TWO_32 + lo;
  }

  f32(): number {
    F32_BITS[0] = this.bits(32);
    return F32[0]!;
  }

  f64(): number {
    F64_BITS[0] = this.bits(32);
    F64_BITS[1] = this.bits(32);
    return F64[0]!;
  }

  /** Returns a copy. A length above `max` sets `overflow`. */
  blob(max: number): Uint8Array {
    const n = this.varint();
    if (n > max || n * 8 > this.remainingBits) {
      this.overflow = true;
      return new Uint8Array(0);
    }
    const out = new Uint8Array(n);
    const p = this.pos;
    if ((p & 7) !== 0 || n < WHOLE) {
      for (let i = 0; i < n; i++) out[i] = this.bits(8);
      return out;
    }
    out.set(this.buf.subarray(p >>> 3, (p >>> 3) + n));
    this.pos = p + n * 8;
    return out;
  }

  /** A length above `maxBytes` sets `overflow`. */
  string(maxBytes: number): string {
    const n = this.varint();
    if (n > maxBytes || n * 8 > this.remainingBits) {
      this.overflow = true;
      return "";
    }
    let s = "";
    let i = 0;
    while (i < n) {
      const b = this.bits(8);
      i++;
      let c = b;
      let extra = 0;
      if (b >= 0xf0) {
        c = b & 7;
        extra = 3;
      } else if (b >= 0xe0) {
        c = b & 15;
        extra = 2;
      } else if (b >= 0xc0) {
        c = b & 31;
        extra = 1;
      }
      for (; extra > 0 && i < n; extra--, i++) c = (c << 6) | (this.bits(8) & 63);
      if (c >= 0x10000) {
        c -= 0x10000;
        s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
      } else s += String.fromCharCode(c);
    }
    return s;
  }
}

/** The values one message names: each goes whole the first time, then as its place among those named before it. */
export class Named {
  private readonly seen: number[] = [];
  /** Where the value last written or read is among those named, or -1 for one that was not kept. */
  at = -1;
  /** Whether that value went whole. */
  whole = false;

  private readonly most: number;

  /** Past `most` values a new one goes whole each time and is not kept, so the search for a value stays short. */
  constructor(most = Infinity) {
    this.most = most;
  }

  get size(): number {
    return this.seen.length;
  }

  reset(): void {
    this.seen.length = 0;
  }

  /** The place of a value named before, or -1. A writer that packs its own bits writes a 0 and the place in `width` bits. */
  find(v: number): number {
    return this.seen.indexOf(v);
  }

  /** The bits a place takes now. */
  get width(): number {
    return widthOf(this.seen.length);
  }

  /** `bits` of the value, or 0 for a varint. */
  write(w: BitWriter, v: number, bits: number): void {
    const i = this.seen.indexOf(v);
    w.bool(i < 0);
    this.whole = i < 0;
    this.at = i;
    if (i >= 0) w.bits(i, widthOf(this.seen.length));
    else {
      if (this.seen.length < this.most) this.at = this.seen.push(v) - 1;
      if (bits > 0) w.bits(v, bits);
      else w.varint(v);
    }
  }

  read(r: BitReader, bits: number): number {
    this.whole = r.bool();
    if (!this.whole) return this.seen[(this.at = r.bits(widthOf(this.seen.length)))] ?? 0;
    const v = bits > 0 ? r.bits(bits) : r.varint();
    this.at = this.seen.length < this.most ? this.seen.push(v) - 1 : -1;
    return v;
  }
}

function widthOf(n: number): number {
  return n <= 1 ? 0 : 32 - Math.clz32(n - 1);
}
