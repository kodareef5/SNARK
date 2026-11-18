// Aiming at what the renderer draws of a body: a ray through each pixel showing it finds its zone, in every pose and
// from every side. Apart from render.test.ts, whose frames it would wait behind, so the two run side by side.

import { expect, test } from "bun:test";
import { bodySeed } from "../../client/core/render/scene.ts";
import { HUMAN_ZONE_COUNT, ZONE_HEAD, ZONE_NAMES } from "../../shared/anim/human.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { rayBody, zoneOfBone } from "../../shared/anim/zones.ts";
import { STANCE_CROUCH, STANCE_PRONE } from "../../shared/sim/character.ts";
import { provingView } from "../../tools/snap.ts";
import { PICK_ENTITY, PICK_STRUCTURE } from "../../tools/snap/raster.ts";

test("aiming at what is drawn of a body hits it, in the zone drawn: in every pose, from every side", () => {
  const SIZE = 128;
  const view = provingView(SIZE, SIZE);
  const { raster, remote, cam } = view;
  const anim = view.scene.characters.anim;
  remote.count = 1;
  const id = remote.id[0]!;
  const bx = remote.x[0]!;
  const by = remote.y[0]!;
  const bz = remote.z[0]!;
  // drawn[z] counts pixels showing zone z, and agreed[z] those where a ray through the pixel finds zone z too.
  const drawn = new Uint32Array(HUMAN_ZONE_COUNT);
  const agreed = new Uint32Array(HUMAN_ZONE_COUNT);
  let phantom = 0;
  let empty = 0;
  let missed = 0;
  const st = new AnimState();
  const dir = [0, 0, 0];
  const states: readonly (readonly [speed: number, dirTo: number, pitch: number, mode: number, stance: number, grounded: boolean])[] = [
    [0, 0, 0, 1, 0, true], [7, 0, 0, 1, 0, true], [12, 0, 10, 1, 0, true], [7, 5, -12, 1, 0, true], [7, 8, 0, 1, 0, true],
    [0, 0, 0, 1, 0, false], [2, 0, 0, 1, STANCE_CROUCH, true], [1, 0, 8, 1, STANCE_PRONE, true], [4, 0, 14, 2, 0, false],
  ];
  let shot = 0;
  for (const [speed, dirTo, pitch, mode, stance, grounded] of states) {
    st.speed = speed;
    st.dir = dirTo;
    st.pitch = pitch;
    st.mode = mode;
    st.stance = stance;
    st.grounded = grounded;
    remote.anim[0] = st.pack();
    remote.flags[0] = grounded ? 1 : 0;
    st.seed = bodySeed(id);
    // From the front, a side, behind and above, at a different tick and facing each time.
    for (const [around, up] of [[0, 0.1], [1.4, 0.2], [3.3, 0.05], [4.6, 0.9], [0.7, -0.25]] as const) {
      const tick = shot * 7.3;
      const yawUnits = (shot * 9973) & 0xffc0; // a facing the 10-bit wire yaw can carry exactly
      shot++;
      remote.tick = tick;
      remote.yaw[0] = (yawUnits / 65536) * Math.PI * 2;
      const reach = 4;
      cam.x = bx + Math.sin(around) * Math.cos(up) * reach;
      cam.z = bz + Math.cos(around) * Math.cos(up) * reach;
      cam.y = by + 0.9 + Math.sin(up) * reach;
      cam.yaw = around + Math.PI;
      cam.pitch = -up;
      cam.fovY = 0.7;
      cam.aspect = 1;
      view.render();
      for (let py = 0; py < SIZE; py++) {
        for (let px = 0; px < SIZE; px++) {
          const at = py * SIZE + px;
          const isBody = raster.pickKind[at] === PICK_ENTITY && raster.pickId[at] === id;
          cam.ray((px + 0.5) / SIZE, (py + 0.5) / SIZE, dir);
          const hit = rayBody(anim, st, tick, bx, by, bz, yawUnits, cam.x, cam.y, cam.z, dir[0]!, dir[1]!, dir[2]!, 50);
          if (!isBody) {
            // No part of the body is drawn here, so a hit lands on thin air unless a structure is in front.
            if (hit !== 0 && raster.pickKind[at] !== PICK_STRUCTURE) phantom++;
            else empty++;
            continue;
          }
          const zone = zoneOfBone(raster.pickBone[at]! - 1);
          drawn[zone]!++;
          if (hit === zone) agreed[zone]!++;
          else if (hit === 0) missed++;
        }
      }
    }
  }
  let all = 0;
  let allAgreed = 0;
  for (let z = 1; z < HUMAN_ZONE_COUNT; z++) {
    all += drawn[z]!;
    allAgreed += agreed[z]!;
    // Every zone is seen, and a ray through its pixels mostly finds it. Each bone has one generous capsule, and where two
    // meet (a wrist, an ankle, an armpit) the nearer one wins, which accounts for the rest.
    expect(drawn[z]!).toBeGreaterThan(150);
    if (agreed[z]! / drawn[z]! < 0.78) throw new Error(`${ZONE_NAMES[z]}: only ${agreed[z]} of ${drawn[z]} drawn pixels are hit`);
  }
  // The head matters most. A ray through a drawn head must be a headshot.
  expect(agreed[ZONE_HEAD]! / drawn[ZONE_HEAD]!).toBeGreaterThan(0.965);
  expect(allAgreed / all).toBeGreaterThan(0.88);
  // Almost no drawn pixel misses every capsule, so aiming at the body hits the body.
  expect(missed / all).toBeLessThan(0.02);
  // The capsules are generous, so some hits land a little outside the drawn body, but not much more than its rim.
  expect(phantom / all).toBeLessThan(0.3);
  expect(empty).toBeGreaterThan(all);
});
