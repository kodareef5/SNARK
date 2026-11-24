// Evaluate the actual production finish functions with identical inputs on the GPU and software paths.
// With them, the ball an orb shows in what mirrors (client/core/render/orb-light.ts orbMirror), which streetMirror calls.
import { ORB_MIRROR_GLSL, ORB_SEEN, orbMirror } from "../../client/core/render/orb-light.ts";
import { FRAME_FLOATS, ORB_AT, ORB_LANES } from "../../client/core/render/packet.ts";
import { STREET_GLSL, WHEEL_FINISH_GLSL, fixtureFace, fixtureShader, rubberShare, tireRelief, weatherVehicle, wheelFinish } from "../../client/core/render/street-finish.ts";
import { VEHICLE_SHADE_GLSL, bodyOpen, tyreOpen } from "../../client/core/render/vehicle-shade.ts";
import { RawShot, type LitCheck } from "./shot.ts";

const vertex = `#version 300 es
in vec2 point;
void main() { gl_Position = vec4(point,0.0,1.0); }`;
const inputs = [
  // Metal, roughness, alloy mask, outboard position, radial Y and Z.
  [0.85,0.20,1,0.36,0.40,0.17], [165/255,122/255,0,0.36,0.52,0],
  [0.65,0.48,0,0.03,0.52,0], [0.02,0.84,0,0.30,0.845,0],
  [0.04,0.79,0,-0.32,0.65,0.70], [0.12,0.31,0,0.28,0.15,0.10],
  // Tread: on the worn middle, and on a groove's wall at the shoulder.
  [0.02,0.86,0,0.05,0.97,0.21], [0.03,0.80,0,0.27,0.088,0.973],
];
const cases = inputs.flatMap(([metal, rough, mask, x, y, z]) =>
  [0.12,0.72].flatMap(seed => [0,0.78,1].flatMap(age => [0.001,0.04].map(width =>
    ({ metal: metal!, rough: rough!, mask: mask!, x: x!, y: y!, z: z!, seed, age, width })))));
// A wheeled body's own shade, on the compact's rig and box: rest point, rest normal and how far the face looks down.
const rest = [0,0.6,0, 0.78,0.30,1.25, -0.78,0.30,1.25, 0.78,0.30,-1.25, -0.78,0.30,-1.25];
const wheels = 0b11110, center = [0,0.75,0], half = [0.9,0.75,2];
const bodies = [
  [-0.70,0.62,1.25, 0,-1,0, 1], [-0.84,0.30,1.62, 0,0,-1, 0], [-0.86,0.45,1.65, -1,0,0.2, 0],
  [-0.62,0.40,1.30, -1,0,0, 0], [0.10,0.18,0.0, 0,-1,0, 1], [-0.88,0.70,0.30, -1,0,0, 0],
  [0.74,0.58,-1.10, 0.2,-0.9,0.3, 0.9], [0.40,0.25,-1.35, 0,0.3,1, -0.3],
];
// A wheel's height above its hub, its offset out along the axle and its share of rubber.
const tyres = [[0.98,0,1], [0.7,0.32,1], [0.5,-0.33,1], [-0.9,0.1,1], [0.55,0.31,0], [0.2,-0.1,0.4]];
const num = (value: number) => Number.isInteger(value) ? value.toFixed(1) : String(value);
const vec = (values: readonly number[]) => `vec3(${values.map(num).join(",")})`;
const colors = [11,41,82,86,102,140,214,83];
const faces = [0,1,2,3,4].flatMap(kind => colors.flatMap(color => [-5.054,-3.754,0].map(z => ({kind,color,z}))));
const key = "street-finish-pairs";
const wheelPixels = cases.length * 3, facesAt = wheelPixels, shadesAt = facesAt + faces.length;
// An orb 200 m off and 30 m up, its screen's light a colour a pixel can hold, and mirrors looking at it and past it:
// where the mirror is, how far its ray is turned off the way to the ball's middle (radians), its roughness and its share.
const orb = [0, 30, 200, 78], seen = [0.9, 0.5, 0.2], behind = [0.1, 0.2, 0.3];
const mirrors = [[0, 0, 0], [20, 5, 60], [-300, 80, -900]].flatMap(([x, y, z]) =>
  [0, 0.2, 0.33, 0.36, 0.39, 0.45, 0.8, 3.1].flatMap((turn) => [[0.05, 1], [0.4, 1], [0.9, 0.6]].map(([rough, share]) => {
    const d = [orb[0]! - x!, orb[1]! - y!, orb[2]! - z!], far = Math.hypot(...d), to = d.map((v) => v / far), flat = Math.hypot(to[1]!, to[2]!), across = [0, -to[2]! / flat, to[1]! / flat];
    // Turned by a share of the angle the ball's outline is seen at there, so each place has rays in it, on it and past it.
    const angle = turn > 3 ? turn : (turn / 0.36) * Math.asin(orb[3]! / far);
    return { at: [x!, y!, z!], ray: to.map((v, c) => v * Math.cos(angle) + across[c]! * Math.sin(angle)), rough: rough!, share: share! };
  })));
const orbFrame = new Float32Array(FRAME_FLOATS);
orbFrame.set(orb, ORB_AT);
orbFrame.set([...seen, 1], ORB_SEEN);
const mirrorsAt = shadesAt + bodies.length + tyres.length;
const width = mirrorsAt + mirrors.length;

export const streetFinishCheck: LitCheck = {
  name: "Street material parity",
  shots: () => [],
  raws() {
    const branches = cases.map(({metal,rough,mask,x,y,z,seed,age,width}, i) =>
      `if (at / 3 == ${i}) { mro = vec3(0.86,${num(rough)},${num(metal)}); p = vec3(${num(x)},${num(y)},${num(z)}); mask = ${num(mask)}; seed = ${num(seed)}; age = ${num(age)}; footprint = ${num(width)}; }`);
    const shades = [
      ...bodies.map((b, i) => `if (k == ${i}) own = bodyOpen(${vec(b.slice(0,3))},${vec(b.slice(3,6))},${num(b[6]!)});`),
      ...tyres.map(([up, out, rubber], i) => `if (k == ${bodies.length + i}) own = tyreOpen(${num(up!)},${num(out!)},${num(rubber!)});`),
    ];
    const fragment = `#version 300 es
precision highp float;
precision highp int;
const vec4 fStreetLook = vec4(0.0);
const vec4 fOrb[${ORB_LANES}] = vec4[${ORB_LANES}](${Array.from({ length: ORB_LANES }, (_, lane) => `vec4(${[0, 1, 2, 3].map((k) => num(orbFrame[ORB_AT + lane * 4 + k]!)).join(",")})`).join(",")});
${ORB_MIRROR_GLSL}
const vec3 uWheelCenters[32] = vec3[32](${Array.from({ length: 32 }, (_, i) => vec(i < 5 ? rest.slice(i*3, i*3+3) : [0,0,0])).join(",")});
const highp uint uWheelBones = ${wheels}u;
const vec3 uCenter = ${vec(center)}, uHalf = ${vec(half)};
${STREET_GLSL}
${WHEEL_FINISH_GLSL}
${VEHICLE_SHADE_GLSL}
${fixtureShader()}
out vec4 color;
void main() {
  int at = int(gl_FragCoord.x);
  vec3 base = vec3(0.18,0.2,0.22), mro = vec3(0.0), p = vec3(0.0);
  float seed = 0.0, age = 0.0, footprint = 0.0, mask = 0.0;
  ${branches.join("\n")}
  if (at < ${wheelPixels}) {
    if (age > 0.0) weatherVehicle(base,mro,p,seed,age,age == 1.0);
    float rubber = rubberShare(mro,length(p.yz));
    vec3 relief = tireRelief(p,footprint);
    float chrome = wheelFinish(base,mro,mask,rubber,1.0,p,seed,footprint,p.x);
    color = vec4(at % 3 == 0 ? base : at % 3 == 1 ? vec3(mro.gb,chrome) : 0.5+0.25*relief,1.0);
  } else if (at < ${shadesAt}) {
    int sampleId = at - ${facesAt};
    const uint pigments[8] = uint[8](${colors.map(c => c+"u").join(",")});
    const float zs[3] = float[3](-5.054,-3.754,0.0);
    int face = fixtureFace(sampleId / 24,pigments[(sampleId / 3) % 8],vec3(0,0.7,zs[sampleId % 3]));
    color = vec4(vec3(float(face)/8.0),1.0);
  } else if (at < ${mirrorsAt}) {
    int k = at - ${shadesAt};
    float own = 0.0;
    ${shades.join("\n    ")}
    color = vec4(vec3(own),1.0);
  } else {
    int k = at - ${mirrorsAt};
    vec3 shows = vec3(0.0);
    ${mirrors.map((m, i) => `if (k == ${i}) shows = orbMirror(${vec(behind)},${vec(m.ray)},${vec(m.at)},${num(m.rough)},${num(m.share)});`).join("\n    ")}
    color = vec4(shows,1.0);
  }
}`;
    return [new RawShot(key,width,1,vertex,fragment,[["point",2]],Float32Array.of(-1,-1,3,-1,-1,3),{},[])];
  },
  judge(back) {
    const pixels = back.pixels(key,0)!;
    let peak = 0;
    const check = (i: number, value: number) => { peak = Math.max(peak,Math.abs(pixels[i]!-Math.round(255*Math.max(0,Math.min(1,value))))); };
    const relief = new Float64Array(3);
    cases.forEach(({metal,rough,mask,x,y,z,seed,age,width}, i) => {
      const base = Float64Array.of(0.18,0.2,0.22), orm = Float64Array.of(0.86,rough,metal);
      if (age) weatherVehicle(base,orm,x,y,z,seed,age,age === 1);
      const rubber = rubberShare(orm[2]!,orm[1]!,Math.hypot(y,z));
      tireRelief(relief,x,y,z,width);
      const chrome = wheelFinish(base,orm,mask,rubber,1,x,y,z,seed,width,x);
      for (let c=0; c<3; c++) check(i*12+c,base[c]!);
      [orm[1]!,orm[2]!,chrome].forEach((value,c) => check(i*12+4+c,value));
      for (let c=0; c<3; c++) check(i*12+8+c,0.5+0.25*relief[c]!);
    });
    faces.forEach(({kind,color,z}, i) => check((facesAt+i)*4,fixtureFace(kind,color,0.7,z)/8));
    bodies.forEach((b, i) => check((shadesAt+i)*4,bodyOpen(b[0]!,b[1]!,b[2]!,b[3]!,b[4]!,b[5]!,b[6]!,rest,wheels,center,half)));
    tyres.forEach(([up, out, rubber], i) => check((shadesAt+bodies.length+i)*4,tyreOpen(up!,out!,rubber!)));
    let balls = 0;
    mirrors.forEach((m, i) => {
      const shows = [...behind];
      orbMirror(shows, orbFrame, m.ray, m.at[0]!, m.at[1]!, m.at[2]!, m.rough, m.share);
      if (shows[0]! > behind[0]! + 0.01) balls++;
      for (let c = 0; c < 3; c++) check((mirrorsAt + i) * 4 + c, shows[c]!);
    });
    return {ok: peak <= 1 && balls > mirrors.length / 4 && balls < mirrors.length, lines: [`${cases.length} wheel and weather samples, ${faces.length} fixture faces, ${bodies.length + tyres.length} vehicle shades, ${mirrors.length} mirrors by an orb (${balls} showing it), maximum channel difference ${peak}/255 (limit 1).`]};
  },
};
