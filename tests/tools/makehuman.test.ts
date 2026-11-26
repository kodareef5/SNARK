import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { artTest } from "../fixtures/needs-art.ts";
import { axisGrowth, boundCount, fit, parseBinding, readBinding } from "../../tools/makehuman/bind.ts";
import { BASE_OBJ, DEFAULT_SKELETON, MAKEHUMAN, TARGETS } from "../../tools/makehuman/index.ts";
import { droop } from "../../tools/makehuman/inspect.ts";
import { bodyVertexCount, faceCount, groupVertices, parseObj, readObj, triangleCount, vertexCount } from "../../tools/makehuman/obj.ts";
import { bonePositions, jointAt, parseSkeleton, readSkeleton } from "../../tools/makehuman/skeleton.ts";
import { applyTarget, morph, parseTarget, readTarget, targetFiles } from "../../tools/makehuman/target.ts";
import { influences, parseWeights, readWeights } from "../../tools/makehuman/weights.ts";

const OBJ = `# basemesh hm08
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 2 0 0
v 2 1 0
v 5 5 5
vt 0 0
vt 1 0
vt 1 1
vt 0 1
g body
f 1/1 2/2 3/3 4/4
f 2/2 5/1 6/4 3/3
g helper-x
f 7 5 6
g body
`;

test("an obj gives positions, uvs, faces and groups, with the body's vertices first", () => {
  const m = parseObj(OBJ);
  expect(vertexCount(m)).toBe(7);
  expect(faceCount(m)).toBe(3);
  expect(triangleCount(m)).toBe(5);
  expect([...m.corners]).toEqual([0, 1, 2, 3, 1, 4, 5, 2, 6, 4, 5]);
  expect([...m.cornerUvs.slice(4, 8)]).toEqual([1, 0, 3, 2]);
  expect(m.cornerUvs[8]).toBe(0xffffffff);
  expect([...m.groups.get("body")!]).toEqual([0, 1]);
  expect([...groupVertices(m, "helper-x")]).toEqual([4, 5, 6]);
  expect(bodyVertexCount(m)).toBe(6);
  expect(triangleCount(m, m.groups.get("body")!)).toBe(4);
});

test("an obj face naming a missing vertex is refused", () => {
  expect(() => parseObj("v 0 0 0\nv 1 0 0\nf 1 2 3\n")).toThrow(/vertex 3 of 2/);
});

test("a target's sparse deltas add at their weight, from text or gzip", () => {
  const t = parseTarget("# a comment\n# basemesh hm08\n1 .5 0 -1\n3 0 2 0\n");
  expect([...t.vertices]).toEqual([1, 3]);
  const base = new Float32Array(12);
  const out = morph(base, [{ target: t, weight: 0.5 }, { target: t, weight: 0.5 }]);
  expect([...out]).toEqual([0, 0, 0, 0.5, 0, -1, 0, 0, 0, 0, 2, 0]);
  expect([...base]).toEqual(new Array(12).fill(0));
  expect(() => applyTarget(new Float32Array(6), t, 1)).toThrow(/past the mesh/);
  expect(() => parseTarget("1 2 3\n")).toThrow(/vertex dx dy dz/);
  const dir = mkdtempSync(join(tmpdir(), "snark-makehuman-"));
  try {
    writeFileSync(join(dir, "a.target.gz"), gzipSync("2 1 1 1\n"));
    expect([...readTarget(join(dir, "a.target.gz")).deltas]).toEqual([1, 1, 1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BINDING = `# license CC0
uuid 1234
basemesh hm08
name little
obj_file little.obj
x_scale 0 1 1.0
z_scale 0 3 2.0
y_scale 0 2 4.0
z_depth 50
verts 0
3
material little.mhmat
0 1 2 0.5 0.25 0.25 0.1 0.2 0.3
delete_verts
4 - 6 9
11 - 12
`;

test("a binding reads its header, one- and nine-number vertices and hidden ranges", () => {
  const b = parseBinding(BINDING);
  expect([b.name, b.uuid, b.basemesh, b.objFile, b.material, b.zDepth]).toEqual(["little", "1234", "hm08", "little.obj", "little.mhmat", 50]);
  expect(boundCount(b)).toBe(2);
  expect([...b.refs]).toEqual([3, 3, 3, 0, 1, 2]);
  expect([...b.weights]).toEqual([1, 0, 0, 0.5, 0.25, 0.25]);
  expect([...b.deleteVerts]).toEqual([4, 5, 6, 9, 11, 12]);
  expect(b.scales!.map((s) => [s.a, s.b, s.length])).toEqual([[0, 1, 1], [0, 2, 4], [0, 3, 2]]);
  expect(() => parseBinding("verts 0\n1 2 3 4 5\n")).toThrow(/1 or 9 numbers/);
  expect(() => parseBinding("x_scale 0 1 1\nverts 0\n1\n")).toThrow(/all three axis scales/);
});

test("a fitted binding follows its base vertices and scales offsets by axis growth", () => {
  const b = parseBinding(BINDING);
  const base = new Float32Array([0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 2]);
  expect(axisGrowth(b, base)).toEqual([1, 1, 1]);
  const at = fit(b, base);
  expect([...at.slice(0, 3)]).toEqual([0, 0, 2]);
  const close = (got: Float32Array, want: number[]) => want.forEach((w, i) => expect(got[i]!).toBeCloseTo(w, 6));
  close(at.slice(3), [0.25 + 0.1, 1 + 0.2, 0.3]);
  // Twice as wide, half as tall, as deep: offsets follow along x and y only.
  const grown = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2]);
  expect(axisGrowth(b, grown)).toEqual([2, 0.5, 1]);
  close(fit(b, grown).slice(3), [0.5 + 0.2, 0.5 + 0.1, 0.3]);
});

const SKELETON = JSON.stringify({
  name: "little",
  license: "CC0",
  weights_file: "little.mhw",
  bones: {
    arm: { parent: "spine", head: "arm____head", tail: "arm____tail", rotation_plane: "arm____plane", reference: null },
    root: { parent: null, head: "root____head", tail: "root____tail", rotation_plane: null, reference: null },
    spine: { parent: "root", head: "root____tail", tail: "spine____tail", rotation_plane: null, reference: null },
  },
  joints: { root____head: [0], root____tail: [0, 1], spine____tail: [1], arm____head: [1, 2], arm____tail: [2] },
  planes: { arm____plane: ["root____head", "spine____tail", "arm____tail"] },
});

test("a skeleton comes out parents first with joints at their vertices' mean", () => {
  const s = parseSkeleton(SKELETON);
  expect(s.bones.map((b) => [b.name, b.parent])).toEqual([["root", -1], ["spine", 0], ["arm", 1]]);
  expect(s.weightsFile).toBe("little.mhw");
  expect(s.bones[2]!.plane).toEqual(["root____head", "spine____tail", "arm____tail"]);
  const base = new Float32Array([0, 0, 0, 0, 2, 0, 2, 2, 0]);
  expect(jointAt(s, "arm____head", base)).toEqual([1, 2, 0]);
  expect([...bonePositions(s, base).slice(6, 12)]).toEqual([0, 1, 0, 0, 2, 0]);
  const broken = JSON.parse(SKELETON);
  broken.bones.arm.tail = "nowhere";
  expect(() => parseSkeleton(JSON.stringify(broken))).toThrow(/no joint nowhere/);
});

test("weights become each vertex's bones, heaviest first", () => {
  const w = parseWeights(JSON.stringify({ license: "CC0", weights: { spine: [[0, 0.25], [1, 1]], arm: [[0, 0.75], [2, 0]] } }));
  const inf = influences(w, ["root", "spine", "arm"], 3);
  expect([...inf.start]).toEqual([0, 2, 3, 3]);
  expect([...inf.bone]).toEqual([2, 1, 1]);
  expect([...inf.weight]).toEqual([0.75, 0.25, 1]);
  expect(() => influences(w, ["spine"], 3)).toThrow(/bone arm/);
  expect(() => influences(w, ["spine", "arm"], 1)).toThrow(/past the mesh/);
});

test("a bone's droop is 0 when level and 90 when it hangs straight down", () => {
  expect(droop([0, 0, 0], [1, 0, 0])).toBeCloseTo(0, 9);
  expect(droop([0, 0, 0], [1, -1, 0])).toBeCloseTo(45, 9);
  expect(droop([0, 0, 0], [0, -1, 0])).toBeCloseTo(90, 9);
});

const installed = () => {
  if (!existsSync(BASE_OBJ)) throw new Error(`no MakeHuman mirror at ${MAKEHUMAN}: the raw-makehuman art archive is not installed`);
};

artTest("the hm08 base has 13,380 body vertices first, then helpers to 19,157", () => {
  installed();
  const base = readObj(BASE_OBJ);
  expect(bodyVertexCount(base)).toBe(13380);
  expect(vertexCount(base)).toBe(19158);
  expect(triangleCount(base)).toBe(faceCount(base) * 2);
  const s = readSkeleton(DEFAULT_SKELETON);
  expect(s.bones.length).toBe(163);
  const w = readWeights(join(dirname(DEFAULT_SKELETON), s.weightsFile));
  const inf = influences(w, s.bones.map((b) => b.name), vertexCount(base));
  let unweighted = 0;
  for (let v = 0; v < vertexCount(base); v++) if (inf.start[v + 1] === inf.start[v]) unweighted++;
  expect(unweighted).toBe(0);
  expect(targetFiles(TARGETS).get("nose")!.length).toBeGreaterThan(0);
});

artTest("bindings made on the bare base reproduce their own rest within 0.1 mm", () => {
  installed();
  const base = readObj(BASE_OBJ).positions;
  for (const path of ["system-assets/eyelashes/eyelashes04/eyelashes04.mhclo", "system-assets/tongue/tongue01/tongue01.mhclo", "eyebrows01/eyebrows/mindfront_eyebrows_08/mindfront_eyebrows_08.mhclo"]) {
    const b = readBinding(join(MAKEHUMAN, path));
    const rest = readObj(join(MAKEHUMAN, dirname(path), b.objFile)).positions;
    const got = fit(b, base);
    expect(got.length).toBe(rest.length);
    let worst = 0;
    for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i]! - rest[i]!));
    // Decimetres: 0.001 is 0.1 mm.
    expect(worst).toBeLessThan(0.001);
  }
});

artTest("no file in the MakeHuman mirror carries a licence other than CC0", () => {
  installed();
  const allowed = /^#? *(license:? +CC-?0|This asset was explicitly released as CC0|The license|# The copyright holders|The copyright was explicitly)|"license": "CC0"|I set the license to CC0/i;
  const flagged: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!/\.(png|md)$/.test(name)) {
        for (const [line] of readFileSync(p, "latin1").matchAll(/^.*(licen[cs]e|\bGPL\b|CC[ _-]?BY).*$/gim)) {
          if (!allowed.test(line.replace(/^#\s*/, "#").trim())) flagged.push(`${p}: ${line.trim().slice(0, 80)}`);
        }
      }
    }
  };
  walk(MAKEHUMAN);
  expect(flagged).toEqual([]);
});
