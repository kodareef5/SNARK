// Loose things: the entities that are one mesh each and no body (a bag, a prop, a thing thrown and come to rest), and the
// pieces of a structure falling after a removal. The instances of each mesh are counted, then written together, a draw a mesh.

import type { Registry } from "../../../../shared/content/registry.ts";
import { GEAR_COUNT } from "../../../../shared/sim/entities.ts";
import type { Assets } from "../../assets/assets.ts";
import type { Falling } from "../../rubble.ts";
import type { RemoteSample } from "../../session.ts";
import type { Camera } from "../camera.ts";
import { showMaterials, type Characters } from "../characters.ts";
import type { Clouds } from "../clouds.ts";
import type { Draws } from "../draws.ts";
import type { Dropped } from "../dropped.ts";
import type { Hiding } from "../hide.ts";
import { DRAW_PLAIN, TRANSIENT_BUFFER, type FramePacket, type InstanceWriter } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import type { OwnBody } from "../scene.ts";

/** What the pass reads of the scene: its tables by kind, and who draws the kinds it leaves out. */
export interface LooseLooks {
  readonly meshOfKind: Uint16Array;
  readonly colorOfKind: Uint8Array;
  /** 1 for kinds drawn with their pitch, which the bodies' pass draws on a bone. */
  readonly pitched: Uint8Array;
  /** The kind of the supply capsule's prop where the pack has its model, which the supply drops' pass draws, or -1. */
  readonly capsuleKind: number;
  readonly characters: Characters;
  readonly clouds: Clouds;
  readonly dropped: Dropped;
}

export class LooseEntities implements Pass {
  /** Structures falling after a removal. The app sets it (Scene.falling). */
  falling: Falling | null = null;
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
  private readonly pitched: Uint8Array;
  private readonly capsuleKind: number;
  private readonly characters: Characters;
  private readonly clouds: Clouds;
  private readonly dropped: Dropped;
  /** The falling pieces: a row of the frame's list after the bodies. */
  readonly rubble: Pass = {
    draw: (f) => {
      if (this.falling && this.falling.count > 0) this.showFalling(f.cam, this.falling);
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

  private showFalling(cam: Camera, f: Falling): void {
    const p = this.packet;
    this.counts.fill(0);
    for (let i = 0; i < f.count; i++) this.tally(cam, this.meshOfKind[f.kind[i]!]!, f.x[i]! - cam.x, f.y[i]! - cam.y, f.z[i]! - cam.z);
    const total = this.drawTallied(cam, p.transientCount, 0, this.fallLevel);
    for (let i = 0; i < f.count; i++) {
      const kind = f.kind[i]!;
      const at = this.cursor[this.meshOfKind[kind]!]!++;
      this.transient.set(at, f.x[i]! - cam.x, f.y[i]! - cam.y, f.z[i]! - cam.z, f.yaw[i]!, this.colorOfKind[kind]!);
      p.transientIds[at] = 0;
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
      // A supply capsule is drawn from its drop, in pieces (showSupply), where the pack has its model.
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
   */
  private drawTallied(cam: Camera, total: number, flags = 0, levels: Int8Array | null = null): number {
    const counts = this.counts;
    for (let m = 0; m < counts.length; m++) {
      this.cursor[m] = total;
      if (counts[m]! > 0) {
        const near = levels ? Math.max(0, Math.sqrt(this.nearest[m]!) - this.radiusOfMesh[m]!) : Math.sqrt(this.nearest[m]!);
        const level = levels ? (levels[m] = this.assets.choose(this.assets.table.error[m]!, near, levels[m]!)) : 0;
        if (levels) this.assets.wantTextured(m, level, near);
        else showMaterials(this.assets, m, near);
        this.put.nearAt = near;
        this.put.draw(m, level, TRANSIENT_BUFFER, total, counts[m]!, 0, 0, 0, flags, cam.passesOf(this.from[m]!, this.to[m]!));
      }
      total += counts[m]!;
    }
    this.put.nearAt = 0;
    return total;
  }
}
