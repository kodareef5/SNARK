// Loose things: the entities that are one mesh each and no body (a bag, a prop, a thing thrown and come to rest), and the
// pieces of a structure falling after a removal. The instances of each mesh are counted, then written together, a draw a mesh.
// A city piece falls as its break set (fragments.ts): an instance a piece on the set's own mesh, a bone a group, so
// the pieces of one set are one draw. Past the tier's bones a piece is its set as one thing on one bone. A built
// piece's set is drawn from its pack's `<kind>/break` mesh, in the piece's own material, where the card holds it.

import type { Registry } from "../../../../shared/content/registry.ts";
import { INSTANCE_BYTES } from "../../../../shared/pack/pack.ts";
import { GEAR_COUNT } from "../../../../shared/sim/entities.ts";
import type { Assets } from "../../assets/assets.ts";
import { MOST_GROUPS, POSE, SET_PIECE, fragmentPose, shrinkPose } from "../../fragments.ts";
import type { Falling } from "../../rubble.ts";
import type { RemoteSample } from "../../session.ts";
import type { Camera } from "../camera.ts";
import { showMaterials, type Characters } from "../characters.ts";
import type { Clouds } from "../clouds.ts";
import type { Draws } from "../draws.ts";
import type { Dropped } from "../dropped.ts";
import { FAR_MESH } from "../far.ts";
import { FragmentMeshes } from "../fragment-meshes.ts";
import type { Hiding } from "../hide.ts";
import { BONE_FLOATS, DRAW_ONE_BONE, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_DRAWS, MAX_FALLING, PASS_FAR, PASS_NEAR, TRANSIENT_BUFFER, type FramePacket, type InstanceWriter } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import { PIECE_FRAMED, pieceWord, plainYaw, writePiece } from "../piece-fit.ts";
import type { PieceLooks } from "../piece-state.ts";
import type { OwnBody } from "../scene.ts";

/** What the pass reads of the scene: its tables by kind, and who draws the kinds it leaves out. */
export interface LooseLooks {
  readonly meshOfKind: Uint16Array;
  readonly colorOfKind: Uint8Array;
  /** Per kind, its regions after the first, five each (Scene.regionsOfKind). */
  readonly regionsOfKind: Uint8Array;
  /** 1 for kinds drawn with their pitch, which the bodies' pass draws on a bone. */
  readonly pitched: Uint8Array;
  /** The kind of the supply capsule's prop where the pack has its model, which the supply drops' pass draws, or -1. */
  readonly capsuleKind: number;
  readonly characters: Characters;
  readonly clouds: Clouds;
  readonly dropped: Dropped;
}

/** The most draws the fragments add in a frame on any tier, and the room a draw's box is given under where its pieces stood. */
const MOST_DRAWS = 128;
const FALLS = 6;
/** How a piece is drawn this frame: not, a bone a group, or its set as one thing. In `seen` they are bits, with a third for a piece in view and a fourth for a set drawn from its pack. */
const NOT = 0, FINE = 1, COARSE = 2, IN_VIEW = 4, PACKED = 8;
const BOTH = (1 << PASS_NEAR) | (1 << PASS_FAR);
const pose = new Float64Array(POSE.length);

export class LooseEntities implements Pass {
  /** Structures falling after a removal. The app sets it (Scene.falling). */
  falling: Falling | null = null;
  /** How built pieces are drawn (the near store's): with it, a piece falling whole leaves from where its row was drawn. */
  pieces: PieceLooks | null = null;
  /** The break sets' meshes on the card. */
  readonly fragments = new FragmentMeshes();
  /** Of the last frame's fragments: pieces drawn a bone a group and as one thing, the bones they took, and the draws and triangles they added. */
  readonly fragmentStats = { fine: 0, coarse: 0, bones: 0, draws: 0, triangles: 0 };
  /** The pack mesh the fragments' draws name: their vertices are their own. */
  private readonly carrier: number;
  /** Per kind, the six regions a fragment of a piece the map placed as it is drawn in: its colour, its soffit's, its others. */
  private readonly finishOfKind: Uint8Array;
  /** Per falling piece this frame: whether it is in view and which ways its meshes on the card let it be drawn, how it is drawn, and in which of the fragments' draws. */
  private readonly seen = new Uint8Array(MAX_FALLING);
  private readonly how = new Uint8Array(MAX_FALLING);
  private readonly drawOf = new Uint8Array(MAX_FALLING);
  private ordered = 0;
  /** The sets wanted this frame to draw pieces as one thing with. */
  private lumps = 0;
  /** The fragments' draws this frame, by set and how: each one's mesh, instances, where its next is written, and the box round its pieces. */
  private readonly drawAt = new Map<number, number>();
  private readonly drawSlot = new Uint32Array(MOST_DRAWS);
  private readonly drawTriangles = new Uint32Array(MOST_DRAWS);
  private readonly drawHow = new Uint8Array(MOST_DRAWS);
  private readonly drawPieces = new Uint16Array(MOST_DRAWS);
  private readonly drawCursor = new Uint32Array(MOST_DRAWS);
  private readonly drawBox = new Float32Array(MOST_DRAWS * 6);
  /** Rigid species keep palette lighting; the static fallback finish belongs to world geometry. */
  private readonly speciesKind: Uint8Array;
  /** Per mesh: its instances counted, and where the next of them is written. */
  private readonly counts: Uint32Array;
  private readonly cursor: Uint32Array;
  /** Per mesh, the level its falling pieces were last drawn at, or -1. */
  private readonly fallLevel: Int8Array;
  /** Per mesh counted in `counts`, the square of how far off the nearest instance is, and how far along the view they all lie. */
  private readonly nearest: Float32Array;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  /** The viewer's own body and the entity left out for it, this frame. */
  private own: OwnBody | null = null;
  private skip = -1;
  private readonly packet: FramePacket;
  private readonly assets: Assets;
  private readonly put: Draws;
  private readonly transient: InstanceWriter;
  private readonly hiding: Hiding;
  private readonly radiusOfMesh: Float32Array;
  private readonly meshOfKind: Uint16Array;
  private readonly colorOfKind: Uint8Array;
  private readonly regionsOfKind: Uint8Array;
  /** Per kind, its break set and its form in it, by which a falling form of its map piece is known. */
  private readonly breakSet: Uint16Array;
  /** Per kind, its pack's mesh of a built piece's break (`<id>/break`), or -1; and the draws of such meshes, by the pack mesh, -1 for a set's own. */
  private readonly breakMesh: Int32Array;
  private readonly drawPack = new Int32Array(MOST_DRAWS);
  /** The sets drawn from their pack this frame, counted as the sets drawn as one thing are. */
  private readonly packed = new Set<number>();
  private readonly breakForm: Uint8Array;
  private readonly pitched: Uint8Array;
  private readonly capsuleKind: number;
  private readonly characters: Characters;
  private readonly clouds: Clouds;
  private readonly dropped: Dropped;
  /** The falling pieces: a row of the frame's list after the bodies. */
  readonly rubble: Pass = {
    update: (f) => this.readyFragments(f),
    draw: (f) => {
      this.fragmentStats.fine = this.fragmentStats.coarse = this.fragmentStats.bones = this.fragmentStats.draws = this.fragmentStats.triangles = 0;
      if (this.falling && this.falling.count > 0) this.showFalling(f, this.falling);
    },
  };

  constructor(reg: Registry, assets: Assets, packet: FramePacket, put: Draws, transient: InstanceWriter, hiding: Hiding, looks: LooseLooks) {
    const n = assets.table.count;
    this.speciesKind = Uint8Array.from(reg.defs, (d) => (d?.type === "species" ? 1 : 0));
    this.counts = new Uint32Array(n);
    this.cursor = new Uint32Array(n);
    this.fallLevel = new Int8Array(n).fill(-1);
    this.nearest = new Float32Array(n);
    this.from = new Float32Array(n);
    this.to = new Float32Array(n);
    this.packet = packet;
    this.assets = assets;
    this.put = put;
    this.transient = transient;
    this.hiding = hiding;
    this.radiusOfMesh = assets.table.radius;
    this.meshOfKind = looks.meshOfKind;
    this.colorOfKind = looks.colorOfKind;
    this.regionsOfKind = looks.regionsOfKind;
    this.breakSet = reg.breakSet;
    this.breakForm = reg.breakForm;
    this.breakMesh = Int32Array.from(reg.ids, (id, k) => (reg.forms?.def[k] ? assets.table.find(`${id}/break`) : -1));
    this.carrier = Math.max(0, assets.table.find(FAR_MESH));
    this.finishOfKind = new Uint8Array(reg.defs.length * 6);
    reg.defs.forEach((d, k) => {
      if (d?.type !== "structure") return;
      this.finishOfKind[k * 6] = d.color;
      this.finishOfKind[k * 6 + 1] = d.under ?? d.color;
      for (let q = 1; q < 5; q++) this.finishOfKind[k * 6 + 1 + q] = looks.regionsOfKind[k * 5 + q]!;
    });
    this.pitched = looks.pitched;
    this.capsuleKind = looks.capsuleKind;
    this.characters = looks.characters;
    this.clouds = looks.clouds;
    this.dropped = looks.dropped;
  }

  /** The entities, and on a lit tier the species among them apart, which keep their palette's lighting. */
  draw(f: Frame): void {
    const remote = f.remote;
    if (!remote) return;
    this.own = f.own;
    this.skip = f.skip;
    this.entityBatch(f.cam, remote, false);
    if (this.packet.lit) this.entityBatch(f.cam, remote, true);
  }

  /** After a lost context: the fragments' meshes go on the card again as they are wanted. */
  reset(): void {
    this.fragments.reset();
  }

  /**
   * Before the frame's draws: the tier's limits are the falling pieces', and the sets of the pieces in view have their
   * meshes put on the card, as many sets as the tier's draws: first those the pieces are drawn as one thing with,
   * which are few and leave no piece out, then the pieces' own, nearest first.
   */
  private readyFragments(f: Frame): void {
    const fl = this.falling, tier = f.tier.breaks, cam = f.cam, sets = this.fragments;
    sets.begin();
    this.ordered = this.lumps = 0;
    this.packed.clear();
    if (!fl) return;
    fl.most = tier.pieces;
    fl.rest = tier.rest;
    fl.pieceMost = Math.floor(tier.bones / 8);
    if (fl.count === 0) return;
    const n = (this.ordered = fl.order(cam.x, cam.y, cam.z)), most = Math.min(tier.draws, MOST_DRAWS), seen = this.seen;
    for (let k = 0; k < n; k++) {
      const i = fl.sorted[k]!, set = fl.sets[i];
      seen[i] = 0;
      if (!set) continue;
      const x = fl.x0[i]! - cam.x, y = fl.y0[i]! - cam.y, z = fl.z0[i]! - cam.z, r = fl.reach(i);
      if (!cam.boxVisible(x - r, y - r - fl.drop(i) - FALLS, z - r, x + r, y + r, z + r)) continue;
      seen[i] = IN_VIEW;
      // A built piece's set from its pack, once the card has it: wanted as far off as the piece is.
      const pack = set.key % 4 === SET_PIECE ? this.breakMesh[set.key >> 2]! : -1;
      if (pack >= 0) {
        const near = Math.max(0, Math.hypot(x, y, z) - r);
        this.assets.wantTextured(pack, 0, near);
        if (this.assets.level(pack, 0) >= 0 && (this.packed.has(set.key) || this.packed.size + sets.wanted < most)) {
          if (!this.packed.has(set.key)) this.lumps++;
          this.packed.add(set.key);
          seen[i]! |= PACKED | COARSE | FINE;
          continue;
        }
      }
      const before = sets.wanted;
      if (sets.want(set.lump, this.packet, this.carrier, this.assets.residency, most - this.packed.size)) seen[i]! |= COARSE;
      this.lumps += sets.wanted - before;
    }
    for (let k = 0; k < n; k++) {
      const i = fl.sorted[k]!, set = fl.sets[i];
      if (set && seen[i] !== 0 && (seen[i]! & PACKED) === 0 && sets.want(set, this.packet, this.carrier, this.assets.residency, most - this.packed.size)) seen[i]! |= FINE;
    }
    sets.end(this.assets.residency);
  }

  private showFalling(f: Frame, fl: Falling): void {
    const p = this.packet, cam = f.cam;
    let whole = 0;
    for (let i = 0; i < fl.count; i++) if (!fl.sets[i]) whole++;
    if (whole > 0) {
      this.counts.fill(0);
      for (let i = 0; i < fl.count; i++) if (!fl.sets[i]) this.tally(cam, this.meshOfKind[fl.kind[i]!]!, fl.x[i]! - cam.x, fl.y[i]! - cam.y, fl.z[i]! - cam.z);
      const looks = this.pieces, frames = looks ? p.frameTables.get(TRANSIENT_BUFFER) : undefined;
      const total = this.drawTallied(cam, p.transientCount, 0, this.fallLevel, looks?.flag);
      for (let i = 0; i < fl.count; i++) {
        if (fl.sets[i]) continue;
        const kind = fl.kind[i]!, map = fl.map[i]!, mesh = this.meshOfKind[kind]!;
        const at = this.cursor[mesh]!++;
        // A form that falls whole, a wreck's lesser look, keeps the colour of the kind the map placed.
        const dye = map !== 0 && this.breakForm[kind] !== 0 && this.breakSet[map] === this.breakSet[kind] ? map : kind;
        const yaw = fl.yaw[i]!;
        this.transient.set(at, fl.x[i]! - cam.x, fl.y[i]! - cam.y, fl.z[i]! - cam.z, yaw, this.colorOfKind[dye]!);
        if (looks && looks.flag[mesh] !== 0) {
          // Until it lets go it stands on its base's vectors, as its row did; turning, by the yaw nearest its class.
          const tw = Math.max(0, fl.tw[i]!), slot = fl.held[i] === 1 && frames ? frames.add(yaw) : -1;
          p.transient[at * INSTANCE_BYTES + 15] = this.regionsOfKind[dye * 5]!;
          p.transient[at * INSTANCE_BYTES + 16] = this.regionsOfKind[dye * 5 + 1]!;
          writePiece(p.transient, at, slot < 0 ? plainYaw(yaw, tw) : pieceWord(slot, yaw, tw), looks.made[dye]!, slot < 0 ? 0 : PIECE_FRAMED, looks.fit[kind]!);
        }
        p.transientIds[at] = 0;
      }
      p.transientCount = total;
    }
    const triangles = p.triangles;
    if (whole < fl.count) this.showFragments(f, fl);
    this.fragmentStats.triangles = p.triangles - triangles;
  }

  /**
   * The pieces in fragments, nearest first. Each takes one bone, and the nearest a bone a group while the tier's bones
   * and the frame's last. A set is a draw for the pieces drawn a bone a group, and a draw for those drawn as one thing
   * with it, as many draws as the tier's. They cast no shadow.
   */
  private showFragments(f: Frame, fl: Falling): void {
    const p = this.packet, cam = f.cam, tier = f.tier.breaks, sets = this.fragments, stats = this.fragmentStats;
    const n = Math.min(this.ordered, fl.count), how = this.how, seen = this.seen, box = this.drawBox;
    let pieces = 0;
    for (let k = 0; k < n; k++) if ((seen[fl.sorted[k]!]! & (FINE | COARSE)) !== 0 && fl.sets[fl.sorted[k]!]) pieces++;
    // Every piece is to have a bone, and those drawn as one thing share a pose of MOST_GROUPS bones that leave a vertex where it is.
    const bones = Math.min(tier.bones, Math.min(p.tier.bones, MAX_BONES) - p.boneCount) - MOST_GROUPS;
    const room = Math.min(pieces, bones, p.transientIds.length - p.transientCount);
    if (room <= 0) {
      p.dropped += pieces;
      return;
    }
    p.dropped += pieces - room;
    let spare = bones - room, shown = 0, draws = 0, lumps = 0;
    const most = Math.min(tier.draws, MOST_DRAWS);
    this.drawAt.clear();
    for (let k = 0; k < n; k++) {
      const i = fl.sorted[k]!, set = fl.sets[i];
      how[i] = NOT;
      if (!set || (seen[i]! & (FINE | COARSE)) === 0 || shown >= room || fl.share(i) <= 0) continue;
      const more = set.groups.length - 1;
      // A draw a bone a group is begun only while it leaves room for the draws of the sets drawn as one thing.
      let way = (seen[i]! & FINE) !== 0 && more <= spare && (this.drawAt.has(set.key * 2) || draws + this.lumps - lumps < most) ? FINE : (seen[i]! & COARSE) !== 0 ? COARSE : NOT;
      if (way === NOT) continue;
      const of = way === FINE ? set : set.lump, pack = (seen[i]! & PACKED) !== 0 ? this.breakMesh[set.key >> 2]! : -1, mesh = pack >= 0 ? null : sets.drawn(of.key);
      if (!mesh && pack < 0) continue;
      let d = this.drawAt.get(of.key * 2 + way - 1);
      const x = fl.x0[i]! - cam.x, y = fl.y0[i]! - cam.y, z = fl.z0[i]! - cam.z, r = fl.reach(i), low = y - r - fl.drop(i) - FALLS;
      if (d === undefined) {
        if (draws >= most) {
          p.dropped++;
          continue;
        }
        d = draws++;
        if (way === COARSE) lumps++;
        this.drawAt.set(of.key * 2 + way - 1, d);
        this.drawPack[d] = pack;
        this.drawSlot[d] = mesh ? mesh.slot : 0;
        this.drawTriangles[d] = mesh ? mesh.triangles : 0;
        this.drawHow[d] = way;
        this.drawPieces[d] = 0;
        box[d * 6] = x - r; box[d * 6 + 1] = low; box[d * 6 + 2] = z - r;
        box[d * 6 + 3] = x + r; box[d * 6 + 4] = y + r; box[d * 6 + 5] = z + r;
      } else {
        if (x - r < box[d * 6]!) box[d * 6] = x - r;
        if (low < box[d * 6 + 1]!) box[d * 6 + 1] = low;
        if (z - r < box[d * 6 + 2]!) box[d * 6 + 2] = z - r;
        if (x + r > box[d * 6 + 3]!) box[d * 6 + 3] = x + r;
        if (y + r > box[d * 6 + 4]!) box[d * 6 + 4] = y + r;
        if (z + r > box[d * 6 + 5]!) box[d * 6 + 5] = z + r;
      }
      if (way === FINE) spare -= more;
      how[i] = way;
      this.drawOf[i] = d;
      this.drawPieces[d]!++;
      shown++;
    }
    if (shown === 0) return;
    let total = p.transientCount;
    for (let d = 0; d < draws; d++) {
      this.drawCursor[d] = total;
      total += this.drawPieces[d]!;
    }
    const b = p.bones, before = p.boneCount;
    for (let k = 0; k < n; k++) {
      const i = fl.sorted[k]!;
      if (how[i] === NOT) continue;
      const fine = how[i] === FINE, groups = fl.sets[i]!.groups.length, since = fl.since(i), share = fl.share(i);
      fl.land(i, fine);
      const e = fl.broken(i), first = p.boneCount;
      for (let g = fine ? 0 : groups; g < (fine ? groups : groups + 1); g++) {
        fragmentPose(e, g, fl.floorOf(i, g), since, pose);
        if (share < 1) shrinkPose(pose, share);
        const o = p.boneCount++ * BONE_FLOATS;
        for (let q = 0; q < BONE_FLOATS; q++) b[o + q] = pose[q]!;
        b[o + 3] = pose[3]! - cam.x;
        b[o + 7] = pose[7]! - cam.y;
        b[o + 11] = pose[11]! - cam.z;
      }
      const at = this.drawCursor[this.drawOf[i]!]!++, kind = fl.map[i] !== 0 ? fl.map[i]! : fl.kind[i]!;
      this.transient.setSkinned(at, first, this.finishOfKind[kind * 6]!);
      this.transient.regions(at, this.finishOfKind, kind * 6);
      p.transientIds[at] = 0;
      if (fine) stats.fine++;
      else stats.coarse++;
    }
    // The pose the pieces drawn as one thing stand in, which leaves each vertex where its mesh has it.
    const still = p.boneCount;
    if (stats.coarse > 0) {
      for (let g = 0; g < MOST_GROUPS; g++) for (let q = 0; q < BONE_FLOATS; q++) b[(still + g) * BONE_FLOATS + q] = q % 5 === 0 ? 1 : 0;
      p.boneCount += MOST_GROUPS;
    }
    stats.bones = p.boneCount - before;
    for (let d = 0; d < draws; d++) {
      const passes = cam.passes(box[d * 6]!, box[d * 6 + 1]!, box[d * 6 + 2]!, box[d * 6 + 3]!, box[d * 6 + 4]!, box[d * 6 + 5]!);
      const near = Math.hypot(Math.max(box[d * 6]!, -box[d * 6 + 3]!, 0), Math.max(box[d * 6 + 1]!, -box[d * 6 + 4]!, 0), Math.max(box[d * 6 + 2]!, -box[d * 6 + 5]!, 0));
      if (this.drawPack[d]! >= 0) {
        // A pack's mesh is drawn as any is, a draw for each of its materials, its vertices on the bones as a set's are.
        const before = p.drawCount, coarse = this.drawHow[d] === COARSE;
        this.put.nearAt = near;
        this.put.draw(this.drawPack[d]!, 0, TRANSIENT_BUFFER, this.drawCursor[d]! - this.drawPieces[d]!, this.drawPieces[d]!, coarse ? still : 0, 0, 0, DRAW_PLAIN | (coarse ? DRAW_SKINNED | DRAW_ONE_BONE : DRAW_SKINNED), passes);
        this.put.nearAt = 0;
        stats.draws += p.drawCount - before;
        continue;
      }
      const row = p.drawCount, copies = passes === BOTH ? 2 : 1;
      if (row + this.put.doubled + copies > MAX_DRAWS) {
        p.dropped++;
        continue;
      }
      const coarse = this.drawHow[d] === COARSE;
      this.put.nearOf[row] = near;
      this.put.passOf[row] = passes;
      p.drawMesh[row] = this.carrier;
      p.drawLod[row] = 0;
      p.drawSlot[row] = this.drawSlot[d]!;
      p.drawBuffer[row] = TRANSIENT_BUFFER;
      p.drawFirst[row] = this.drawCursor[d]! - this.drawPieces[d]!;
      p.drawInstances[row] = this.drawPieces[d]!;
      // A draw of pieces as one thing names the pose they stand in where another has its offset.
      p.drawOffset[row * 3] = coarse ? still : 0;
      p.drawOffset[row * 3 + 1] = 0;
      p.drawOffset[row * 3 + 2] = 0;
      p.drawFlags[row] = coarse ? DRAW_SKINNED | DRAW_ONE_BONE : DRAW_SKINNED;
      p.drawCount = row + 1;
      this.put.doubled += copies - 1;
      p.triangles += this.drawTriangles[d]! * this.drawPieces[d]! * copies;
      stats.draws++;
    }
    p.transientCount = total;
  }

  /** A prop and a species can share a mesh, so the lit palette policy groups instances by kind as well as mesh. */
  private entityBatch(cam: Camera, remote: RemoteSample, plain: boolean): void {
    const p = this.packet;
    this.counts.fill(0);
    let visible = 0;
    const bodies = this.characters;
    for (let i = 0; i < remote.count; i++) {
      if (p.lit && this.speciesKind[remote.kind[i]!] !== Number(plain)) continue;
      // A cloud has no mesh of its own: it is puffs among the details (clouds.ts).
      if (bodies.has(remote.kind[i]!) || this.pitched[remote.kind[i]!] !== 0 || this.clouds.kinds[remote.kind[i]!] !== 0 || remote.kind[i] === this.capsuleKind || this.dropped.flying(remote.kind[i]!, remote.anim[i]!)) continue;
      // A bag of one stack is drawn as its item, where the item has a lying mesh.
      const lies = this.dropped.item(remote.kind[i]!, remote.gear, i * GEAR_COUNT);
      const mesh = lies !== 0 ? this.dropped.mesh(lies) : this.meshOfKind[remote.kind[i]!]!;
      const r = this.radiusOfMesh[mesh]!;
      // The mount the viewer rides is where its prediction has it, as its rider is drawn on it (bodies()).
      const mine = this.own !== null && remote.id[i] === this.skip;
      const x = (mine ? this.own!.x : remote.x[i]!) - cam.x;
      const y = (mine ? this.own!.y : remote.y[i]!) - cam.y;
      const z = (mine ? this.own!.z : remote.z[i]!) - cam.z;
      // Culled entries are left out of the counts. The second pass repeats the test.
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r) || this.hiding.hidesOver(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      this.tally(cam, mesh, x, y, z);
      visible++;
    }
    if (visible === 0) return;
    const total = this.drawTallied(cam, p.transientCount, plain ? DRAW_PLAIN : 0);
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      if (p.lit && this.speciesKind[kind] !== Number(plain)) continue;
      // A supply capsule is drawn from its drop, in pieces (supply-drops.ts), where the pack has its model.
      if (bodies.has(kind) || this.pitched[kind] !== 0 || this.clouds.kinds[kind] !== 0 || kind === this.capsuleKind || this.dropped.flying(kind, remote.anim[i]!)) continue;
      const lies = this.dropped.item(kind, remote.gear, i * GEAR_COUNT);
      const mesh = lies !== 0 ? this.dropped.mesh(lies) : this.meshOfKind[kind]!;
      const r = this.radiusOfMesh[mesh]!;
      const mine = this.own !== null && remote.id[i] === this.skip;
      const x = (mine ? this.own!.x : remote.x[i]!) - cam.x;
      const y = (mine ? this.own!.y : remote.y[i]!) - cam.y;
      const z = (mine ? this.own!.z : remote.z[i]!) - cam.z;
      if (!cam.boxVisible(x - r, y - r, z - r, x + r, y + r, z + r) || this.hiding.hidesOver(x - r, y - r, z - r, x + r, y + r, z + r)) continue;
      const at = this.cursor[mesh]!++;
      const yaw = Math.round(((mine ? this.own!.yaw : remote.yaw[i]!) / (2 * Math.PI)) * 65536) & 0xffff;
      if (lies !== 0) this.transient.set(at, x, y, z, this.dropped.yaw(remote.id[i]!, yaw), this.dropped.colorOf(lies));
      else this.transient.set(at, x, y, z, yaw, this.colorOfKind[kind]!);
      this.transient.regions(at, remote.colors, i * 6);
      p.transientIds[at] = remote.id[i]!;
    }
    p.transientCount = total;
  }

  /** Counts an instance of `mesh` that is (x, y, z) from the camera, and keeps how near the nearest of them is and how far along the view they lie. */
  private tally(cam: Camera, mesh: number, x: number, y: number, z: number): void {
    const far = x * x + y * y + z * z;
    const along = cam.depth(x, y, z);
    const r = this.radiusOfMesh[mesh]!;
    if (this.counts[mesh] === 0) { this.nearest[mesh] = far; this.from[mesh] = along - r; this.to[mesh] = along + r; }
    else {
      if (far < this.nearest[mesh]!) this.nearest[mesh] = far;
      if (along - r < this.from[mesh]!) this.from[mesh] = along - r;
      if (along + r > this.to[mesh]!) this.to[mesh] = along + r;
    }
    this.counts[mesh]!++;
  }

  /**
   * Draws what was tallied, the instances of each mesh together, from transient instance `total` on. Returns where
   * they end. With `levels`, each mesh's are drawn at the level the nearest point of the nearest asks for, which it
   * keeps there; otherwise at their finest however far off, so only their materials are told how near they are.
   * `pieces` gives a mesh's draw its DRAW_PIECE flag.
   */
  private drawTallied(cam: Camera, total: number, flags = 0, levels: Int8Array | null = null, pieces: Uint32Array | null = null): number {
    const counts = this.counts;
    for (let m = 0; m < counts.length; m++) {
      this.cursor[m] = total;
      if (counts[m]! > 0) {
        const near = levels ? Math.max(0, Math.sqrt(this.nearest[m]!) - this.radiusOfMesh[m]!) : Math.sqrt(this.nearest[m]!);
        const level = levels ? (levels[m] = this.assets.choose(this.assets.table.error[m]!, near, levels[m]!)) : 0;
        if (levels) this.assets.wantTextured(m, level, near);
        else showMaterials(this.assets, m, near);
        this.put.nearAt = near;
        this.put.draw(m, level, TRANSIENT_BUFFER, total, counts[m]!, 0, 0, 0, pieces ? flags | pieces[m]! : flags, cam.passesOf(this.from[m]!, this.to[m]!));
      }
      total += counts[m]!;
    }
    this.put.nearAt = 0;
    return total;
  }
}
