import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { CreatureSounds, type Emit } from "../../client/core/sound/creatures.ts";
import { SoundLibrary } from "../../client/core/sound/library.ts";
import { Resolver } from "../../client/core/sound/resolve.ts";
import { bodyDown } from "../../client/core/sound/timing.ts";
import { AnimState, LAYER_FLINCH } from "../../shared/anim/pose.ts";
import type { DetailSheet } from "../../shared/pack/details.ts";
import { youngScale } from "../../shared/sim/breeding.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

for (const name of ["trike", "stego"]) {
  const species = `core:${name}`;
  const sheet: DetailSheet = { owner: species, cues: {
    struck: { sounds: ["hurt"], effects: [] },
    death: { sounds: name === "stego" ? ["death", { sound: "step", at: "down" }] : ["death"], effects: [] },
  } };

  test(`an observed ${name} retains its living voice scale at death and schedules each sound once`, () => {
    const h = new Harness({}, 1, 60, { map: writeMap(flatMap(2)) });
    try {
      const observer = h.join("listener"); h.run(600);
      const { reg, ents, hf } = h.world, kind = reg.index.get(species)!;
      const x = observer.own.x, z = observer.own.z;
      const ids = [h.host.spawnCreature(species, x - 7, z, 1), h.host.spawnCreature(species, x + 7, z, 1)];
      const records = ids.map(id => h.host.records.byPid.get(ents.pid[id]!)!);
      const juvenile = records[0]!;
      juvenile.span = 10000; juvenile.grown = h.world.tick + juvenile.span;
      ents.setYoung(ids[0]!, juvenile.span, juvenile.grown);
      for (const id of ids) h.host.creatures.mind.stay(id, 0xffffffff);

      const sounds = ["hurt", "step", "death"].map(key => ({ id: `${species}/sound/${key}`, range: 60, file: 0, at: 0, rate: 16000, vary: 0, takes: [] }));
      const lib = new SoundLibrary({ sounds }, null);
      const hearing = new CreatureSounds(reg, lib, new Resolver(lib.index), k => h.world.anims[k] ?? null, [sheet]);
      const remote = new RemoteSample(), heard: Parameters<Emit>[] = [];
      const listen = () => {
        observer.sampleRemote(remote);
        hearing.update(remote, hf, x, 0, z, (...play) => heard.push(play), () => {});
      };
      h.run(400); listen();

      // Supply the flinch layer on the wire even when this checkout has no flinch clip.
      const st = new AnimState(); st.layer = LAYER_FLINCH; st.layerStart = h.world.tick;
      for (const id of ids) { ents.cue[id] = st.packCue(); h.world.history.cued(id); }
      h.run(300); listen();
      const young = youngScale(reg.birthScale[kind]!, juvenile.span, juvenile.grown, remote.tick);
      expect(young).toBeLessThan(1);
      for (const rec of records) h.host.survival.hurt(rec, 1e6, 0);
      h.run(400); listen(); listen();
      const anim = h.world.anims[kind];
      const impactDelay = anim ? bodyDown(anim.rig, anim.death) : .6;
      for (const [i, id] of ids.entries()) {
        expect(remote.died.has(id)).toBe(true);
        const events = heard.filter(e => e[3] === id);
        expect(events.map(e => lib.sounds[e[0]]!.id)).toEqual([sounds[0]!.id, sounds[2]!.id, ...(name === "stego" ? [sounds[1]!.id] : [])]);
        const [hurt, death, impact] = events, scale = i === 0 ? young : 1;
        expect(death![7]).toBeCloseTo(reg.bodyHeight[kind]! * scale * .6, 7);
        expect(death![8]).toBeCloseTo(.5 + .5 * scale, 7);
        expect(death![9]).toBeCloseTo(1 / Math.sqrt(Math.max(.35, scale)), 7);
        expect(death![8]).toBe(hurt![8]); expect(death![9]).toBe(hurt![9]);
        expect(death![10]).toBe(0);
        if (impact) {
          expect(impact[7]).toBeCloseTo(.1 * scale, 7);
          expect(impact[8]).toBeCloseTo(.9 * hurt![8], 7); expect(impact[9]).toBe(hurt![9]);
          expect(impact[10]).toBeGreaterThan(0); expect(impact[10]).toBeCloseTo(impactDelay, 7);
        }
      }
    } finally { h.host.shutdown(); }
  });

  artTest(`the shipped ${name} detail sheet binds its hurt, death and ground-impact sounds`, () => {
    const native = corePack().header.details?.sheets.find(s => s.owner === species);
    expect(native?.cues.struck?.sounds).toEqual(sheet.cues.struck!.sounds);
    expect(native?.cues.death?.sounds).toEqual(sheet.cues.death!.sounds);
  });
}
