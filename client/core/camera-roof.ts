import type { CameraBody } from "./camera-body.ts";
// Anticipate complete overhead faces along the camera boom. Ordinary casts still constrain the final placement.
import { capsuleBox, capsuleFree, groundUnder, push, type CollisionWorld } from "../../shared/world/collide.ts";
import { Found } from "../../shared/world/structures.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { castWorld, rayHit, HIT_NONE } from "../../shared/world/ray.ts";
import { Solid, partSolid } from "../../shared/world/convex.ts";
import { triangleEnvelope, result as triangleResult } from "./camera-roof-triangle.ts";

const found = new Found(256), solid = new Solid();
let witnessX = 0, witnessZ = 0;

function pointBox2(x: number, z: number, hx: number, hz: number): number {
  const dx = Math.max(0, Math.abs(x) - hx), dz = Math.max(0, Math.abs(z) - hz);
  return dx * dx + dz * dz;
}

function cornerSegment2(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
  const t = l > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
  const ex = x - ax - t * dx, ez = z - az - t * dz;
  return ex * ex + ez * ez;
}

/** Squared distance to an oriented box's local horizontal rectangle, retaining a closest point on that rectangle. */
function segmentBox2(ax: number, az: number, bx: number, bz: number, hx: number, hz: number): number {
  let lo = 0, hi = 1;
  const dx = bx - ax, dz = bz - az;
  if (dx === 0) { if (ax < -hx || ax > hx) hi = -1; }
  else {
    let a = (-hx - ax) / dx, b = (hx - ax) / dx;
    if (a > b) { const t = a; a = b; b = t; }
    lo = Math.max(lo, a); hi = Math.min(hi, b);
  }
  if (dz === 0) { if (az < -hz || az > hz) hi = -1; }
  else {
    let a = (-hz - az) / dz, b = (hz - az) / dz;
    if (a > b) { const t = a; a = b; b = t; }
    lo = Math.max(lo, a); hi = Math.min(hi, b);
  }
  if (hi >= lo) { witnessX = ax + lo * dx; witnessZ = az + lo * dz; return 0; }
  let d = pointBox2(ax, az, hx, hz);
  witnessX = Math.max(-hx, Math.min(hx, ax)); witnessZ = Math.max(-hz, Math.min(hz, az));
  const db = pointBox2(bx, bz, hx, hz);
  if (db < d) { d = db; witnessX = Math.max(-hx, Math.min(hx, bx)); witnessZ = Math.max(-hz, Math.min(hz, bz)); }
  for (let i = 0; i < 4; i++) {
    const x = i & 1 ? hx : -hx, z = i & 2 ? hz : -hz, q = cornerSegment2(x, z, ax, az, bx, bz);
    if (q < d) { d = q; witnessX = x; witnessZ = z; }
  }
  return d;
}

function capTriangle(w: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number, boomAX: number, boomAZ: number, boomBX: number, boomBZ: number,
  baseY: number, maxY: number, padding: number, minRoofY: number, blend: number, range2: number, groundOffset?: number): number {
  const minY = Math.min(ay, by, cy);
  if (minY < minRoofY || minY - padding >= maxY + blend) return Infinity;
  const k = (maxY - minY + padding + blend) / range2;
  const score = triangleEnvelope(ax, ay, az, bx, by, bz, cx, cy, cz, boomAX, boomAZ, boomBX, boomBZ, k) - padding;
  if (score >= maxY + blend) return Infinity;
  const qx = triangleResult[1]!, qy = triangleResult[2]!, qz = triangleResult[3]!;
  if (groundOffset !== undefined) baseY = w.hf.heightAt(qx, qz) + groundOffset;
  if (baseY >= qy || castWorld(w, qx, baseY, qz, 0, 1, 0, qy - baseY + .001, true) === HIT_NONE ||
    rayHit.ny >= -1e-6 || Math.abs(baseY + rayHit.t - qy) > .001) return Infinity;
  return score;
}

/** Synchronous result. The radius encloses the coarse world near rectangle used for this route. */
const roofRoute = { ceiling: Infinity, padding: 0, crest: -Infinity, shiftX: 0, shiftZ: 0 };

/** Guide the anchor out through the high edge of a pitched part; its boom can then pass above the crest. */
function aroundHighEdge(ax: number, az: number, bx: number, bz: number, focusX: number, focusZ: number,
  gx: number, gz: number, rise: number, padding: number, climb: number): void {
  const length = Math.hypot(gx, gz);
  if (length < 1e-7) return;
  const nx = gx / length, nz = gz / length;
  let edge = -Infinity, left = Infinity, right = -Infinity, top = -Infinity;
  for (let j = 0; j < solid.corners * 3; j += 3) {
    const x = solid.at[j]!, z = solid.at[j + 2]!, along = nz * x - nx * z;
    edge = Math.max(edge, nx * x + nz * z);
    left = Math.min(left, along); right = Math.max(right, along); top = Math.max(top, solid.at[j + 1]!);
  }
  const frontA = nx * ax + nz * az - edge, frontB = nx * bx + nz * bz - edge;
  // A mount approaching from the buried, low end cannot reach this exit through its own standing volume.
  if (-frontA > rise + padding) return;
  const side = nz * focusX - nx * focusZ, gap = Math.max(0, left - side - padding, side - right - padding);
  const curve = .5 / Math.max(padding, climb / 3);
  const front = nx * focusX + nz * focusZ - edge;
  const shift = Math.max(0, padding + .002 - front - curve * gap * gap);
  const sideB = nz * bx - nx * bz, mid = (left + right) / 2;
  const distance = Math.sqrt(segmentBox2(side - mid, front + shift, sideB - mid, frontB, (right - left) / 2, 0));
  const away = Math.max(0, distance - padding);
  roofRoute.crest = Math.max(roofRoute.crest, top + padding + .002 - curve * away * away);
  if (shift > Math.hypot(roofRoute.shiftX, roofRoute.shiftZ)) {
    roofRoute.shiftX = nx * shift;
    roofRoute.shiftZ = nz * shift;
  }
}

/** Evaluate the complete exposed underside and its approach along the boom. */
export function roofEnvelope(w: CollisionWorld, ax: number, az: number, bx: number, bz: number, baseY: number,
  maxY: number, padding: number, minRoofY: number, blend: number, minimumPadding: number, baseOffset: number, focusX: number, focusZ: number): Readonly<typeof roofRoute> {
  // Curvature <= 1/(2*padding) preserves the sphere at underside edges; slope <= 2 limits the rate of descent.
  // High overhead views start lowering earlier. Ordinary chase views retain four metres of approach.
  const delta = Math.max(0, maxY - minRoofY + padding + blend);
  const range = Math.max(4, Math.sqrt(2 * padding * delta), delta), range2 = range * range;
  const partialDelta = Math.max(delta, maxY - baseY + padding + 2 * blend);
  roofRoute.padding = padding; roofRoute.crest = -Infinity; roofRoute.shiftX = roofRoute.shiftZ = 0;
  // Terrain under the sloped face stays fixed as the rider climbs nearby. Preserve the rider's height above
  // terrain so a mount on an upper floor cannot choose the lower storey's passage.
  const groundOffset = baseY - w.hf.heightAt(ax, az);
  const queryRange = Math.max(4, Math.sqrt(2 * padding * partialDelta), partialDelta);
  let ceiling = Infinity;
  for (let pass = 0; pass < 2; pass++) {
    const store = pass === 0 ? w.structs : w.nodes;
    if (!store) continue;
    const n = store.query(Math.min(ax, bx) - queryRange, Math.min(az, bz) - queryRange,
      Math.max(ax, bx) + queryRange, Math.max(az, bz) + queryRange, found, baseY, maxY + padding + blend);
    for (let i = 0; i < n; i++) {
      const ref = found.refs[i]!, table = store.chunks[Math.floor(ref / 65536)]!, slot = ref & 65535, kind = table.kind[slot]!;
      if (store.isSoft(kind)) continue;
      frameOf(table.yaw[slot]!);
      const c = frame.cos, s = frame.sin, stretch = frame.stretch, shrink = 1 / stretch;
      const ax0 = ax - table.x[slot]!, az0 = az - table.z[slot]!, bx0 = bx - table.x[slot]!, bz0 = bz - table.z[slot]!;
      const aX = (c * ax0 - s * az0) * shrink, aZ = (s * ax0 + c * az0) * shrink;
      const bX = (c * bx0 - s * bz0) * shrink, bZ = (s * bx0 + c * bz0) * shrink, box = store.parts.box;
      for (let p = store.parts.start[kind]! * 6, end = store.parts.start[kind + 1]! * 6; p < end; p += 6) {
        const under = table.y[slot]! + box[p + 1]! - box[p + 4]!;
        if (under < minRoofY || under - padding >= maxY + blend) continue;
        const d2 = segmentBox2(aX - box[p]!, aZ - box[p + 2]!, bX - box[p]!, bZ - box[p + 2]!, box[p + 3]!, box[p + 5]!) * stretch * stretch;
        if (d2 >= range2) continue;
        const wx = (witnessX + box[p]!) * stretch, wz = (witnessZ + box[p + 2]!) * stretch;
        const qx = table.x[slot]! + c * wx + s * wz, qz = table.z[slot]! - s * wx + c * wz;
        // The bottom of an upper wall segment is not an accessible ceiling: the lower segment hides it.
        if (castWorld(w, qx, baseY, qz, 0, 1, 0, under - baseY + .001, true) === HIT_NONE ||
          rayHit.ny > -.5 || Math.abs(baseY + rayHit.t - under) > .001) continue;
        ceiling = Math.min(ceiling, under - padding + (maxY - under + padding + blend) * d2 / range2);
      }
      const hulls = store.parts.hulls;
      if (!hulls) continue;
      for (let p = hulls.start[kind]!, end = hulls.start[kind + 1]!; p < end; p++) {
        partSolid(hulls, p, table.yaw[slot]!, table.x[slot]!, table.y[slot]!, table.z[slot]!, solid);
        for (let f = hulls.face[p]!, end = hulls.face[p + 1]!; f < end; f++) {
          const at = solid.at, triangle = f * 3, i0 = hulls.faceCorners[triangle]! * 3;
          const i1 = hulls.faceCorners[triangle + 1]! * 3, i2 = hulls.faceCorners[triangle + 2]! * 3;
          const ux = at[i1]! - at[i0]!, uz = at[i1 + 2]! - at[i0 + 2]!;
          const vx = at[i2]! - at[i0]!, vz = at[i2 + 2]! - at[i0 + 2]!;
          if (uz * vx - ux * vz >= -1e-9) continue; // Upward and vertical faces cannot form a ceiling.
          const start = hulls.ring[f]!, stop = hulls.ring[f + 1]!, a = hulls.ringCorners[start]! * 3;
          let minFaceY = Infinity, maxFaceY = -Infinity, lipFloor = -Infinity, highFloor = Infinity, highRoom = -Infinity;
          for (let j = start; j < stop; j++) {
            const corner = hulls.ringCorners[j]! * 3, y = at[corner + 1]!;
            const floor = w.hf.heightAt(at[corner]!, at[corner + 2]!) + groundOffset;
            highRoom = Math.max(highRoom, y - floor);
            if (y <= minFaceY) lipFloor = y < minFaceY ? floor : Math.max(lipFloor, floor);
            if (y >= maxFaceY) highFloor = y > maxFaceY ? floor : Math.min(highFloor, floor);
            minFaceY = Math.min(minFaceY, y); maxFaceY = Math.max(maxFaceY, y);
          }
          // Reserve the full rendered near rectangle and a margin along an exposed low lip. A ramp that meets
          // the floor keeps ordinary obstruction handling. The mount must also fit on the high side.
          const lipGap = minFaceY - lipFloor;
          const facePadding = Math.min(padding, Math.max(minimumPadding, (lipGap - .02) / 2));
          if (lipGap < .07 || lipGap + baseOffset < 2 * facePadding + .02) {
            // Rising ground can seal the low lip while the high side still admits a standing mount.
            if (lipFloor > highFloor + .02 && highRoom >= minRoofY - baseY) {
              const uy = at[i1 + 1]! - at[i0 + 1]!, vy = at[i2 + 1]! - at[i0 + 1]!;
              aroundHighEdge(ax, az, bx, bz, focusX, focusZ, uy * vz - uz * vy, ux * vy - uy * vx,
                maxFaceY - minFaceY, padding, minRoofY - baseY);
            }
            continue;
          }
          const tight = facePadding < padding;
          if (tight ? highRoom < minRoofY - baseY : maxFaceY < minRoofY) continue;
          // Restore projection depth outside the height blend, while the boom is already clear.
          const outerBlend = tight ? 2 * blend : blend;
          let faceRange2 = range2;
          if (minFaceY < minRoofY) {
            const faceDelta = Math.max(0, maxY - minFaceY + facePadding + outerBlend);
            const faceRange = Math.max(4, Math.sqrt(2 * facePadding * faceDelta), faceDelta);
            faceRange2 = faceRange * faceRange;
          }
          for (let j = start + 1; j < stop - 1; j++) {
            const b = hulls.ringCorners[j]! * 3, c = hulls.ringCorners[j + 1]! * 3;
            const cap = capTriangle(w, at[a]!, at[a + 1]!, at[a + 2]!, at[b]!, at[b + 1]!, at[b + 2]!,
              at[c]!, at[c + 1]!, at[c + 2]!, ax, az, bx, bz, baseY, maxY, facePadding, minFaceY, outerBlend, faceRange2, tight ? groundOffset : undefined);
            ceiling = Math.min(ceiling, cap);
            if (tight && cap < maxY + outerBlend) {
              const t = Math.max(0, (cap - maxY - blend) / blend);
              roofRoute.padding = Math.min(roofRoute.padding, facePadding + (padding - facePadding) * t * t * (3 - 2 * t));
            }
          }
        }
      }
    }
  }
  roofRoute.ceiling = ceiling;
  return roofRoute;
}

/** Keep the full near rectangle clear when an oblique wall or roof grazes the end of a shortened boom. */
export function clearCameraContact(w: CollisionWorld, camera: { x: number; y: number; z: number }, body: CameraBody,
  anchorX: number, anchorY: number, anchorZ: number, targetX: number, targetY: number, targetZ: number, radius: number): void {
  const { x, y, z } = camera;
  // Beyond a low lip the boom can emerge over rising ground. Lift only to a clear, visible point.
  const floor = groundUnder(w.hf, x, z, radius) + radius + .002;
  if (y < floor && body.cast(x, floor, z, 0, 1, 0, .001, radius) > 0 &&
    capsuleFree(w, x, floor - radius, z, radius, 2 * radius)) {
    const dx = x - anchorX, dy = floor - anchorY, dz = z - anchorZ, reach = Math.hypot(dx, dy, dz);
    if (reach < 1e-6 || castWorld(w, anchorX, anchorY, anchorZ, dx / reach, dy / reach, dz / reach, reach) === HIT_NONE) {
      camera.y = floor;
      return;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const store = pass ? w.nodes : w.structs;
    if (!store) continue;
    const count = store.query(x - radius, z - radius, x + radius, z + radius, found, y - radius, y + radius);
    for (let i = 0; i < count; i++) {
      if (!capsuleBox(store, found.refs[i]!, x, y - radius, z, radius, 2 * radius, .001)) continue;
      const nx = push.x / push.depth, ny = push.y / push.depth, nz = push.z / push.depth;
      const safeX = x + push.x + .002 * nx, safeY = y + push.y + .002 * ny, safeZ = z + push.z + .002 * nz;
      // When a plate occupies the closest clear point, slide the remaining boom along the obstacle's face.
      const tx = targetX - safeX, ty = targetY - safeY, tz = targetZ - safeZ;
      const into = Math.min(0, tx * nx + ty * ny + tz * nz);
      for (let step = 0; step <= 8; step++) {
        const t = step / 8;
        const cx = safeX + t * (tx - into * nx), cy = safeY + t * (ty - into * ny), cz = safeZ + t * (tz - into * nz);
        if (body.cast(cx, cy, cz, 0, 1, 0, .001, radius) === 0 || !capsuleFree(w, cx, cy - radius, cz, radius, 2 * radius)) continue;
        const dx = cx - anchorX, dy = cy - anchorY, dz = cz - anchorZ, reach = Math.hypot(dx, dy, dz);
        if (reach > 1e-6 && castWorld(w, anchorX, anchorY, anchorZ, dx / reach, dy / reach, dz / reach, reach) !== HIT_NONE) continue;
        camera.x = cx; camera.y = cy; camera.z = cz;
        return;
      }
    }
  }
}
