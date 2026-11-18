// The asset library: what assets there are, which fills each slot of the content, how fine a level each thing is drawn
// at and how wide its textures, and which of them are on the graphics card. Given one whole pack, every level is in it
// and is resident when first drawn. Given a manifest and a port, only the boot pack is here at start and the rest is
// asked for as it is wanted: a mesh's page first, which says what the mesh is.

import type { ClipSet } from "../../../shared/anim/clip.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { describePack, type Manifest } from "../../../shared/pack/manifest.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import { stepOf, type TextureFormat } from "../../../shared/pack/texture.ts";
import type { FramePacket } from "../render/packet.ts";
import { Binding } from "./bind.ts";
import type { AssetPort } from "./port.ts";
import { PAGE_FIRST, Residency } from "./residency.ts";
import { AssetTable } from "./table.ts";
import { DEFAULT_TIER, TIERS, tierOf, type Tier } from "./tiers.ts";

/** A level is left only when another is right by this margin, so that a body at the edge of a switch does not flicker. */
export const HYSTERESIS = 0.15;

/** The coarsest level, but none finer than `finest`, whose error is within `limit`. */
function within(errors: readonly number[], finest: number, limit: number): number {
  let level = errors.length - 1;
  while (level > finest && errors[level]! > limit) level--;
  return level;
}

export class Assets {
  readonly manifest: Manifest;
  readonly table: AssetTable;
  readonly bind: Binding;
  readonly residency: Residency;
  /** Counts the frames in which pages came, for what keeps what it worked out of the meshes known. */
  learnt = 0;
  /** The graphics tier: how much error on screen is let pass, the finest level ever drawn, and how wide a texture. */
  tier: Tier = tierOf(DEFAULT_TIER);
  /** The variant of the textures the device takes. The shell says which. */
  format: TextureFormat = "rgba";
  /** The pixels a metre covers on screen from a metre away. */
  scale = 0;
  /** The share of the tier's budget in use: less each time the graphics card runs out of memory or is lost. */
  private squeeze = 1;
  private pressures = 0;

  /** Without a manifest the pack is taken to hold every level of every mesh. `pages` are as Residency takes them. */
  constructor(reg: Registry, pack: Pack, manifest: Manifest = describePack(pack, { name: "", bytes: pack.blobAt + pack.blob.length }), port: AssetPort | null = null, pages: readonly Uint8Array[] = []) {
    this.manifest = manifest;
    this.table = new AssetTable(manifest, pack);
    this.bind = new Binding(reg.defs, this.table);
    this.residency = new Residency(manifest, pack, port, pages);
    this.begin(0, 720, 1.2217);
  }

  /** Starts a frame: the time, and the view's height in pixels and vertical field of view in radians. */
  begin(nowMs: number, height: number, fovY: number): void {
    this.scale = height / (2 * Math.tan(fovY / 2));
    const r = this.residency;
    // A squeeze takes the whole card down, so what is reserved comes off what is left of it.
    r.budget = Math.max(0, this.tier.gpuBytes * this.squeeze - r.reserved);
    r.texBudget = r.budget * this.tier.textureShare;
    r.cap = stepOf(this.tier.texture);
    r.format = this.format;
    r.uploadBytes = this.tier.uploadBytes;
    r.begin(nowMs);
    for (const mesh of r.learned) this.table.learn(mesh);
    if (r.learned.length > 0) this.learnt++;
  }

  /** Whether a mesh's row is here, so it can be drawn and its parts named. Where not, its page is asked for. */
  known(mesh: number): boolean {
    return this.residency.known(mesh);
  }

  /**
   * The graphics card ran out of memory or lost everything. The budget falls by a quarter, and on every third time the
   * tier falls by one: then this returns true, for the player to be told. Nothing raises either again in a session.
   */
  pressure(): boolean {
    this.squeeze *= 0.75;
    const at = TIERS.findIndex((t) => t.name === this.tier.name);
    if (++this.pressures % 3 !== 0 || at <= 0) return false;
    this.tier = TIERS[at - 1]!;
    return true;
  }

  /** The state of the library in a line, for a developer's eye. */
  line(): string {
    const r = this.residency;
    const mb = (bytes: number): string => (bytes / 1048576).toFixed(1);
    return `assets: ${mb(r.ledger)} MB on the card${r.texLedger > 0 ? `, ${mb(r.texLedger)} of it textures` : ""}${r.reserved > 0 ? ` and ${mb(r.reserved)} reserved` : ""}, ${r.flying} coming, ${mb(r.waiting)} MB waiting, ${mb(r.stats.fetched)} MB fetched, ${mb(r.stats.cached)} MB from the cache, ${r.stats.failed} failed, ${r.stats.dead} given up, ${r.stats.skipped} left out, x${r.relax.toFixed(2)}`;
  }

  /**
   * Ends a frame: what the graphics card must take on and let go goes into the packet. Levels and their surfaces are
   * in `assetUploads` and `assetDrops`. Textures are in `texUploads` and `texDrops`, each known there by its index in
   * the manifest.
   */
  end(packet: FramePacket, nowMs: number): void {
    this.residency.end(packet.assetUploads, packet.assetDrops, packet.texUploads, packet.texDrops, nowMs);
  }

  /**
   * The level to draw something at, `distance` metres off, whose levels lie `errors` metres from its finest: the
   * coarsest whose error covers no more pixels than the tier lets pass. `was` is the level it had last, or -1.
   */
  choose(errors: readonly number[], distance: number, was: number): number {
    const allowed = (this.tier.threshold * this.residency.relax * distance) / this.scale;
    const finest = Math.min(this.tier.finest, errors.length - 1);
    const want = within(errors, finest, allowed);
    if (was < 0 || was >= errors.length || want === was) return want;
    if (want > was) return Math.max(was, within(errors, finest, allowed * (1 - HYSTERESIS)));
    return errors[was]! > allowed * (1 + HYSTERESIS) || was < finest ? want : was;
  }

  /**
   * Says a level of a mesh is wanted for something `distance` metres off. The more pixels of error the level saves
   * over the mesh's coarsest, and the nearer, the sooner it is fetched.
   */
  want(mesh: number, level: number, distance: number): void {
    const errors = this.table.error[mesh]!;
    const at = level < errors.length ? level : errors.length - 1;
    this.residency.want(mesh, at, this.urgency(errors, at, distance));
  }

  /** As `want`, for a level of a mesh that holds none to draw in its place: as urgent as a page, as nothing of it is drawn without it. */
  wantFirst(mesh: number, level: number, distance: number): void {
    const errors = this.table.error[mesh]!;
    const at = level < errors.length ? level : errors.length - 1;
    this.residency.want(mesh, at, PAGE_FIRST + this.urgency(errors, at, distance));
  }

  private urgency(errors: readonly number[], at: number, distance: number): number {
    const d = distance > 1 ? distance : 1;
    return ((errors[errors.length - 1]! - errors[at]!) * this.scale) / d + 1 / d;
  }

  /**
   * As `want`, for something to be drawn with its materials: the level's surface is wanted with it, and each material
   * of its sections is said to be on screen. `size` is how many times its modelled size the thing is drawn, for a
   * caller that has not divided its distance by that already. On low poly this is `want` and no more.
   */
  wantTextured(mesh: number, level: number, distance: number, size = 1): void {
    const errors = this.table.error[mesh]!;
    const at = level < errors.length ? level : errors.length - 1;
    const urgency = this.urgency(errors, at, distance);
    this.residency.want(mesh, at, urgency);
    if (!this.residency.wantSurface(mesh, at, urgency)) return;
    const runs = this.table.sections[mesh]![at]!;
    for (let k = 0; k < runs.length; k += 3) this.material(runs[k]!, distance, size);
  }

  /**
   * After `wantTextured`, for a body whose hurt and decay layer shows: wants the layer of each material of the level
   * that has one. False, wanting nothing, where the level is not drawn with materials or none of them has a layer.
   */
  wantLayers(mesh: number, level: number, distance: number, size = 1): boolean {
    const errors = this.table.error[mesh]!;
    const runs = this.table.sections[mesh]![level < errors.length ? level : errors.length - 1]!;
    let any = false;
    for (let k = 0; k < runs.length; k += 3) {
      const m = runs[k]!;
      const d = distance > 0.01 ? distance : 0.01;
      any = this.residency.layer(m, (this.table.materials[m]!.span * size * this.scale) / (d * this.residency.relax), d > 1 ? d : 1) || any;
    }
    return any;
  }

  /** Whether a material drawn this frame has its layer on the card, to draw it with. */
  layered(material: number): boolean {
    return this.residency.layered(material);
  }

  /**
   * Says a material is on screen, on something `distance` metres off drawn `size` times its modelled size. One whole
   * texture of it then covers `span * size * scale / distance` pixels, and the step wanted of its widest texture is
   * the first that is as many pixels across, up to the tier's widest. A texture authored narrower than the widest is
   * wanted as many steps under. While the card is over-full fewer pixels are counted, as for levels.
   */
  material(material: number, distance: number, size = 1): void {
    const d = distance > 0.01 ? distance : 0.01;
    this.residency.material(material, (this.table.materials[material]!.span * size * this.scale) / (d * this.residency.relax), d > 1 ? d : 1);
  }

  /** Says the clips of the manifest's skeleton `c` are wanted, which asks for them at once: a body without them stands at rest. */
  wantClips(c: number): void {
    this.residency.wantClips(c);
  }

  /** The clips of the manifest's skeleton `c`, or null until they have come. */
  clips(c: number): ClipSet | null {
    return this.residency.clips(c);
  }

  /**
   * The level of `mesh` to draw when `wanted` is asked for: that level if the mesh has it and it is resident, else the
   * nearest that is, else -1. Every draw of the scene passes through here.
   */
  level(mesh: number, wanted: number): number {
    return this.residency.level(mesh, wanted);
  }

  /**
   * Bit l for each level of `mesh` that can be drawn without fetching, for what must never fetch, such as shadows: those
   * on the card and those in the boot pack. Asking wants nothing.
   */
  held(mesh: number): number {
    return this.residency.held(mesh);
  }

  /** The held level nearest `wanted`, searched as `level` searches: that one, else the next coarser held, else the nearest finer. -1 for none. */
  heldLevel(mesh: number, wanted: number): number {
    const held = this.residency.held(mesh);
    const count = this.table.error[mesh]!.length;
    const want = wanted < count ? wanted : count - 1;
    for (let l = want; l < count; l++) if ((held >>> l) & 1) return l;
    for (let l = want - 1; l >= 0; l--) if ((held >>> l) & 1) return l;
    return -1;
  }

  /** Whether a held level's cut-out sections can be cut out in a depth map without fetching. */
  heldCutouts(mesh: number, level: number): boolean {
    return this.residency.heldCutouts(mesh, level);
  }

  /** Keeps a held level on the card through this frame, and with `cutouts` what cutting its sections out reads. */
  keep(mesh: number, level: number, cutouts: boolean): void {
    this.residency.keep(mesh, level, cutouts);
  }

  /**
   * Whether a level that `level` has just given is drawn with its materials this frame, a draw for each of
   * `table.sections[mesh][level]`. If not, it is drawn flat and whole: never some sections one way and some the other.
   */
  textured(mesh: number, level: number): boolean {
    return this.residency.textured(mesh, level);
  }

  /** The held level drawable with materials, or a finer textured level while its replacement loads; -1 for a flat draw. */
  texturedLevel(mesh: number, wanted: number, held = this.level(mesh, wanted)): number {
    if (held < 0) return -1;
    if (this.textured(mesh, held)) return held;
    const sections = this.table.sections[mesh]!;
    if (sections[Math.min(wanted, sections.length - 1)]!.length > 0) {
      for (let l = held - 1; l >= 0; l--) if (this.textured(mesh, l)) return l;
    }
    return -1;
  }
}
