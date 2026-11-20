// Evaluate the actual production finish functions with identical inputs on the GPU and software paths.
import { STREET_GLSL, WHEEL_FINISH_GLSL, fixtureFace, fixtureShader, tireMould, weatherVehicle, wheelFinish } from "../../client/core/render/street-finish.ts";
import { RawShot, type LitCheck } from "./shot.ts";

const vertex = `#version 300 es
in vec2 point;
void main() { gl_Position = vec4(point,0.0,1.0); }`;
const inputs = [
  // Metal, roughness, alloy mask, outboard position, radial Y and Z.
  [0.85,0.20,1,0.36,0.40,0.17], [165/255,122/255,0,0.36,0.52,0],
  [0.65,0.48,0,0.03,0.52,0], [0.02,0.84,0,0.30,0.845,0],
  [0.04,0.79,0,-0.32,0.65,0.70], [0.12,0.31,0,0.28,0.15,0.10],
];
const cases = inputs.flatMap(([metal, rough, mask, x, y, z]) =>
  [0.12,0.72].flatMap(seed => [0,0.78,1].flatMap(age => [0.001,0.04].map(width =>
    ({ metal: metal!, rough: rough!, mask: mask!, x: x!, y: y!, z: z!, seed, age, width })))));
const num = (value: number) => Number.isInteger(value) ? value.toFixed(1) : String(value);
const colors = [11,41,82,86,102,140,214,83];
const faces = [0,1,2,3,4].flatMap(kind => colors.flatMap(color => [-5.054,-3.754,0].map(z => ({kind,color,z}))));
const key = "street-finish-pairs";
const width = cases.length * 2 + faces.length;

export const streetFinishCheck: LitCheck = {
  name: "Street material parity",
  shots: () => [],
  raws() {
    const branches = cases.map(({metal,rough,mask,x,y,z,seed,age,width}, i) =>
      `if (at / 2 == ${i}) { mro = vec3(0.86,${num(rough)},${num(metal)}); p = vec3(${num(x)},${num(y)},${num(z)}); mask = ${num(mask)}; seed = ${num(seed)}; age = ${num(age)}; footprint = ${num(width)}; }`);
    const fragment = `#version 300 es
precision highp float;
precision highp int;
const vec4 fStreetLook = vec4(0.0);
${STREET_GLSL}
${WHEEL_FINISH_GLSL}
${fixtureShader()}
out vec4 color;
void main() {
  int at = int(gl_FragCoord.x);
  vec3 base = vec3(0.18,0.2,0.22), mro = vec3(0.0), p = vec3(0.0);
  float seed = 0.0, age = 0.0, footprint = 0.0, mask = 0.0;
  ${branches.join("\n")}
  if (at < ${2*cases.length}) {
    if (age > 0.0) weatherVehicle(base,mro,p,seed,age,age == 1.0);
    float chrome = wheelFinish(base,mro,mask,1.0,p,seed,footprint,p.x);
    color = vec4(at % 2 == 0 ? base : vec3(mro.gb,chrome),1.0);
  } else {
    int sampleId = at - ${2*cases.length};
    const uint pigments[8] = uint[8](${colors.map(c => c+"u").join(",")});
    const float zs[3] = float[3](-5.054,-3.754,0.0);
    int face = fixtureFace(sampleId / 24,pigments[(sampleId / 3) % 8],vec3(0,0.7,zs[sampleId % 3]));
    color = vec4(vec3(float(face)/8.0),1.0);
  }
}`;
    return [new RawShot(key,width,1,vertex,fragment,[["point",2]],Float32Array.of(-1,-1,3,-1,-1,3),{},[])];
  },
  judge(back) {
    const pixels = back.pixels(key,0)!;
    let peak = 0;
    const check = (i: number, value: number) => { peak = Math.max(peak,Math.abs(pixels[i]!-Math.round(255*Math.max(0,Math.min(1,value))))); };
    cases.forEach(({metal,rough,mask,x,y,z,seed,age,width}, i) => {
      const base = Float64Array.of(0.18,0.2,0.22), orm = Float64Array.of(0.86,rough,metal);
      if (age) weatherVehicle(base,orm,x,y,z,seed,age,age === 1);
      const chrome = wheelFinish(base,orm,mask,1,tireMould(x,y,z,width),seed,y,z,width,x);
      for (let c=0; c<3; c++) check(i*8+c,base[c]!);
      [orm[1]!,orm[2]!,chrome].forEach((value,c) => check(i*8+4+c,value));
    });
    faces.forEach(({kind,color,z}, i) => check(cases.length*8+i*4,fixtureFace(kind,color,0.7,z)/8));
    return {ok: peak <= 1, lines: [`${cases.length} wheel and weather samples, ${faces.length} fixture faces, maximum channel difference ${peak}/255 (limit 1).`]};
  },
};
