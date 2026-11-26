// A Cast civilian sent with a look is drawn as that look's body: a woman's look is the woman's meshes.

import { expect } from "bun:test";
import { LOOK_SEX } from "../../shared/anim/look.ts";
import { personFrom, populationsOf } from "../../shared/people/person.ts";
import { provingView } from "../../tools/snap.ts";
import { artTest } from "../fixtures/needs-art.ts";

artTest("a civilian with a look is drawn in its sex's body, and without one in the plain one", () => {
  const view = provingView(160, 90);
  const { remote, reg, cam } = view;
  remote.kind[0] = reg.index.get("core:civilian")!;
  cam.yaw = Math.atan2(remote.x[0]! - cam.x, remote.z[0]! - cam.z);
  const city = populationsOf(reg).list[populationsOf(reg).number.get("people:city")!]!;
  let seed = 1;
  while (personFrom(seed, city).sex !== 1) seed++;
  const bodies = (): string[] => {
    const p = view.render();
    const ids = new Set<string>();
    for (let d = 0; d < p.drawCount; d++) {
      const id = view.pack.header.meshes[p.drawMesh[d]!]?.id ?? "";
      if (/^core:human_[mf]\//.test(id)) ids.add(id.slice(0, 12));
    }
    return [...ids];
  };
  expect(bodies()).toEqual(["core:human_m"]);
  remote.hasLook[0] = 1;
  remote.look.set(personFrom(seed, city).look, 0);
  expect(remote.look[LOOK_SEX]).toBe(1);
  expect(bodies()).toEqual(["core:human_f"]);
});
