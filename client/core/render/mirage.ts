// The air's waver over what is hot (planning/workstreams/fire.md): over a fire that stands near the eye, and the ring a
// blast's shock throws out. Each is a card that shifts what is seen through it by a pixel or a few, and draws nothing of
// its own. A tier with a light target draws the cards' shifts into a second attachment of the scene's (client/shell/gl.ts
// `mirage`), tested against the world's depth, so what stands before the hot air hides it and stays sharp; the finish
// (post.ts) then reads the scene from where each pixel's shift says. The viewer's own body is drawn after and has the
// shifts under it cleared. Nothing is shifted from where there is no hot air, so nothing before it smears into it.

import type { Tier } from "../assets/tiers.ts";
import { DETAIL, DETAIL_FLOATS, FRAME_BLOCK, MIRAGE_AT, type FramePacket } from "./packet.ts";
import { VehicleCards } from "./vehicle-cards.ts";

/** Cards a frame holds at the most. */
export const MIRAGE_MOST = 24;
/** Pixels a card's shift is at its strongest on a screen 1,080 high, for a unit of its waves; and what a ring's is, in those. */
export const MIRAGE_PIXELS = 1.8;
const RING = 5.5;
/** The pixels either way a shift is stored in: a byte's half is none. */
export const MIRAGE_SPAN = 16;
export const MIRAGE_NONE = 128 / 255;
/** Milliseconds its waves come round in, with no jump. */
export const MIRAGE_TURN_MS = 8000;
/** Metres past which hot air is not drawn, fading from two thirds of that. */
export const MIRAGE_REACH = 80;
/** What a card's fourth misc byte says it is. */
const HOT = 0, SHOCK = 255;

export class Mirage extends VehicleCards {
  /** Off, none is drawn: a page's before and after (client/core/passes.ts "mirage"). */
  on = true;

  constructor() {
    super(MIRAGE_MOST);
  }

  /**
   * Hot air rising over (x, y, z) from the eye: a card `half` metres either side and `tall` up and down from there,
   * square to the eye, shifting by `strength` of its most, with a seed of its own so no two waver alike.
   */
  over(x: number, y: number, z: number, half: number, tall: number, strength: number, seed: number): void {
    const far = Math.hypot(x, y, z);
    this.put(x, y, z, half, tall, strength * (1 - Math.min(1, Math.max(0, (far - (2 * MIRAGE_REACH) / 3) / (MIRAGE_REACH / 3)))), seed, HOT);
  }

  /** A blast's shock, a ring `radius` metres across its middle at (x, y, z) from the eye, square to the eye. */
  ring(x: number, y: number, z: number, radius: number, strength: number): void {
    this.put(x, y, z, radius / 0.8, radius / 0.8, strength, 0, SHOCK);
  }

  private put(x: number, y: number, z: number, half: number, tall: number, strength: number, seed: number, kind: number): void {
    if (!this.on || strength <= 0.02 || this.count >= MIRAGE_MOST) return;
    const d = Math.hypot(x, y, z) || 1, ex = x / d, ey = y / d, ez = z / d, l = Math.hypot(x, z) || 1, rx = z / l, rz = -x / l;
    const i = this.next(), card = this.cards;
    card[i] = x;
    card[i + 1] = y;
    card[i + 2] = z;
    // Its up is square to the way to it and to its across, so from over it, it still faces the eye.
    card[i + DETAIL.along] = ey * rz * tall;
    card[i + DETAIL.along + 1] = (ez * rx - ex * rz) * tall;
    card[i + DETAIL.along + 2] = -ey * rx * tall;
    card[i + DETAIL.across] = rx * half;
    card[i + DETAIL.across + 1] = 0;
    card[i + DETAIL.across + 2] = rz * half;
    card[i + DETAIL.floor] = 0;
    this.words[i + DETAIL.colourA] = Math.floor(Math.min(0.999, Math.max(0, seed)) * 256) >>> 0;
    this.words[i + DETAIL.colourB] = 0;
    this.words[i + DETAIL.misc] = ((Math.round(Math.min(1, strength) * 255) << 16) | (kind << 24)) >>> 0;
  }

  /**
   * Writes the frame's cards into `p` after what is there and names their run (`mirageFirst`, `mirageCount`), where the
   * tier draws them; and the frame's lane: whether any are drawn, the pixels a unit of shift is on a view `viewHeight`
   * pixels high, and the phase of their waves at the scene's clock `now` ms. With none, the lane says none.
   */
  frame(p: FramePacket, tier: Tier, now: number, viewHeight: number): void {
    const drawn = this.on && tier.post?.mirage === true && this.count > 0;
    p.mirageFirst = p.detailCount;
    p.mirageCount = drawn ? this.count : 0;
    if (drawn) this.write(p);
    p.frame[MIRAGE_AT] = drawn ? 1 : 0;
    p.frame[MIRAGE_AT + 1] = (MIRAGE_PIXELS * viewHeight) / 1080;
    p.frame[MIRAGE_AT + 2] = ((((now % MIRAGE_TURN_MS) + MIRAGE_TURN_MS) % MIRAGE_TURN_MS) / MIRAGE_TURN_MS) * 2 * Math.PI;
    p.frame[MIRAGE_AT + 3] = 0;
  }
}

/** Floats a card takes in the packet, for a shell that binds them. */
export const MIRAGE_CARD_FLOATS = DETAIL_FLOATS;

/**
 * The vertex text: a card's corner in the world, as the small details place theirs. With `uFrom` under zero it is the
 * whole view at its far end instead, for the draw that clears the shifts under the viewer's body (client/shell/gl.ts).
 */
export const MIRAGE_VERTEX = `#version 300 es
layout(location=0) in vec3 iMiddle;
layout(location=1) in vec3 iAlong;
layout(location=2) in vec3 iAcross;
layout(location=4) in vec4 iA;
layout(location=6) in uvec4 iMisc;
uniform mat4 uViewProj;
uniform float uFrom;
out vec2 vCorner;
flat out float vSeed, vShows, vKind;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vCorner = c;
  vSeed = iA.r;
  vShows = uFrom < -0.5 ? -1.0 : float(iMisc.z) / 255.0;
  vKind = float(iMisc.w) / 255.0;
  gl_Position = uFrom < -0.5 ? vec4(c, 1.0, 1.0) : uViewProj * vec4(iMiddle + c.x * iAcross + c.y * iAlong, 1.0);
}`;

/**
 * The fragment text: into the second attachment, which holds two bytes a pixel, a pixel's shift in its red and green
 * about MIRAGE_NONE, a byte's half, weighed in by its alpha as it is blended. Hot air is two scales of waves rising,
 * strongest up its middle and gone at its sides and ends; a shock is a band pushing outward round a ring. The first
 * attachment is given nothing.
 */
export const MIRAGE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vCorner;
flat in float vSeed, vShows, vKind;
${FRAME_BLOCK}layout(location=0) out vec4 none;
layout(location=1) out vec4 o;
void main() {
  none = vec4(0.0);
  if (vShows < 0.0) {
    o = vec4(${MIRAGE_NONE}, ${MIRAGE_NONE}, 0.0, 0.0);
    return;
  }
  vec2 c = vCorner, off;
  float a;
  if (vKind > 0.5) {
    float r = length(c);
    a = exp(-pow((r - 0.8) * 8.0, 2.0));
    off = c / max(r, 1.0e-3) * ${RING.toFixed(1)};
  } else {
    float s = 6.2831853 * vSeed, y1 = 5.0 * c.y - 3.0 * fMirage.z + s, y2 = 11.0 * c.y - 5.0 * fMirage.z + 2.3 * s;
    off = vec2(sin(y1 + 3.0 * c.x) + 0.6 * sin(y2 - 5.0 * c.x), 0.45 * cos(0.8 * y1 - 4.0 * c.x) + 0.3 * sin(1.3 * y2 + c.x));
    a = (1.0 - smoothstep(0.3, 1.0, abs(c.x))) * smoothstep(-1.0, -0.5, c.y) * (1.0 - smoothstep(0.0, 1.0, c.y));
  }
  o = vec4(${MIRAGE_NONE} + off * (fMirage.y / ${MIRAGE_SPAN.toFixed(1)}), 0.0, a * vShows);
}`;

/**
 * GLSL for the finish (post.ts): where a pixel at `uv` of the scene is read from, with the frame's hot air. `most` is the
 * last texel the scene fills and `texel` one texel. Nothing is read from where there is no hot air, which is where
 * there is no shift: what stands before it there would smear into it (GPU Gems 2, chapter 19).
 */
export const MIRAGE_GLSL = `uniform sampler2D uMirage;
vec2 wavered(vec2 uv, vec2 most, vec2 texel) {
  if (fMirage.x < 0.5) return uv;
  vec2 shift = texture(uMirage, min(uv, most)).rg - ${MIRAGE_NONE};
  // Under half a byte's step there is none.
  if (dot(shift, shift) < 4.0e-6) return uv;
  vec2 to = uv + shift * ${MIRAGE_SPAN.toFixed(1)} * texel;
  vec2 there = texture(uMirage, min(to, most)).rg - ${MIRAGE_NONE};
  return mix(uv, to, smoothstep(0.0, 1.0e-4, dot(there, there)));
}
`;
