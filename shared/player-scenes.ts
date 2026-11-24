import declarations from "./player-scene-declarations.json" with { type: "json" };
import { CAMERA_FIELDS, OPENING_SHOT, validShot, type CameraField, type TitleShot } from "./title-scene.ts";

export const SCENE_CATEGORIES = ["title", "loaders", "wiki"] as const;
export type SceneCategory = typeof SCENE_CATEGORIES[number];
export type EditableSceneCategory = Exclude<SceneCategory, "wiki">;

const loaderCamera: TitleShot["camera"] = { side: -2.7, back: 4.2, height: 1.35, pan: 5, tilt: 10, lens: 55, hour: 17.65 };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Apply a declaration's camera overrides to the default Wynwood camera for its category. */
export function compileSceneDeclarations(input: unknown): Record<EditableSceneCategory, TitleShot[]> {
  if (!isRecord(input) || !Array.isArray(input.scenes) || Object.keys(input).some((key) => key !== "$schema" && key !== "scenes")) {
    throw Error("Player scene declarations need a scenes array.");
  }
  const catalog: Record<EditableSceneCategory, TitleShot[]> = { title: [], loaders: [] };
  const ids = new Set<string>();
  for (const [i, entry] of input.scenes.entries()) {
    const where = `Player scene ${i + 1}`;
    if (!isRecord(entry) || Object.keys(entry).some((key) => !["id", "category", "name", "subject", "camera"].includes(key))) {
      throw Error(`${where} may contain id, category, name, subject and camera.`);
    }
    const { id, category, name, subject, camera } = entry;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) throw Error(`${where} needs a lowercase slug ID.`);
    if (ids.has(id)) throw Error(`${where} duplicates the ID ${id}.`);
    ids.add(id);
    if (category !== "title" && category !== "loaders") throw Error(`${where} (${id}) needs category title or loaders.`);
    if (typeof name !== "string" || !name.trim() || name.length > 80) throw Error(`${where} (${id}) needs a name of 1 to 80 characters.`);
    if (subject !== undefined && subject !== "rider" && subject !== "rex" && subject !== "coast") {
      throw Error(`${where} (${id}) needs subject rider, rex or coast.`);
    }
    const values = { ...(category === "title" ? OPENING_SHOT.camera : loaderCamera) };
    if (camera !== undefined) {
      if (!isRecord(camera)) throw Error(`${where} (${id}) needs camera overrides as an object.`);
      for (const [key, value] of Object.entries(camera)) {
        if (!Object.hasOwn(CAMERA_FIELDS, key)) throw Error(`${where} (${id}) has unknown camera field ${key}.`);
        const field = key as CameraField, [, low, high] = CAMERA_FIELDS[field];
        if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) {
          throw Error(`${where} (${id}) needs camera ${field} between ${low} and ${high}.`);
        }
        values[field] = value;
      }
    }
    catalog[category].push({ id, name: name.trim(), set: OPENING_SHOT.set, camera: values, ...(subject ? { subject } : {}) });
  }
  for (const category of ["title", "loaders"] as const) {
    const count = catalog[category].length;
    if (count < 1 || count > 32) throw Error(`Player scene category ${category} needs 1 to 32 declarations.`);
  }
  return catalog;
}

const authored = compileSceneDeclarations(declarations);
export const DEFAULT_TITLE_SHOT = authored.title[0]!;
export const DEFAULT_LOADER_SHOT = authored.loaders[0]!;
export const LOADER_SCENE_URL = "/cluster/loader-scene.json";
export const LOADER_POSTER_URL = "/cluster/loader-poster.webp";

export interface LoaderScene {
  shot: TitleShot;
  landscape: string;
  portrait: string;
}

export function loaderScene(shot = DEFAULT_LOADER_SHOT): LoaderScene {
  return { shot, landscape: LOADER_POSTER_URL, portrait: `${LOADER_POSTER_URL}?portrait` };
}

export function readLoaderScene(raw: unknown): LoaderScene | null {
  if (!raw || typeof raw !== "object" || !("shot" in raw) || !validShot(raw.shot)) return null;
  return loaderScene(raw.shot);
}

export interface ShotCatalog {
  revision: number;
  active: string;
  published: TitleShot;
  shots: TitleShot[];
}

export function initialShots(category: EditableSceneCategory): ShotCatalog {
  const shots = [...authored[category]];
  const published = shots[0]!;
  return { revision: 0, active: published.id, published, shots };
}

export type SceneActor = readonly [kind: string, x: number, z: number, yaw: number, pose?: string, altitude?: number, on?: number, saddle?: string, wear?: "hide" | "cloth" | "meridian"];
export type SceneProp = readonly [kind: string, x: number, z: number, yaw?: number, lift?: number];
export type SceneView = readonly [x: number, height: number, z: number, yaw: number, pitch: number, fov: number];
export type ScenePosition = readonly [x: number, z: number, yaw: number];

export interface SectionComposition {
  route: string;
  caption: string;
  alt: string;
  hour: number;
  view: SceneView;
  actors: readonly SceneActor[];
  props?: readonly SceneProp[];
  plants?: readonly SceneProp[];
  landmark?: string;
  absoluteHeight?: boolean;
  eyeSeconds?: number;
  time?: number;
  city?: boolean;
}

type MapPoint = readonly [longitude: number, latitude: number, metresUp: number];
export type MapCamera = { at: MapPoint; towards: MapPoint; hour: number; eyeSeconds?: number };
export type InstrumentCamera = { view: string; hour: number; over?: number; x?: number; z?: number; look?: [number, number, number] };

interface WikiRecipe {
  id: string;
  name: string;
  alt: string;
  route: string;
  map: string;
}

export type WikiSceneRecipe = WikiRecipe & (
  { kind: "shore"; shot: TitleShot; seconds: number }
  | { kind: "section"; composition: SectionComposition; position: ScenePosition }
  | { kind: "city"; camera: MapCamera }
  | { kind: "obelisk"; camera: InstrumentCamera }
);

export interface SceneImage {
  file: string;
  width: number;
  height: number;
}

export interface WikiSceneMedia {
  landscape: SceneImage;
  portrait?: SceneImage;
}

export interface WikiSceneCatalog {
  recipes: WikiSceneRecipe[];
  media: Record<string, WikiSceneMedia>;
}
