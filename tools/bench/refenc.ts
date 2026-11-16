// The project's texture encoders against the reference open-source ones, run by hand to learn how good ours are. The
// results, and how they were taken, are in planning/quality/encoders.md.
//
//   bun tools/bench/refenc.ts --astcenc <astcenc> --bc7enc <bc7enc_rdo folder> [--bc7e <folder>] [--repeats 3]
//     [--work <folder>] [--only quality|speed] [--pick <part of a picture's name>] [--block <side>]
//
// ASTC is encoded in the blocks the build gives each role, or in blocks of `--block` pixels a side for every role.
//
// --astcenc is Arm's astcenc program. --bc7enc is a copy of bc7enc_rdo's source: its BC7 encoder (bc7enc.cpp), its BC4
// and BC5 encoder (rgbcx.cpp) and its BC7 decoders are compiled with this machine's clang++ around the harness below,
// in the work folder. --bc7e adds the folder holding basisu_bc7e_scalar.cpp, the plain C++ port of bc7e from
// basis_universal. Whatever is not given is skipped. Nothing here is part of `bun run check` or `bun run bench`, and
// nothing of the references is kept in the repository.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import type { TextureRole } from "../../shared/pack/texture.ts";
import { Rng } from "../../shared/rng.ts";
import { gameTextures } from "../art/materials.ts";
import { astcBlockInfo, decodeAstc, decodeAstcBlock16, encodeAstc, type AstcKind } from "../pack/astc.ts";
import { bc7Mode, decodeBc5, decodeBc7, encodeBc5, encodeBc7 } from "../pack/bc.ts";
import { encodingOf, type EncodeJob, type Encoding } from "../pack/encode.ts";
import { asPicture, decodePng, encodePng, packMro, readPicture } from "../pack/image.ts";
import { materialMips } from "../pack/texture.ts";
import { builtBlocks } from "../../tests/fixtures/astc.ts";
import { randomBc5, randomBc7 } from "../../tests/fixtures/bc.ts";

const ROOT = resolve(import.meta.dir, "../..");
const CORES = availableParallelism();

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const ASTCENC = option("--astcenc");
const BC7ENC = option("--bc7enc");
const BC7E = option("--bc7e");
const REPEATS = Number(option("--repeats") ?? 3);
const WORK = resolve(option("--work") ?? join(tmpdir(), "snark-refenc"));
const ONLY = option("--only");
const BLOCK = option("--block");
const PICK = option("--pick");

const sha = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

// ---- The test set ----

interface Sample {
  name: string;
  role: TextureRole;
  size: number;
  rgba: Uint8Array;
  /** One picture of each role is timed. */
  timed: boolean;
}

/** The feather and the wood under planning/artist-test and the thatch tier's textures, each at 1,024, and the thatch's own base colour at 2,048. */
async function testSet(): Promise<Sample[]> {
  const art = (name: string) => readPicture(join(ROOT, "planning/artist-test", name));
  const sets: Record<string, Partial<Record<TextureRole, Uint8Array[]>>> = {
    feather: materialMips({ base: art("feather/feather_base.png"), normal: art("feather/feather_normal.png"), mro: packMro(art("feather/feather_ao.png"), art("feather/feather_rough.png")), regions: art("feather/feather_mask.png") }),
    wood: materialMips({ base: art("wood/wood_base.png"), normal: art("wood/wood_normal.png"), mro: art("wood/wood_orm.png"), regions: art("wood/wood_mask.png") }),
  };
  const timed = new Set(["wood base", "wood normal", "wood mro", "feather mask"]);
  const out: Sample[] = [];
  const add = (name: string, role: TextureRole, rgba: Uint8Array) => {
    // As the build gives it: alpha is 255 where nothing reads it.
    if (role !== "normal") for (let a = 3; a < rgba.length; a += 4) rgba[a] = 255;
    out.push({ name, role, size: Math.sqrt(rgba.length / 4), rgba, timed: timed.has(name) });
  };
  for (const [name, mips] of Object.entries(sets)) for (const role of ["base", "normal", "mro", "mask"] as const) add(`${name} ${role}`, role, mips[role]![10]!.slice());
  for (const t of await gameTextures()) {
    if (!t.id.startsWith("core:thatch/")) continue;
    const mips = t.mips();
    const name = `${t.id.split("/")[1]!.toLowerCase()} ${t.role}`;
    add(name, t.role, mips[10]!.slice());
    if (t.id === "core:thatch/Thatch/base") add(`${name} 2048`, t.role, mips[11]!.slice());
  }
  return out;
}

// ---- The encoders ----

type Codec = "bc7" | "bc5" | "astc";
type Tier = "ours" | "fast" | "medium" | "thorough" | "best";
const TIERS: readonly Tier[] = ["fast", "medium", "thorough", "best"];

interface Timed {
  blocks: Uint8Array;
  /** Seconds on the wall clock, and of processor time, for the encoding alone. */
  wall: number;
  cpu: number;
}

interface Run {
  /** As the tables name it. */
  name: string;
  codec: Codec;
  tier: Tier;
  /** What the cache keys its output by, besides the pixels. */
  version: string;
  encode(s: Sample, threads: number): Promise<Timed>;
}

const codecsOf = (role: TextureRole): Codec[] => [role === "normal" ? "bc5" : "bc7", "astc"];
const astcHow = (role: TextureRole): { kind: AstcKind; block: number } => {
  const how = encodingOf("astc", role, false) as { kind: AstcKind; block: number };
  return BLOCK ? { ...how, block: Number(BLOCK) } : how;
};
const astcKind = (role: TextureRole): AstcKind => astcHow(role).kind;
/** The side of a codec's blocks for a role. */
const sideOf = (codec: Codec, role: TextureRole): number => (codec === "astc" ? astcHow(role).block : 4);

/** Blocks in each range a thread of ours is sent, as the build sends them. */
const CUT = 1024;

/** The build's own encoding threads, kept warm across encodings. */
function pool(count: number) {
  const threads = Array.from({ length: count }, () => {
    const t = { worker: new Worker(new URL("../pack/encode-worker.ts", import.meta.url)), done: () => {} };
    t.worker.on("message", () => t.done());
    return t;
  });
  return {
    async encode(rgba: Uint8Array, size: number, how: Encoding): Promise<Uint8Array> {
      const blocks = Math.ceil(size / (how.with === "astc" ? how.block : 4)) ** 2;
      const out = new Uint8Array(new SharedArrayBuffer(blocks * 16));
      let next = 0;
      await Promise.all(
        threads.map(async (t) => {
          for (let from = next; from < blocks; from = next) {
            next += CUT;
            const job: EncodeJob = { rgba, out, size, how, from, to: Math.min(from + CUT, blocks) };
            await new Promise<void>((done) => {
              t.done = () => done();
              t.worker.postMessage(job);
            });
          }
        }),
      );
      return out;
    },
    close: () => Promise.all(threads.map((t) => t.worker.terminate())),
  };
}

let workers: ReturnType<typeof pool> | null = null;

function shared(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(new SharedArrayBuffer(rgba.length));
  out.set(rgba);
  return out;
}

function ours(codec: Codec, name: string, how: (role: TextureRole) => Encoding): Run {
  const source = readFileSync(join(ROOT, codec === "astc" ? "tools/pack/astc.ts" : "tools/pack/bc.ts"), "utf8");
  return {
    name,
    codec,
    tier: "ours",
    version: sha(source + name),
    async encode(s, threads) {
      const e = how(s.role);
      const input = threads > 1 ? shared(s.rgba) : s.rgba;
      const cpu0 = process.cpuUsage();
      const t0 = performance.now();
      let blocks: Uint8Array;
      if (threads > 1) blocks = await (workers ??= pool(CORES)).encode(input, s.size, e);
      else if (e.with === "astc") blocks = encodeAstc(input, s.size, s.size, e.kind, e.block);
      else if (e.with === "bc5") blocks = encodeBc5(input, s.size, s.size);
      else blocks = encodeBc7(input, s.size, s.size, e.channels);
      const wall = (performance.now() - t0) / 1000;
      const cpu = process.cpuUsage(cpu0);
      return { blocks, wall, cpu: (cpu.user + cpu.system) / 1e6 };
    },
  };
}

async function spawn(cmd: string[]): Promise<{ out: string; cpu: number }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`${cmd.join(" ")} failed:\n${err || out}`);
  // The time is typed as a number and comes as a BigInt.
  return { out, cpu: Number(p.resourceUsage()?.cpuTime.total ?? NaN) / 1e6 };
}

function inputFile(s: Sample, ext: "png" | "rgba"): string {
  const file = join(WORK, "in", `${s.name.replace(/ /g, "_")}-${sha(s.rgba).slice(0, 12)}.${ext}`);
  if (!existsSync(file)) writeFileSync(file, ext === "png" ? encodePng(asPicture(s.rgba)) : s.rgba);
  return file;
}

const ASTC_PRESETS: Record<Tier, string> = { ours: "", fast: "-fast", medium: "-medium", thorough: "-thorough", best: "-exhaustive" };

function astcencRun(tier: Tier, version: string): Run {
  return {
    name: `astcenc ${ASTC_PRESETS[tier]}`,
    codec: "astc",
    tier,
    version,
    async encode(s, threads) {
      const to = join(WORK, "tmp", "out.astc");
      const profile = astcKind(s.role) === "srgb" ? "-cs" : "-cl";
      const { out, cpu } = await spawn([ASTCENC!, profile, inputFile(s, "png"), to, `${astcHow(s.role).block}x${astcHow(s.role).block}`, ASTC_PRESETS[tier], "-j", String(threads), ...(s.role === "normal" ? ["-normal"] : [])]);
      // Its coding time leaves out reading and writing the files. Processor time is shared out in the same proportion.
      const coding = Number(/Coding time:\s+([\d.]+)/.exec(out)?.[1]);
      const total = Number(/Total time:\s+([\d.]+)/.exec(out)?.[1]);
      return { blocks: readFileSync(to).subarray(16), wall: coding, cpu: (cpu * coding) / total };
    },
  };
}

/** The settings each harness encoder is run at, by tier. */
const HARNESS_SETTINGS: Record<string, Partial<Record<Tier, string>>> = {
  bc7e: { fast: "fast", medium: "basic", thorough: "slow", best: "slowest" },
  bc7enc: { fast: "0", medium: "2", thorough: "4" },
  rgbcx: { fast: "low", medium: "hq2", thorough: "hq5", best: "hq32" },
};
const HARNESS_NAMES: Record<string, (setting: string) => string> = {
  bc7e: (s) => `bc7e ${s}`,
  bc7enc: (s) => `bc7enc -u${s}`,
  rgbcx: (s) => `rgbcx ${s === "low" ? "-hl" : `-hr${s.slice(2)}`}`,
};

let harness = "";

function harnessRun(encoder: string, tier: Tier, version: string): Run {
  const setting = HARNESS_SETTINGS[encoder]![tier]!;
  return {
    name: HARNESS_NAMES[encoder]!(setting),
    codec: encoder === "rgbcx" ? "bc5" : "bc7",
    tier,
    version,
    async encode(s, threads) {
      const to = join(WORK, "tmp", "out.bin");
      const { out } = await spawn([harness, "enc", encoder === "rgbcx" ? "bc5" : encoder, setting, String(threads), inputFile(s, "rgba"), String(s.size), String(s.size), to]);
      const [, wall, cpu] = /seconds ([\d.]+) cpu ([\d.]+)/.exec(out)!;
      return { blocks: readFileSync(to), wall: Number(wall), cpu: Number(cpu) };
    },
  };
}

/** The harness around bc7enc_rdo's library and bc7e's scalar port: raw RGBA8 in, raw blocks out, and back. It calls
 *  each library as bc7enc_rdo's own command line tool does, and times the encoding loop alone. */
const HARNESS = String.raw`
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>
#include <sys/resource.h>
#include "bc7enc.h"
#include "bc7decomp.h"
#include "rgbcx.h"
#ifdef WITH_BC7E
#include "basisu_bc7e_scalar.h"
#endif

static std::vector<uint8_t> readAll(const char* path) {
  FILE* f = fopen(path, "rb");
  if (!f) { fprintf(stderr, "cannot read %s\n", path); exit(1); }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  std::vector<uint8_t> out(n);
  if (n > 0 && fread(out.data(), 1, n, f) != (size_t)n) exit(1);
  fclose(f);
  return out;
}

static void writeAll(const char* path, const std::vector<uint8_t>& data) {
  FILE* f = fopen(path, "wb");
  if (!f || fwrite(data.data(), 1, data.size(), f) != data.size()) { fprintf(stderr, "cannot write %s\n", path); exit(1); }
  fclose(f);
}

static double cpuSeconds() {
  rusage u;
  getrusage(RUSAGE_SELF, &u);
  return u.ru_utime.tv_sec + u.ru_stime.tv_sec + (u.ru_utime.tv_usec + u.ru_stime.tv_usec) / 1e6;
}

int main(int argc, char** argv) {
  std::string op = argc > 1 ? argv[1] : "";
  if (op == "enc" && argc == 9) {
    std::string codec = argv[2], setting = argv[3];
    int threads = atoi(argv[4]);
    std::vector<uint8_t> rgba = readAll(argv[5]);
    int width = atoi(argv[6]), height = atoi(argv[7]);
    if (width % 4 || height % 4 || (size_t)width * height * 4 != rgba.size()) { fprintf(stderr, "bad size\n"); return 1; }
    int across = width / 4, down = height / 4;
    std::vector<uint8_t> out((size_t)across * down * 16);
    rgbcx::init(rgbcx::bc1_approx_mode::cBC1Ideal);
    bc7enc_compress_block_init();
    bc7enc_compress_block_params p7;
    bc7enc_compress_block_params_init(&p7);
    bc7enc_compress_block_params_init_linear_weights(&p7);
    p7.m_uber_level = atoi(setting.c_str());
#ifdef WITH_BC7E
    bc7e_scalar::bc7e_compress_block_init();
    bc7e_scalar::bc7e_compress_block_params pe;
    if (setting == "fast") bc7e_scalar::bc7e_compress_block_params_init_fast(&pe, false);
    else if (setting == "basic") bc7e_scalar::bc7e_compress_block_params_init_basic(&pe, false);
    else if (setting == "slow") bc7e_scalar::bc7e_compress_block_params_init_slow(&pe, false);
    else if (setting == "slowest") bc7e_scalar::bc7e_compress_block_params_init_slowest(&pe, false);
#endif
    bool hq = setting.rfind("hq", 0) == 0;
    int radius = hq ? atoi(setting.c_str() + 2) : 0;
    // Rows of blocks are handed to the threads one at a time, as bc7enc_rdo's OpenMP loop hands them out.
    std::atomic<int> next(0);
    auto work = [&]() {
      const int N = 64;
      std::vector<uint8_t> px(64 * N);
      for (int by; (by = next++) < down;) {
        for (int bx0 = 0; bx0 < across; bx0 += N) {
          int n = std::min(N, across - bx0);
          for (int b = 0; b < n; b++)
            for (int y = 0; y < 4; y++) memcpy(&px[b * 64 + y * 16], &rgba[((by * 4 + y) * width + (bx0 + b) * 4) * 4], 16);
          uint8_t* dst = &out[((size_t)by * across + bx0) * 16];
#ifdef WITH_BC7E
          if (codec == "bc7e") { bc7e_scalar::bc7e_compress_blocks(n, (uint64_t*)dst, (const uint32_t*)px.data(), &pe); continue; }
#endif
          for (int b = 0; b < n; b++) {
            if (codec == "bc7enc") bc7enc_compress_block(dst + b * 16, &px[b * 64], &p7);
            else if (hq) rgbcx::encode_bc5_hq(dst + b * 16, &px[b * 64], 0, 1, 4, radius, rgbcx::BC4_USE_ALL_MODES);
            else rgbcx::encode_bc5(dst + b * 16, &px[b * 64], 0, 1, 4);
          }
        }
      }
    };
    double c0 = cpuSeconds();
    auto t0 = std::chrono::steady_clock::now();
    std::vector<std::thread> pool;
    for (int t = 1; t < threads; t++) pool.emplace_back(work);
    work();
    for (auto& t : pool) t.join();
    auto t1 = std::chrono::steady_clock::now();
    double c1 = cpuSeconds();
    writeAll(argv[8], out);
    printf("seconds %.6f cpu %.6f\n", std::chrono::duration<double>(t1 - t0).count(), c1 - c0);
    return 0;
  }
  if (op == "dec" && argc == 7) {
    std::string format = argv[2];
    std::vector<uint8_t> blocks = readAll(argv[3]);
    int width = atoi(argv[4]), height = atoi(argv[5]);
    int across = width / 4, down = height / 4;
    if ((size_t)across * down * 16 != blocks.size()) { fprintf(stderr, "bad size\n"); return 1; }
    std::vector<uint8_t> out((size_t)width * height * 4);
    for (int by = 0; by < down; by++)
      for (int bx = 0; bx < across; bx++) {
        const uint8_t* b = &blocks[((size_t)by * across + bx) * 16];
        uint8_t px[64];
        if (format == "bc5") {
          for (int i = 0; i < 16; i++) { px[i * 4 + 2] = 0; px[i * 4 + 3] = 255; }
          rgbcx::unpack_bc5(b, px, 0, 1, 4);
        } else if (format == "bc7") bc7decomp::unpack_bc7(b, (bc7decomp::color_rgba*)px);
        else bc7decomp_ref::unpack_bc7(b, (bc7decomp::color_rgba*)px);
        for (int y = 0; y < 4; y++) memcpy(&out[((by * 4 + y) * width + bx * 4) * 4], px + y * 16, 16);
      }
    writeAll(argv[6], out);
    return 0;
  }
  fprintf(stderr, "usage: enc <bc7enc|bc7e|bc5> <setting> <threads> <in.rgba> <width> <height> <out> | dec <bc7|bc7ref|bc5> <in> <width> <height> <out.rgba>\n");
  return 1;
}
`;

/** Compiles the harness into the work folder. Returns what its output depends on. */
async function buildHarness(): Promise<string> {
  const files = ["bc7enc.cpp", "rgbcx.cpp", "bc7decomp.cpp", "bc7decomp_ref.cpp"].map((f) => join(BC7ENC!, f));
  if (BC7E) files.push(join(BC7E, "basisu_bc7e_scalar.cpp"));
  const src = join(WORK, "harness.cpp");
  writeFileSync(src, HARNESS);
  harness = join(WORK, "harness");
  await spawn(["clang++", "-O3", "-DNDEBUG", "-std=c++17", "-fno-strict-aliasing", "-w", ...(BC7E ? ["-DWITH_BC7E", `-I${BC7E}`] : []), `-I${BC7ENC}`, src, ...files, "-o", harness]);
  return sha(HARNESS + files.map((f) => readFileSync(f, "utf8")).join(""));
}

// ---- Decoding ----

/** What a decoder gave for a picture, as RGBA8. */
interface Decoded {
  ours: Uint8Array;
  /** The reference decoder of the format, where there is one. */
  theirs: Uint8Array | null;
  /** For ASTC: our decoder's 16-bit results cut to 8 bits as astcenc writes an 8-bit file, to compare with it exactly. For BC7: bc7enc_rdo's second, plainer decoder. */
  exact: Uint8Array | null;
  /** For BC5: the values as the specification defines them, in sevenths and fifths, before any decoder rounds them. Ours rounds them to the nearest level, rgbcx rounds down, and Apple silicon blends in 64ths, so this is the measure fair to every encoder. */
  unrounded: Float32Array | null;
}

/** A BC5 picture's red and green as the specification defines them, unrounded; blue 0 and alpha 255. */
function unroundedBc5(blocks: Uint8Array, size: number): Float32Array {
  const out = new Float32Array(size * size * 4);
  const across = size >> 2;
  for (let b = 0; b * 16 < blocks.length; b++) {
    const x0 = (b % across) * 4;
    const y0 = ((b / across) | 0) * 4;
    for (let c = 0; c < 2; c++) {
      const at = b * 16 + c * 8;
      const r0 = blocks[at]!;
      const r1 = blocks[at + 1]!;
      const steps = r0 > r1 ? 7 : 5;
      for (let t = 0; t < 16; t++) {
        const code = bitsAt(blocks, at + 2, 3 * t, 3);
        const v = code === 0 ? r0 : code === 1 ? r1 : code > steps ? (code === 6 ? 0 : 255) : ((steps + 1 - code) * r0 + (code - 1) * r1) / steps;
        const p = ((y0 + (t >> 2)) * size + x0 + (t & 3)) * 4;
        out[p + c] = v;
        out[p + 3] = 255;
      }
    }
  }
  return out;
}

async function harnessDecode(format: string, blocks: Uint8Array, size: number): Promise<Uint8Array> {
  const from = join(WORK, "tmp", "dec.bin");
  const to = join(WORK, "tmp", "dec.rgba");
  writeFileSync(from, blocks);
  await spawn([harness, "dec", format, from, String(size), String(size), to]);
  return new Uint8Array(readFileSync(to));
}

/** An ASTC file of one image in blocks `side` pixels across: its 16-byte header, then the blocks. */
function astcFile(blocks: Uint8Array, size: number, side: number): Uint8Array {
  const header = new Uint8Array(16);
  header.set([0x13, 0xab, 0xa1, 0x5c, side, side, 1, size & 255, size >> 8, size >> 16, size & 255, size >> 8, size >> 16, 1, 0, 0]);
  const out = new Uint8Array(16 + blocks.length);
  out.set(header);
  out.set(blocks, 16);
  return out;
}

function rgbaOf(png: Uint8Array): Uint8Array {
  const p = decodePng(png);
  if (p.channels === 4 && p.depth === 8) return p.data as Uint8Array;
  const out = new Uint8Array(p.width * p.height * 4);
  for (let i = 0; i < p.width * p.height; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = p.data[i * p.channels + (p.channels < 3 ? 0 : c)]!;
    out[i * 4 + 3] = p.channels === 2 || p.channels === 4 ? p.data[i * p.channels + p.channels - 1]! : 255;
  }
  return out;
}

/** What astcenc writes to an 8-bit file: the top 8 bits of each 16-bit result. */
function astcTop8(blocks: Uint8Array, size: number, srgb: boolean, side: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const d16 = new Uint16Array(side * side * 4);
  const across = Math.ceil(size / side);
  for (let b = 0; b * 16 < blocks.length; b++) {
    decodeAstcBlock16(blocks, b * 16, side, srgb, d16);
    const x0 = (b % across) * side;
    const y0 = ((b / across) | 0) * side;
    for (let i = 0; i < side * side; i++) {
      const [x, y] = [x0 + (i % side), y0 + ((i / side) | 0)];
      if (x < size && y < size) for (let c = 0; c < 4; c++) out[(y * size + x) * 4 + c] = d16[i * 4 + c]! >> 8;
    }
  }
  return out;
}

async function decode(codec: Codec, blocks: Uint8Array, s: Sample): Promise<Decoded> {
  const n = s.size;
  if (codec === "astc") {
    const { kind, block } = astcHow(s.role);
    let theirs: Uint8Array | null = null;
    if (ASTCENC) {
      const from = join(WORK, "tmp", "dec.astc");
      const to = join(WORK, "tmp", "dec.png");
      writeFileSync(from, astcFile(blocks, n, block));
      await spawn([ASTCENC, kind === "srgb" ? "-ds" : "-dl", from, to, "-j", String(CORES)]);
      theirs = rgbaOf(new Uint8Array(readFileSync(to)));
    }
    return { ours: decodeAstc(blocks, n, n, kind, block), theirs, exact: astcTop8(blocks, n, kind === "srgb", block), unrounded: null };
  }
  if (codec === "bc5") return { ours: decodeBc5(blocks, n, n), theirs: harness ? await harnessDecode("bc5", blocks, n) : null, exact: null, unrounded: unroundedBc5(blocks, n) };
  return { ours: decodeBc7(blocks, n, n), theirs: harness ? await harnessDecode("bc7", blocks, n) : null, exact: harness ? await harnessDecode("bc7ref", blocks, n) : null, unrounded: null };
}

/** What a picture is measured on: for BC5 its unrounded values, for the rest what our decoder gives, which for ASTC is what Apple silicon shows. */
const measured = (d: Decoded): ArrayLike<number> => d.unrounded ?? d.ours;

// ---- Measures ----

/** The channels compared, as pairs of where each is in the source and in the decoded picture. A normal map is its x and y: BC5 gives them back in red and green, ASTC in red and alpha. */
function pairsOf(codec: Codec, role: TextureRole): (readonly [number, number])[] {
  if (role !== "normal") return [[0, 0], [1, 1], [2, 2]];
  return codec === "astc" ? [[0, 0], [1, 3]] : [[0, 0], [1, 1]];
}

/** Squared error of each block over the channels compared. */
function blockErrors(want: Uint8Array, got: ArrayLike<number>, size: number, pairs: readonly (readonly [number, number])[], side: number): Float64Array {
  const across = Math.ceil(size / side);
  const out = new Float64Array(across * across);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4;
      let e = 0;
      for (const [w, g] of pairs) e += (want[p + w]! - got[p + g]!) ** 2;
      out[Math.floor(y / side) * across + Math.floor(x / side)]! += e;
    }
  }
  return out;
}

function decibels(errors: Float64Array, size: number, channels: number): number {
  let sum = 0;
  for (const e of errors) sum += e;
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255 * size * size * channels) / sum);
}

/** A normal map channel as the shader reads it (client/core/render/surface.ts). */
const unbump = (v: number): number => Math.min(Math.max((v - 128) / 127, -1), 1);

/** The angle in degrees between each source normal and the decoded one, each rebuilt from its x and y. */
function angles(want: Uint8Array, got: ArrayLike<number>, pairs: readonly (readonly [number, number])[]): Float32Array {
  const out = new Float32Array(want.length / 4);
  const unit = (x: number, y: number): [number, number, number] => {
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  for (let i = 0; i < out.length; i++) {
    const a = unit(unbump(want[i * 4 + pairs[0]![0]]!), unbump(want[i * 4 + pairs[1]![0]]!));
    const b = unit(unbump(got[i * 4 + pairs[0]![1]]!), unbump(got[i * 4 + pairs[1]![1]]!));
    out[i] = (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) / Math.PI;
  }
  return out;
}

/** The region a mask texel gives most of: 0 to 2 for red, green and blue, 3 for what is left of 1. */
function region(rgba: Uint8Array, p: number): number {
  const w = [rgba[p]!, rgba[p + 1]!, rgba[p + 2]!, 255 - rgba[p]! - rgba[p + 1]! - rgba[p + 2]!];
  return w.indexOf(Math.max(...w));
}

interface Quality {
  db: number;
  /** The same through the format's reference decoder, and for BC5 unrounded. */
  dbTheirs: number;
  dbUnrounded: number;
  angleMean: number;
  angle99: number;
  /** Share of mask texels whose region changed. */
  flips: number;
}

function measure(s: Sample, codec: Codec, d: Decoded): Quality {
  const pairs = pairsOf(codec, s.role);
  const db = (got: ArrayLike<number>) => decibels(blockErrors(s.rgba, got, s.size, pairs, sideOf(codec, s.role)), s.size, pairs.length);
  const q: Quality = { db: db(d.ours), dbTheirs: d.theirs ? db(d.theirs) : NaN, dbUnrounded: d.unrounded ? db(d.unrounded) : NaN, angleMean: NaN, angle99: NaN, flips: NaN };
  if (s.role === "normal") {
    const a = angles(s.rgba, measured(d), pairs);
    q.angleMean = a.reduce((x, y) => x + y, 0) / a.length;
    q.angle99 = a.sort()[Math.floor(a.length * 0.99)]!;
  }
  if (s.role === "mask") {
    let flips = 0;
    for (let p = 0; p < s.rgba.length; p += 4) if (region(s.rgba, p) !== region(d.ours, p)) flips++;
    q.flips = flips / (s.rgba.length / 4);
  }
  return q;
}

// ---- Decoder conformance ----

interface Conformance {
  pictures: number;
  texels: number;
  /** Texels that differ in any channel, and by how much at most. */
  differ: number;
  most: number;
  /** The first block that differs. */
  example: string;
}

const conformance = new Map<string, Conformance>();

function compare(key: string, s: Sample, codec: Codec, blocks: Uint8Array, ours: Uint8Array, theirs: Uint8Array): void {
  const c = conformance.get(key) ?? { pictures: 0, texels: 0, differ: 0, most: 0, example: "" };
  conformance.set(key, c);
  c.pictures++;
  c.texels += ours.length / 4;
  for (let p = 0; p < ours.length; p += 4) {
    let off = 0;
    for (let k = 0; k < 4; k++) off = Math.max(off, Math.abs(ours[p + k]! - theirs[p + k]!));
    if (off === 0) continue;
    c.differ++;
    c.most = Math.max(c.most, off);
    if (c.example) continue;
    const x = (p / 4) % s.size;
    const y = Math.floor(p / 4 / s.size);
    const side = sideOf(codec, s.role);
    const block = Math.floor(y / side) * Math.ceil(s.size / side) + Math.floor(x / side);
    const bytes = Buffer.from(blocks.subarray(block * 16, block * 16 + 16)).toString("hex");
    c.example = `${s.name}, block ${block} (${describe(codec, blocks, block, side)}) ${bytes}: texel ${x},${y} ours ${ours.subarray(p, p + 4).join(",")}, theirs ${theirs.subarray(p, p + 4).join(",")}`;
  }
}

// ---- Which kind of block each encoder chose ----

/** The bits of a block from bit `from`, lowest first. */
function bitsAt(blocks: Uint8Array, at: number, from: number, count: number): number {
  let v = 0;
  for (let i = 0; i < count; i++) v |= ((blocks[at + ((from + i) >> 3)]! >> ((from + i) & 7)) & 1) << i;
  return v;
}

/** A BC7 block's mode and its partition, or its rotation and index selection in modes 4 and 5. */
function bc7Shape(blocks: Uint8Array, block: number): { mode: number; shape: number } {
  const at = block * 16;
  const mode = bc7Mode(blocks, at);
  const bits = [4, 6, 6, 6, 3, 2, 0, 6][mode] ?? 0;
  return { mode, shape: bitsAt(blocks, at, mode + 1, bits) };
}

const CEM_CLASS: Record<number, string> = { 0: "l", 1: "l", 4: "la", 5: "la", 6: "rgb scale", 8: "rgb", 9: "rgb", 10: "rgba scale", 12: "rgba", 13: "rgba" };

/** What an ASTC block is, in the terms the gap is told in. */
function astcShape(blocks: Uint8Array, block: number, side: number): { key: string; feature: string; shape: string } {
  const b = astcBlockInfo(blocks, block * 16, side);
  if (b.solid) return { key: "solid", feature: "", shape: "solid" };
  const classes = b.modes.map((m) => CEM_CLASS[m] ?? "hdr");
  const mixed = classes.some((c) => c !== classes[0]) || b.modes.some((m) => m !== b.modes[0]);
  const planes = b.secondPlane >= 0 ? 2 : 1;
  // What our encoder never writes.
  let feature = "";
  if (b.partitions === 4) feature = "4 partitions";
  else if (planes === 2 && b.partitions > 1) feature = "2 planes with partitions";
  else if (classes.some((c) => c.split(" ")[0] !== classes[0]!.split(" ")[0])) feature = "different channels in each partition";
  else if (mixed) feature = "another end mode in each partition";
  else if (classes[0]!.includes("scale")) feature = "ends as one colour and a scale";
  return {
    key: `${b.partitions} part${planes === 2 ? " 2 planes" : ""} ${mixed ? "mixed" : classes[0]}`,
    feature,
    shape: `${b.partitions}/${b.pattern}/${planes}/${b.modes.join("+")}/${b.gridWidth}x${b.gridHeight}/${b.weightLevels}/${b.colourLevels}`,
  };
}

function describe(codec: Codec, blocks: Uint8Array, block: number, side: number): string {
  if (codec === "bc5") return "bc5";
  if (codec === "bc7") {
    const { mode, shape } = bc7Shape(blocks, block);
    return `mode ${mode}${[0, 1, 2, 3, 7].includes(mode) ? ` partition ${shape}` : mode === 4 || mode === 5 ? ` rotation ${shape & 3}${mode === 4 ? ` selection ${shape >> 2}` : ""}` : ""}`;
  }
  return astcShape(blocks, block, side).shape;
}

// ---- Where ours falls short ----

/** For one role, codec and reference: the blocks where the reference came closer, sorted by why, as squared error ours would save. */
interface Gap {
  pictures: number;
  /** Mean decibels of ours, of the reference, and of the better of the two in each block. */
  ours: number;
  theirs: number;
  either: number;
  /** Share of blocks where the reference is closer. */
  worse: number;
  /** By reason: mean decibels gained if ours matched the reference on those blocks, and the share of blocks. */
  reasons: Map<string, { db: number; share: number }>;
  /** Share of blocks of each kind, ours and the reference's. */
  ourKinds: Map<string, number>;
  theirKinds: Map<string, number>;
}

const gaps = new Map<string, Gap>();

function reasonOf(codec: Codec, ourBlocks: Uint8Array, theirBlocks: Uint8Array, block: number, side: number): string {
  if (codec === "bc5") return "endpoints";
  if (codec === "bc7") {
    const a = bc7Shape(ourBlocks, block);
    const b = bc7Shape(theirBlocks, block);
    if (a.mode !== b.mode) return `mode ${b.mode} where ours took another`;
    return a.shape !== b.shape ? `mode ${b.mode}, another ${[4, 5].includes(b.mode) ? "rotation" : "partition"}` : `mode ${b.mode}, same partition: the fit`;
  }
  const a = astcShape(ourBlocks, block, side);
  const b = astcShape(theirBlocks, block, side);
  if (b.feature) return b.feature;
  const [ap, apat, apl] = a.shape.split("/");
  const [bp, bpat, bpl] = b.shape.split("/");
  if (ap !== bp) return `${bp} partitions where ours took ${ap}`;
  if (apat !== bpat) return `${bp} partitions, another pattern`;
  if (apl !== bpl) return `${bpl === "2" ? "two planes" : "one plane"} where ours took ${apl === "2" ? "two" : "one"}`;
  return a.shape !== b.shape ? "same partitions, another grid, range or mode" : "the same block shape: the fit";
}

function gapOf(s: Sample, codec: Codec, label: string, ourBlocks: Uint8Array, ourErr: Float64Array, theirBlocks: Uint8Array, theirErr: Float64Array): void {
  const key = `${s.role === "base" && s.size === 2048 ? "base 2,048" : s.role}|${codec}|${label}`;
  const g = gaps.get(key) ?? { pictures: 0, ours: 0, theirs: 0, either: 0, worse: 0, reasons: new Map(), ourKinds: new Map(), theirKinds: new Map() };
  gaps.set(key, g);
  const channels = pairsOf(codec, s.role).length;
  const total = ourErr.reduce((a, b) => a + b, 0);
  const saved = new Map<string, { sse: number; blocks: number }>();
  const either = new Float64Array(ourErr.length);
  let worse = 0;
  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1 / ourErr.length);
  const kindOf = (blocks: Uint8Array, b: number) => (codec === "bc7" ? `mode ${bc7Shape(blocks, b).mode}` : codec === "astc" ? astcShape(blocks, b, sideOf(codec, s.role)).key : "bc5");
  const ourKinds = new Map<string, number>();
  const theirKinds = new Map<string, number>();
  for (let b = 0; b < ourErr.length; b++) {
    either[b] = Math.min(ourErr[b]!, theirErr[b]!);
    count(ourKinds, kindOf(ourBlocks, b));
    count(theirKinds, kindOf(theirBlocks, b));
    if (theirErr[b]! >= ourErr[b]!) continue;
    worse++;
    const why = reasonOf(codec, ourBlocks, theirBlocks, b, sideOf(codec, s.role));
    const r = saved.get(why) ?? { sse: 0, blocks: 0 };
    r.sse += ourErr[b]! - theirErr[b]!;
    r.blocks++;
    saved.set(why, r);
  }
  const n = ++g.pictures;
  const mean = (old: number, now: number) => old + (now - old) / n;
  g.ours = mean(g.ours, decibels(ourErr, s.size, channels));
  g.theirs = mean(g.theirs, decibels(theirErr, s.size, channels));
  g.either = mean(g.either, decibels(either, s.size, channels));
  g.worse = mean(g.worse, worse / ourErr.length);
  // A reason missing from a picture gained nothing there, so every reason is averaged over every picture.
  for (const why of new Set([...g.reasons.keys(), ...saved.keys()])) {
    const r = g.reasons.get(why) ?? { db: 0, share: 0 };
    const got = saved.get(why);
    const db = got && total > 0 ? 10 * Math.log10(total / Math.max(total - got.sse, 1e-9)) : 0;
    g.reasons.set(why, { db: r.db + (db - r.db) / n, share: r.share + ((got ? got.blocks / ourErr.length : 0) - r.share) / n });
  }
  for (const [into, from] of [[g.ourKinds, ourKinds], [g.theirKinds, theirKinds]] as const) {
    for (const k of new Set([...into.keys(), ...from.keys()])) into.set(k, (into.get(k) ?? 0) + ((from.get(k) ?? 0) - (into.get(k) ?? 0)) / n);
  }
}

// ---- Output ----

const fixed = (v: number, digits = 2): string => (Number.isNaN(v) ? "" : v === Infinity ? "exact" : v.toFixed(digits));
const range = (values: number[], digits = 2): string => {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? fixed(lo, digits) : `${fixed(lo, digits)} to ${fixed(hi, digits)}`;
};

/** Decibels of several pictures: their mean and range, with those that came back exact counted apart. */
function decibelCell(values: number[]): string {
  const finite = values.filter((v) => Number.isFinite(v));
  const exact = values.filter((v) => v === Infinity).length;
  if (finite.length === 0) return values.some((v) => Number.isNaN(v)) ? "" : "exact";
  const text = finite.length === 1 ? fixed(finite[0]!) : `${fixed(finite.reduce((a, b) => a + b, 0) / finite.length)} (${range(finite)})`;
  return exact > 0 ? `${text}, ${exact} exact` : text;
}

function table(title: string, head: string[], rows: string[][]): void {
  console.log(`\n${title}\n`);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => "| " + cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ") + " |";
  console.log(line(head));
  console.log("|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|");
  for (const r of rows) console.log(line(r));
}

// ---- The run ----

async function main(): Promise<void> {
  const skipped: string[] = [];
  if (!ASTCENC) skipped.push("astcenc: no --astcenc given");
  if (!BC7ENC) skipped.push("bc7enc_rdo (bc7enc, rgbcx and their decoders): no --bc7enc given");
  if (!BC7E) skipped.push("bc7e: no --bc7e given");
  for (const s of skipped) console.log(`skipped ${s}`);
  if (!ASTCENC && !BC7ENC) {
    console.log("nothing to compare with");
    return;
  }
  for (const dir of ["in", "out", "tmp"]) mkdirSync(join(WORK, dir), { recursive: true });

  const runs: Run[] = [
    ours("bc7", "ours", (role) => encodingOf("bc", role, false)),
    ours("bc7", "ours, alpha kept", () => ({ with: "bc7", channels: 4 })),
    ours("bc5", "ours", () => ({ with: "bc5" })),
    ours("astc", "ours", (role) => encodingOf("astc", role, false)),
  ];
  if (ASTCENC) {
    const version = sha(readFileSync(ASTCENC));
    console.log(Bun.spawnSync([ASTCENC, "-version"]).stdout.toString().split("\n")[0]);
    for (const tier of TIERS) runs.push(astcencRun(tier, version));
  }
  if (BC7ENC) {
    const version = await buildHarness();
    for (const encoder of ["bc7e", "bc7enc", "rgbcx"]) {
      if (encoder === "bc7e" && !BC7E) continue;
      for (const tier of TIERS) if (HARNESS_SETTINGS[encoder]![tier]) runs.push(harnessRun(encoder, tier, version));
    }
  }
  const samples = (await testSet()).filter((s) => !PICK || s.name.includes(PICK));
  console.log(`${samples.length} pictures, ${CORES} cores, work folder ${WORK}`);
  try {
    if (ONLY !== "speed") await quality(samples, runs);
    if (ONLY !== "quality") await speed(samples, runs);
  } finally {
    await workers?.close();
  }
}

/** Seconds and megapixels of what was encoded afresh while measuring, by codec and run. */
const fresh = new Map<string, { wall: number; mp: number }>();

/** A picture through a run at every core, kept in the work folder by what went into it. No two pictures of the sets are
 *  the same, so the pixels also stand for the role. */
async function encoded(run: Run, s: Sample): Promise<Uint8Array> {
  const file = join(WORK, "out", `${sha(run.version + run.name + run.tier + sha(s.rgba))}.bin`);
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const t = await run.encode(s, CORES);
  const key = `${run.codec}|${run.name}`;
  const f = fresh.get(key) ?? { wall: 0, mp: 0 };
  fresh.set(key, { wall: f.wall + t.wall, mp: f.mp + (s.size * s.size) / 1e6 });
  const blocks = t.blocks.slice();
  writeFileSync(file, blocks);
  return blocks;
}

/** How many blocks of each kind the files the decoders were held to hold, by format: what the comparison covered. */
const covered = new Map<string, Map<string, number>>();

function cover(codec: Codec, blocks: Uint8Array, side: number): void {
  const tally = covered.get(codec) ?? new Map<string, number>();
  covered.set(codec, tally);
  const add = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
  for (let b = 0; b * 16 < blocks.length; b++) {
    if (codec === "bc7") {
      const { mode, shape } = bc7Shape(blocks, b);
      add(`mode ${mode}`);
      if (mode === 4 || mode === 5) add(`mode ${mode} rotation ${shape & 3}${mode === 4 ? ` selection ${shape >> 2}` : ""}`);
      else if (mode !== 6 && mode !== 8) add(`mode ${mode} partition ${shape}`);
    } else if (codec === "astc") {
      const i = astcBlockInfo(blocks, b * 16, side);
      if (i.solid || !i.valid) {
        add(i.solid ? "solid" : "invalid");
        continue;
      }
      add(`${i.partitions} partitions${i.secondPlane >= 0 ? ", two planes" : ""}`);
      for (const m of new Set(i.modes)) add(`endpoint mode ${m}`);
      if (new Set(i.modes).size > 1) add("a mode for each partition");
      add(`grid ${i.gridWidth}x${i.gridHeight}`);
      add(`weights of ${i.weightLevels} levels`);
      add(`colours of ${i.colourLevels} levels`);
    }
  }
}

/** Holds the decoders to each other on a file. */
function checkDecoders(set: string, run: Run, s: Sample, blocks: Uint8Array, d: Decoded): void {
  if (d.theirs) cover(run.codec, blocks, sideOf(run.codec, s.role));
  const key = (how: string) => `${set}|${run.codec}|${run.tier === "ours" ? "ours" : "theirs"}|${how}`;
  if (d.theirs) compare(key("reference decoder"), s, run.codec, blocks, run.codec === "astc" ? d.exact! : d.ours, d.theirs);
  if (run.codec === "astc" && d.theirs) compare(key("as a GPU shows it"), s, run.codec, blocks, d.ours, d.theirs);
  if (run.codec === "bc7" && d.exact) compare(key("plain reference decoder"), s, run.codec, blocks, d.ours, d.exact);
}

/** Pictures made to draw every kind of block out of the encoders, for the decoders only, each a different picture for
 *  each role: noise in every channel, colour with alpha that is soft in one half and hard in the other, and grey with
 *  alpha. */
function stressSet(base: Uint8Array): Sample[] {
  const size = 256;
  const noise = (seed: number) => {
    const rng = new Rng(seed);
    return new Uint8Array(size * size * 4).map(() => rng.u32() & 255);
  };
  const soft = (from: number, grey: boolean) => {
    const out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = (y * size + x) * 4;
        const q = ((y + from) * 1024 + x) * 4;
        out.set(grey ? [base[q + 1]!, base[q + 1]!, base[q + 1]!] : base.subarray(q, q + 3), p);
        out[p + 3] = x < 128 ? 128 + 127 * Math.sin(x / 9) * Math.cos(y / 13) : ((x >> 3) + (y >> 3)) & 1 ? 255 : 0;
      }
    }
    return out;
  };
  const at = (name: string, role: TextureRole, rgba: Uint8Array): Sample => ({ name, role, size, rgba, timed: false });
  return [at("noise", "base", noise(1)), at("noise", "mro", noise(2)), at("noise", "normal", noise(3)), at("soft alpha", "base", soft(0, false)), at("soft alpha", "mro", soft(256, false)), at("grey and alpha", "mro", soft(512, true))];
}

/** Blocks as no encoder writes them, for the decoders only: random bits in each BC7 mode and in BC5, and ASTC blocks of
 *  every grid, weight range, number of planes and partitions and every endpoint mode, a few of them the format does
 *  not allow (tests/fixtures/astc.ts builds them). */
async function randomBlocks(): Promise<void> {
  const picture = (name: string, blocks: Uint8Array): Sample => ({ name, role: "base", size: Math.sqrt(blocks.length / 16) * 4, rgba: new Uint8Array(0), timed: false });
  if (harness) {
    for (let mode = 0; mode < 8; mode++) {
      const blocks = randomBc7(mode, 4096, 100 + mode);
      const s = picture(`random bits, mode ${mode}`, blocks);
      compare("random bits|bc7|-|reference decoder", s, "bc7", blocks, decodeBc7(blocks, s.size, s.size), await harnessDecode("bc7", blocks, s.size));
      compare("random bits|bc7|-|plain reference decoder", s, "bc7", blocks, decodeBc7(blocks, s.size, s.size), await harnessDecode("bc7ref", blocks, s.size));
    }
    const bc5 = randomBc5(4096, 99);
    compare("random bits|bc5|-|reference decoder", picture("random bits", bc5), "bc5", bc5, decodeBc5(bc5, 256, 256), await harnessDecode("bc5", bc5, 256));
  }
  if (!ASTCENC) return;
  const built = builtBlocks(0x5eed, 4, 4);
  for (const valid of [true, false]) {
    const chosen = built.filter((b) => (b.set === "built") === valid);
    // As many blocks as make a square, the last repeated to fill it.
    const side = Math.ceil(Math.sqrt(chosen.length));
    const blocks = new Uint8Array(side * side * 16);
    for (let i = 0; i < side * side; i++) blocks.set(chosen[Math.min(i, chosen.length - 1)]!.block, i * 16);
    const s = picture(valid ? "astc blocks of every kind" : "astc blocks the format does not allow", blocks);
    for (const srgb of [false, true]) {
      const from = join(WORK, "tmp", "dec.astc");
      const to = join(WORK, "tmp", "dec.png");
      writeFileSync(from, astcFile(blocks, s.size, 4));
      await spawn([ASTCENC, srgb ? "-ds" : "-dl", from, to]);
      compare(`random bits|astc|-|reference decoder${valid ? "" : ", blocks not allowed"}`, s, "astc", blocks, astcTop8(blocks, s.size, srgb, 4), rgbaOf(new Uint8Array(readFileSync(to))));
    }
  }
}

async function quality(samples: Sample[], runs: Run[]): Promise<void> {
  /** By role, codec and run: each picture's measures. */
  const results = new Map<string, Quality[]>();
  for (const s of samples) {
    // The two masks are told apart: each is exact or not on its own.
    const roleKey = s.role === "base" && s.size === 2048 ? "base 2,048" : s.role === "mask" ? s.name : s.role;
    for (const codec of codecsOf(s.role)) {
      const made: { run: Run; blocks: Uint8Array; errors: Float64Array }[] = [];
      for (const run of runs.filter((r) => r.codec === codec)) {
        const blocks = await encoded(run, s);
        const d = await decode(codec, blocks, s);
        const key = `${roleKey}|${codec}|${run.name}`;
        results.set(key, [...(results.get(key) ?? []), measure(s, codec, d)]);
        checkDecoders("test set", run, s, blocks, d);
        made.push({ run, blocks, errors: blockErrors(s.rgba, measured(d), s.size, pairsOf(codec, s.role), sideOf(codec, s.role)) });
      }
      const mine = made.find((m) => m.run.tier === "ours" && m.run.name === "ours")!;
      for (const m of made) {
        if ((m.run.tier !== "thorough" && m.run.tier !== "best") || mine.errors.every((e) => e === 0)) continue;
        if (codec === "bc7" && m.run.name.startsWith("bc7enc") && made.some((x) => x.run.name.startsWith("bc7e "))) continue;
        gapOf(s, codec, m.run.name, mine.blocks, mine.errors, m.blocks, m.errors);
      }
    }
    console.error(`  measured ${s.name}`);
  }
  const feather = samples.find((s) => s.name === "feather base");
  for (const s of feather ? stressSet(feather.rgba) : []) {
    for (const codec of codecsOf(s.role)) {
      for (const run of runs.filter((r) => r.codec === codec)) {
        const blocks = await encoded(run, s);
        checkDecoders("made to stress", run, s, blocks, await decode(codec, blocks, s));
      }
    }
    console.error(`  checked ${s.name}, ${s.role}`);
  }
  await randomBlocks();

  const roles = ["base", "normal", "mro", "feather mask", "wood mask", "base 2,048"];
  const rows: string[][] = [];
  for (const role of roles) {
    for (const [key, qs] of results) {
      const [r, codec, name] = key.split("|");
      if (r !== role) continue;
      rows.push([
        role,
        codec!.toUpperCase(),
        name!,
        decibelCell(qs.map((q) => q.db)),
        decibelCell(qs.map((q) => q.dbTheirs)),
        decibelCell(qs.map((q) => q.dbUnrounded)),
        role === "normal" ? `${fixed(qs.reduce((a, q) => a + q.angleMean, 0) / qs.length, 3)} / ${fixed(qs.reduce((a, q) => a + q.angle99, 0) / qs.length, 2)}` : "",
        role.endsWith("mask") ? `${fixed((qs.reduce((a, q) => a + q.flips, 0) / qs.length) * 100, 4)}%` : "",
      ]);
    }
  }
  table("Quality: mean decibels over the role's pictures (range), through our decoder, through the format's reference decoder, and for BC5 unrounded; normal maps' angle error in degrees, mean and 99th percentile (BC5 unrounded); masks' texels that change region", ["role", "format", "encoder", "dB, our decoder", "dB, reference decoder", "dB, unrounded", "angle", "region"], rows);
  table(
    "What was encoded afresh while measuring, once at every core: seconds a megapixel on the wall clock",
    ["format", "encoder", "MP", "s/MP"],
    [...fresh].map(([k, f]) => [...k.split("|").map((x, i) => (i === 0 ? x.toUpperCase() : x)), fixed(f.mp, 1), fixed(f.wall / f.mp, 3)]),
  );

  const conf: string[][] = [];
  for (const [key, c] of conformance) {
    const [set, codec, who, how] = key.split("|");
    conf.push([set!, codec!.toUpperCase(), who === "ours" ? "ours" : who === "theirs" ? "the references'" : "", how!, String(c.pictures), String(c.texels), String(c.differ), String(c.most), c.example]);
  }
  table("Our decoders against the reference decoders, texel for texel", ["pictures", "format", "files", "compared with", "files", "texels", "texels that differ", "most", "first block that differs"], conf);
  const kinds: string[][] = [];
  for (const [codec, tally] of covered) {
    for (const [k, n] of [...tally].sort()) {
      if (/partition \d|rotation/.test(k)) continue;
      const shapes = [...tally.keys()].filter((x) => x.startsWith(`${k} `)).length;
      kinds.push([codec.toUpperCase(), k, String(n), codec === "bc7" && shapes > 0 ? `${shapes} ${/mode [45]$/.test(k) ? "rotations and selections" : "partitions"}` : ""]);
    }
  }
  table("The blocks of the files compared, by kind", ["format", "kind", "blocks", "of which"], kinds);

  for (const [key, g] of gaps) {
    const [role, codec, label] = key.split("|");
    console.log(`\nGap: ${role}, ${codec!.toUpperCase()}, ours against ${label} over ${g.pictures} pictures: ours ${fixed(g.ours)} dB, theirs ${fixed(g.theirs)} dB, the better block of the two ${fixed(g.either)} dB; theirs is closer in ${fixed(g.worse * 100, 1)}% of blocks`);
    table(
      "Decibels ours would gain by matching the reference where it is closer, by why it is closer",
      ["why", "blocks", "dB"],
      [...g.reasons].sort((a, b) => b[1].db - a[1].db).map(([why, r]) => [why, `${fixed(r.share * 100, 1)}%`, fixed(r.db, 3)]),
    );
    const kinds = [...new Set([...g.ourKinds.keys(), ...g.theirKinds.keys()])].sort();
    table("Kinds of block, share of blocks", ["kind", "ours", label!], kinds.map((k) => [k, `${fixed((g.ourKinds.get(k) ?? 0) * 100, 1)}%`, `${fixed((g.theirKinds.get(k) ?? 0) * 100, 1)}%`]));
  }
}

async function speed(samples: Sample[], runs: Run[]): Promise<void> {
  const timed = samples.filter((s) => s.timed);
  const ready = runs.filter((r) => r.tier !== "best" && r.name !== "ours, alpha kept");
  // Ours is warmed first: compiled by the engine on one thread, and every thread of the pool started.
  const warm = timed.map((s) => ({ ...s, size: 512, rgba: s.rgba.subarray(0, 512 * 512 * 4) }));
  for (const run of ready.filter((r) => r.tier === "ours")) for (const s of warm) if (codecsOf(s.role).includes(run.codec)) for (const threads of [1, CORES]) await run.encode(s, threads);
  /** By run and thread count: seconds and megapixels of each repeat. */
  const took = new Map<string, { wall: number[]; cpu: number[]; mp: number }>();
  for (let r = 0; r < REPEATS; r++) {
    for (const run of ready) {
      for (const threads of [1, CORES]) {
        const key = `${run.codec}|${run.name}|${threads}`;
        const t = took.get(key) ?? { wall: [], cpu: [], mp: 0 };
        took.set(key, t);
        let wall = 0;
        let cpu = 0;
        let mp = 0;
        for (const s of timed) {
          if (!codecsOf(s.role).includes(run.codec)) continue;
          const got = await run.encode(s, threads);
          wall += got.wall;
          cpu += got.cpu;
          mp += (s.size * s.size) / 1e6;
        }
        t.wall.push(wall / mp);
        t.cpu.push(cpu / mp);
        t.mp = mp;
      }
      console.error(`  timed ${run.codec} ${run.name}, repeat ${r + 1}`);
    }
    console.log(`repeat ${r + 1} done, load average ${loadavg().map((l) => l.toFixed(0)).join(" ")}`);
  }
  const rows: string[][] = [];
  for (const run of ready) {
    const one = took.get(`${run.codec}|${run.name}|1`)!;
    const all = took.get(`${run.codec}|${run.name}|${CORES}`)!;
    rows.push([run.codec.toUpperCase(), run.name, run.tier, range(one.cpu, 3), range(one.wall, 3), range(all.wall, 3), range(all.cpu, 3), String(one.mp)]);
  }
  table(
    `Speed: seconds a megapixel over ${REPEATS} repeats (the range), on one thread and on ${CORES}, for ${timed.map((s) => s.name).join(", ")}`,
    ["format", "encoder", "setting", "1 thread, processor", "1 thread, wall", `${CORES} threads, wall`, `${CORES} threads, processor`, "MP"],
    rows,
  );
}

await main();
