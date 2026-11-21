// Evaluate the actual production finish functions with identical inputs on the GPU and software paths.
import { STREET_GLSL, WHEEL_FINISH_GLSL, fixtureFace, fixtureShader, tireMould, weatherVehicle, wheelFinish } from "../../client/core/render/street-finish.ts";
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
const facesAt = cases.length * 2, shadesAt = facesAt + faces.length;
const width = shadesAt + bodies.length + tyres.length;

export const streetFinishCheck: LitCheck = {
  name: "Street material parity",
  shots: () => [],
  raws() {
    const branches = cases.map(({metal,rough,mask,x,y,z,seed,age,width}, i) =>
      `if (at / 2 == ${i}) { mro = vec3(0.86,${num(rough)},${num(metal)}); p = vec3(${num(x)},${num(y)},${num(z)}); mask = ${num(mask)}; seed = ${num(seed)}; age = ${num(age)}; footprint = ${num(width)}; }`);
    const shades = [
      ...bodies.map((b, i) => `if (k == ${i}) own = bodyOpen(${vec(b.slice(0,3))},${vec(b.slice(3,6))},${num(b[6]!)});`),
      ...tyres.map(([up, out, rubber], i) => `if (k == ${bodies.length + i}) own = tyreOpen(${num(up!)},${num(out!)},${num(rubber!)});`),
    ];
    const fragment = `#version 300 es
precision highp float;
precision highp int;
const vec4 fStreetLook = vec4(0.0);
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
  if (at < ${2*cases.length}) {
    if (age > 0.0) weatherVehicle(base,mro,p,seed,age,age == 1.0);
    float chrome = wheelFinish(base,mro,mask,1.0,p,seed,footprint,p.x);
    color = vec4(at % 2 == 0 ? base : vec3(mro.gb,chrome),1.0);
  } else if (at < ${shadesAt}) {
    int sampleId = at - ${facesAt};
    const uint pigments[8] = uint[8](${colors.map(c => c+"u").join(",")});
    const float zs[3] = float[3](-5.054,-3.754,0.0);
    int face = fixtureFace(sampleId / 24,pigments[(sampleId / 3) % 8],vec3(0,0.7,zs[sampleId % 3]));
    color = vec4(vec3(float(face)/8.0),1.0);
  } else {
    int k = at - ${shadesAt};
    float own = 0.0;
    ${shades.join("\n    ")}
    color = vec4(vec3(own),1.0);
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
    faces.forEach(({kind,color,z}, i) => check((facesAt+i)*4,fixtureFace(kind,color,0.7,z)/8));
    bodies.forEach((b, i) => check((shadesAt+i)*4,bodyOpen(b[0]!,b[1]!,b[2]!,b[3]!,b[4]!,b[5]!,b[6]!,rest,wheels,center,half)));
    tyres.forEach(([up, out, rubber], i) => check((shadesAt+bodies.length+i)*4,tyreOpen(up!,out!,rubber!)));
    return {ok: peak <= 1, lines: [`${cases.length} wheel and weather samples, ${faces.length} fixture faces, ${bodies.length + tyres.length} vehicle shades, maximum channel difference ${peak}/255 (limit 1).`]};
  },
};
