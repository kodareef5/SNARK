// Read-only snapshot of the repository renderer. Outputs stay in this folder.
import { skyFrame, theSky, domeLight } from "../../../../../../../../client/core/render/sky.ts";
import { FRAME, FRAME_FLOATS } from "../../../../../../../../client/core/render/packet.ts";
import { lit, tone, srgbToLinear, linearToSrgb } from "../../../../../../../../client/core/render/surface.ts";
const sky = theSky();
const out: any = { provenance: "client/core/render/{sky,surface,packet}.ts", hours: {} };
for (const hour of [10, 17]) {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, sky, frame);
  const state: any = { exposure: frame[FRAME.exposure] };
  for (const key of ['sun', 'sunColor', 'moon', 'moonColor', 'skyAbove', 'skyBelow', 'skySide', 'skySun', 'skyAlong'] as const)
    state[key] = Array.from(frame.slice(FRAME[key], FRAME[key] + 3));
  const table: number[][] = [];
  const sun = state.sun;
  const c = new Float64Array(3);
  for (let y = 0; y < 65; y++) for (let x = 0; x < 128; x++) {
    const theta = y / 64 * Math.PI, phi = x / 128 * 2 * Math.PI;
    const dir = [Math.sin(theta)*Math.cos(phi), Math.cos(theta), Math.sin(theta)*Math.sin(phi)];
    domeLight(sky.table, sun, dir, c);
    table.push(Array.from(c, v => v * frame[FRAME.skyScale]));
  }
  state.mirror_latlong = { width: 128, height: 65, rgb: table };
  state.probes = [];
  for (const n0 of [[0,0,1],[0,1,0],sun,[-sun[0],-sun[1],-sun[2]]] as number[][]) {
    const n: number[] = Array.from(n0), v = [0,0,1];
    const r = [2*n[2]*n[0], 2*n[2]*n[1], 2*n[2]*n[2]-1];
    domeLight(sky.table, sun, r, c);
    const mirror = Array.from(c,v => v*frame[FRAME.skyScale]);
    const base = [128,132,70];
    lit(c,base.map(v=>srgbToLinear(v/255)),[1,.95,0],n,v,frame,mirror);
    tone(c,Array.from(c,v=>v*frame[FRAME.exposure]));
    state.probes.push({normal:n,base,orm:[1,.95,0],shown:Array.from(c,v=>255*linearToSrgb(Math.max(0,Math.min(1,v))))});
  }
  out.hours[hour] = state;
}
await Bun.write(new URL('game_lighting.json', import.meta.url), JSON.stringify(out));
console.log('Captured actual renderer lighting for 10:00 and 17:00.');
