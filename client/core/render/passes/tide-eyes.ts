// The tide eyes: the map's three great instruments (shared/world/tide-eye.ts), each a deck, a tower of one of three forms,
// and the mechanism that opens on its clock. What they put in the sky is the frame block's (../tide-eye.ts writeEyeSky).

import { CROWN_ORIGIN, DECK_RADIUS, EYE_DYE, KEEL, LANTERN_BANKS, LENS_HEIGHT, SEXTANT_PIVOT } from "../../../../shared/world/tide-eye.ts";
import { SIZE_UNITS } from "../../../../shared/world/nodes.ts";
import type { Assets } from "../../assets/assets.ts";
import { BONE_FLOATS, DRAW_EMISSIVE, DRAW_PLAIN, DRAW_SIZED, DRAW_SKINNED, DRAW_SKYLINE, MAX_BONES, MAX_DRAWS, TRANSIENT_BUFFER } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import { aperture, eyePhase, eyePower, shutterOpening } from "../tide-eye.ts";

/** A slat of a lantern's shutters: how far out from the tower's middle it hangs, and its width as a share of the widest. */
interface Slat {
  depth: number;
  width: number;
}

export class TideEyes implements Pass {
  /** Seconds on the shared server clock, independent of the local frame clock. The app sets it (Scene.eyeSeconds). */
  seconds = 0;
  /** Additional instrument rotation for a directed scene, in radians. */
  indexOffset = 0;
  /** Directed shots can enlarge the sextant above its fixed keel. Map views use the authored dimensions. */
  sextantScale = 1;
  /** A directed scene's display held at full power on a clock of its own: seconds that only run forward (tide-eye.ts writeEyeSky). */
  hold: number | null = null;
  private readonly eye: { crown: number; deck: number; iris: number; glow: number; light: number; deckLight: number };
  private readonly lantern: { frame: number; shutter: number; lip: number; light: number; masts: number };
  private readonly sextant: { frame: number; needle: number; indexLight: number; keelLight: number };
  /** The frame being drawn and the site: its place from the camera, its heading's cosine and sine, its dye and its yaw. */
  private f!: Frame;
  private x = 0;
  private y = 0;
  private z = 0;
  private cs = 1;
  private sn = 0;
  private dye = 0;
  private yaw = 0;

  constructor(assets: Assets) {
    const eye = (part: string): number => assets.table.find("core:tide_eye/" + part);
    this.eye = { crown: eye("crown"), deck: eye("deck"), iris: eye("iris"), glow: eye("glow"), light: eye("crown_light"), deckLight: eye("deck_light") };
    this.lantern = { frame: eye("lantern"), shutter: eye("shutter"), lip: eye("shutter_light"), light: eye("well_light"), masts: eye("mast_light") };
    this.sextant = { frame: eye("sextant"), needle: eye("needle"), indexLight: eye("index_light"), keelLight: eye("keel_light") };
  }

  draw(f: Frame): void {
    const sites = f.world.tideEyes;
    if (!sites) return;
    this.f = f;
    const cam = f.cam;
    for (const site of sites) {
      const x = site.x - cam.x, y = site.y - cam.y, z = site.z - cam.z;
      const yaw = site.yaw * Math.PI / 32768, cs = Math.cos(yaw), sn = Math.sin(yaw);
      const phase = eyePhase(this.seconds, site), open = aperture(phase);
      const dye = site.form === "lantern" && site.color === "green" ? 51 : EYE_DYE[site.color];
      this.x = x;
      this.y = y;
      this.z = z;
      this.cs = cs;
      this.sn = sn;
      this.dye = dye;
      this.yaw = site.yaw;
      this.piece(this.eye.deck, 0, site.radius + 1, site.radius / DECK_RADIUS);
      if (open > 0) this.piece(this.eye.deckLight, 0, site.radius + 1, site.radius / DECK_RADIUS, 0, -1, true);
      if (site.form === "lantern") {
        this.piece(this.lantern.frame, CROWN_ORIGIN, 235, 1);
        if (open > 0) this.piece(this.lantern.masts, CROWN_ORIGIN, 240, 1, 0, -1, true);
        for (let i = 0; i < LANTERN_BANKS.length; i++) {
          const bank = LANTERN_BANKS[i]!, opened = shutterOpening(phase, i);
          for (let j = 0; j < bank.slats.length; j++) {
            const shutter = bank.slats[j]!, reach = 52 * shutter.width + 15, tilt = -1.34 * opened;
            this.piece(this.lantern.shutter, shutter.h, reach, 1, 0, -1, false, shutter, tilt);
            if (opened > 0.05 && j % 2 === 0) this.piece(this.lantern.lip, shutter.h, reach, 1, 0, -1, true, shutter, tilt);
          }
          if (opened > 0.10) {
            const size = (bank.radius + 4) / 10 * opened;
            this.piece(this.lantern.light, bank.well, 12 * size, size, 0, -1, true);
          }
        }
        continue;
      }
      if (site.form === "sextant") {
        // The index is authored hanging down. After lifting it sweeps the bow and locks on the upper mark.
        const angle = this.indexOffset - open * (1.82 + 0.13 * eyePower(phase) * Math.sin((phase - 9) * 0.64));
        const scale = this.sextantScale, origin = KEEL + (CROWN_ORIGIN - KEEL) * scale;
        const pivot = KEEL + (SEXTANT_PIVOT - KEEL) * scale;
        this.piece(this.sextant.frame, origin, 221 * scale, scale);
        this.piece(this.sextant.needle, pivot, 157 * scale, scale, angle);
        if (open > 0) {
          this.piece(this.sextant.keelLight, origin, 202 * scale, scale, 0, -1, true);
          this.piece(this.sextant.indexLight, pivot, 157 * scale, scale, angle, -1, true);
        }
        continue;
      }
      this.piece(this.eye.crown, CROWN_ORIGIN, 211, 1);
      if (open < 0.998) {
        for (let i = 0; i < 12; i++) {
          const bearing = i * Math.PI / 6;
          this.piece(this.eye.iris, LENS_HEIGHT, 36, 1 - 0.94 * open, bearing + open * 0.88, bearing);
        }
      }
      if (open > 0) {
        this.piece(this.eye.glow, LENS_HEIGHT, 46, 1, phase * 0.045 + eyePower(phase) * 0.7, -1, true);
        this.piece(this.eye.light, CROWN_ORIGIN, 216, 1, 0, -1, true);
      }
    }
  }

  /**
   * One piece of the site, its origin `h` over the site's and reaching `r`, at `scale`: turned by `roll`, hung from the
   * hinge at bearing `hinge` (none under 0), lit (`glow`), or a lantern's `shutter` tilted by `tilt`.
   */
  private piece(mesh: number, h: number, r: number, scale: number, roll = 0, hinge = -1, glow = false, shutter: Slat | undefined = undefined, tilt = 0): void {
    if (mesh < 0) return;
    const f = this.f, p = f.packet, cam = f.cam;
    const x = this.x, y = this.y, z = this.z, cs = this.cs, sn = this.sn, dye = this.dye;
    const depth = shutter?.depth ?? 0;
    const radial = hinge < 0 ? 0 : 33 * Math.cos(hinge);
    const cx = x + radial * cs + depth * sn;
    const cy = y + h + (hinge < 0 ? 0 : 33 * Math.sin(hinge));
    const cz = z - radial * sn + depth * cs;
    if (!cam.boxVisible(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r)) return;
    if (p.transientCount >= p.transientIds.length || p.drawCount + f.put.doubled >= MAX_DRAWS) return;
    const articulated = hinge >= 0 || roll !== 0 || shutter !== undefined || scale > 255 / SIZE_UNITS;
    if (articulated && p.boneCount >= Math.min(p.tier.bones, MAX_BONES)) return;
    const first = p.transientCount++;
    const distance = Math.max(1, Math.hypot(cx, cy, cz) - r);
    const errors = f.assets.table.error[mesh]!;
    const skyline = distance >= 2100 && (mesh === this.eye.crown || mesh === this.eye.iris || mesh === this.sextant.frame || mesh === this.sextant.needle || mesh === this.lantern.frame || mesh === this.lantern.shutter);
    const level = skyline && scale === 1 ? Math.max(0, errors.length - 1) : f.assets.choose(errors, distance / Math.max(0.03, scale), -1);
    if (skyline) f.assets.want(mesh, level, distance);
    else f.assets.wantTextured(mesh, level, distance);
    let flags = DRAW_PLAIN | (glow ? DRAW_EMISSIVE : 0) | (skyline ? DRAW_SKYLINE : 0);
    if (articulated) {
      const bone = p.boneCount++;
      const pose = p.bones, row = bone * BONE_FLOATS;
      if (shutter) {
        // Turn about the spanwise axle, then turn the whole tower to its map heading.
        const pitch = tilt, c = Math.cos(pitch), s = Math.sin(pitch);
        pose[row] = cs * shutter.width; pose[row + 1] = sn * s; pose[row + 2] = sn * c;
        pose[row + 4] = 0; pose[row + 5] = c; pose[row + 6] = -s;
        pose[row + 8] = -sn * shutter.width; pose[row + 9] = cs * s; pose[row + 10] = cs * c;
      } else {
        const a = Math.cos(roll) * scale, b = Math.sin(roll) * scale;
        const depthScale = hinge >= 0 ? 1 : scale;
        pose[row] = cs * a; pose[row + 1] = -cs * b; pose[row + 2] = sn * depthScale;
        pose[row + 4] = b; pose[row + 5] = a; pose[row + 6] = 0;
        pose[row + 8] = -sn * a; pose[row + 9] = sn * b; pose[row + 10] = cs * depthScale;
      }
      pose[row + 3] = cx; pose[row + 7] = cy; pose[row + 11] = cz;
      f.transient.setSkinned(first, bone, dye);
      flags |= DRAW_SKINNED;
    } else {
      f.transient.set(first, cx, cy, cz, this.yaw, dye);
      if (scale !== 1) {
        f.transient.size(first, Math.round(scale * SIZE_UNITS));
        flags |= DRAW_SIZED;
      }
    }
    p.transientIds[first] = 0;
    const passes = cam.passes(cx - r, cy - r, cz - r, cx + r, cy + r, cz + r);
    f.put.draw(mesh, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, flags, passes);
  }
}
