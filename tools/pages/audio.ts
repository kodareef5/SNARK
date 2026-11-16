// Static audio previews use the game's take processing. Only finished media and a public descriptor are published.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { listSounds, type ListedOwner } from "../../client/core/sound/listing.ts";
import type { ManifestSound } from "../../shared/pack/sound.ts";
import type { GuideMusic, GuideSound } from "../../shared/pages/types.ts";
import { SOURCE } from "../art/source.ts";
import { findSheets, prepareTake, readWav, SOUND_RATE, writeWav, type FoundSheet } from "../pack/sound.ts";
import { linkMedia } from "./release.ts";

const PROCESSOR = readFileSync(resolve(import.meta.dir, "../pack/sound.ts"));
const digest = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const words = (value: string): string => value.replace(/^core:/, "").replaceAll("/", " · ").replaceAll("_", " ").replaceAll("-", " ");
const SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

export interface AudioOptions { source?: string; cache?: string; progress?: (message: string) => void }

/** Resolves only a regular source within this sheet's own directory, including through symlinks. */
export function soundSource(dir: string, file: string): string {
  const root = realpathSync(dir);
  const path = realpathSync(resolve(dir, file));
  if (!path.startsWith(root + sep) || !path.endsWith(".wav")) throw new Error("sound source must be a WAV inside its sheet directory");
  return path;
}

function mappedSounds(sheets: readonly FoundSheet[]): Set<string> {
  const owners: ListedOwner[] = sheets.map(({ owner }) => {
    const def = CORE_CONTENT.find((d) => d.id === owner);
    return { id: owner, cls: def ? def.type === "species" ? `species/${def.class}` : def.type : "family", folder: null, files: [], takes: {}, wants: {}, made: {} };
  });
  const manifest: ManifestSound[] = sheets.flatMap(({ owner, sheet }) => Object.entries(sheet.sounds).map(([name, cue]) => ({ id: `${owner}/sound/${name}`, file: 0, at: 0, rate: cue.rate ?? SOUND_RATE, range: cue.range, vary: cue.vary ?? 0, takes: [] })));
  const mapped = new Set<string>();
  for (const group of listSounds(manifest, owners)) for (const card of group.cards) for (const occasion of card.occasions) {
    if (occasion.status.startsWith("waits:")) continue;
    for (const variant of occasion.variants) if (variant.sound) mapped.add(variant.sound);
  }
  return mapped;
}

export async function buildAudio(outDir: string, options: AudioOptions = {}): Promise<{ sounds: GuideSound[]; music: GuideMusic[] }> {
  const source = options.source ?? SOURCE;
  const cache = options.cache ?? resolve(import.meta.dir, "../../.cache/pages/audio");
  const media = join(outDir, "media/audio");
  mkdirSync(cache, { recursive: true });
  mkdirSync(media, { recursive: true });
  const sheets = findSheets(source).sort((a, b) => a.owner.localeCompare(b.owner));
  const mapped = mappedSounds(sheets);
  const sounds: GuideSound[] = [];
  let baked = 0;
  for (const { owner, dir, sheet } of sheets) {
    for (const [occasion, cue] of Object.entries(sheet.sounds).sort(([a], [b]) => a.localeCompare(b))) {
      if (!Array.isArray(cue.takes) || !Number.isFinite(cue.level)) throw new Error(`invalid sound cue: ${owner}/${occasion}`);
      const rate = cue.rate ?? SOUND_RATE;
      if (!Number.isInteger(rate) || rate < 8000 || rate > 96000) throw new Error("unsupported sound rate");
      for (let i = 0; i < cue.takes.length; i++) {
        const take = cue.takes[i]!;
        const raw = readFileSync(soundSource(dir, take.file));
        const key = createHash("sha256").update(PROCESSOR).update(raw).update(JSON.stringify([take.start, take.end, take.gain, cue.level, rate, cue.highpass, cue.loop])).digest("hex");
        const cached = join(cache, `${key}.wav`);
        if (!existsSync(cached)) {
          const prepared = prepareTake(readWav(raw), take, cue);
          if (prepared.samples.some((n) => !Number.isFinite(n))) throw new Error("non-finite audio samples");
          writeFileSync(`${cached}.tmp-${process.pid}`, writeWav(prepared.samples, rate));
          renameSync(`${cached}.tmp-${process.pid}`, cached);
          baked++;
        }
        const wav = readFileSync(cached);
        const publicName = `${digest(wav)}.wav`;
        const target = join(media, publicName);
        linkMedia(cached, target);
        sounds.push({ id: `${owner}/sound/${occasion}/take/${i + 1}`, owner, label: words(occasion), occasion, url: `/media/audio/${publicName}`, seconds: (wav.length - 44) / 2 / rate, loop: cue.loop === true, usage: mapped.has(`${owner}/sound/${occasion}`) ? "game" : "library", take: i + 1, credit: "Game sound library" });
      }
    }
    options.progress?.(`${owner}: ${sounds.length} takes prepared (${baked} newly processed)`);
    await new Promise((done) => setTimeout(done, 0));
  }
  const music = buildMusic(outDir, source);
  return { sounds, music };
}

export function buildMusic(outDir: string, source = SOURCE): GuideMusic[] {
  const root = join(source, "core/music");
  const manifest = join(root, "music.json");
  if (!existsSync(manifest)) return [];
  const data = JSON.parse(readFileSync(manifest, "utf8")) as { tracks: { id: string; bpm: number; seconds: number; layers: string[] }[] };
  if (!Array.isArray(data.tracks)) throw new Error("invalid music manifest");
  return data.tracks.map((track) => {
    if (!SEGMENT.test(track.id) || !Array.isArray(track.layers) || !Number.isFinite(track.bpm) || !Number.isFinite(track.seconds) || track.seconds <= 0) throw new Error("invalid music track");
    const layers = track.layers.map((name) => {
      if (!SEGMENT.test(name)) throw new Error("invalid music layer");
      const file = realpathSync(join(root, track.id, `${name}.opus`));
      if (!file.startsWith(realpathSync(root) + sep)) throw new Error("music outside source root");
      const bytes = readFileSync(file);
      const url = `/media/music/${digest(bytes)}.opus`;
      const target = join(outDir, url.slice(1));
      mkdirSync(dirname(target), { recursive: true });
      if (!existsSync(target)) writeFileSync(target, bytes);
      return { name, url };
    });
    return { id: track.id, label: words(track.id), bpm: track.bpm, seconds: track.seconds, layers, credit: "Game adaptive soundtrack" };
  });
}
