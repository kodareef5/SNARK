// Public static-guide data. These records contain no account, save, ownership or live entity identifiers.

export type EntryKind = "creatures" | "characters" | "vehicles" | "items" | "engrams" | "structures";
export interface GuideFact { label: string; value: string; unit?: string }
export interface GuideLink { id: string; label: string; relation: string }
export interface GuideEntry {
  id: string;
  kind: EntryKind;
  classId: string;
  label: string;
  description: string;
  status: "built" | "partial" | "stub";
  tags: string[];
  facts: GuideFact[];
  links: GuideLink[];
  modelId?: string;
}
export interface GuideImage { src: string; label: string; width?: number; height?: number }
export interface GuideClip { id: string; label: string; seconds: number; loop: boolean }
export interface GuideModel {
  id: string;
  label: string;
  url: string;
  bytes: number;
  poster: string;
  images: GuideImage[];
  clips: GuideClip[];
  credit?: string;
}
export interface GuideSound {
  id: string;
  owner: string;
  label: string;
  occasion: string;
  url: string;
  seconds: number;
  loop: boolean;
  usage: "game" | "library";
  take: number;
  credit?: string;
}
export interface GuideMusic {
  id: string;
  label: string;
  bpm: number;
  seconds: number;
  layers: { name: string; url: string }[];
  credit?: string;
}
export interface GuideMapLayer { id: string; label: string; image: string }
export interface GuidePlace { id: string; label: string; x: number; y: number; kind: string }
export interface GuideMap {
  id: string;
  label: string;
  description: string;
  image: string;
  width: number;
  height: number;
  metres: number;
  layers: GuideMapLayer[];
  places: GuidePlace[];
  facts: GuideFact[];
  credit: string;
}
export interface GuideSetting { key: string; label: string; value: string; default: string; group: string; description: string }
export interface GuideServer {
  id: string;
  label: string;
  mapId: string;
  sampledAt: string | null;
  players: string[];
  capacity: number | null;
  settings: GuideSetting[];
  facts: GuideFact[];
}
export interface GuideData {
  version: 1;
  generatedAt: string;
  revision: string;
  cluster: { id: string; label: string; mode: "catalogue" | "snapshot"; description: string };
  entries: GuideEntry[];
  maps: GuideMap[];
  servers: GuideServer[];
  models: Record<string, GuideModel>;
  sounds: GuideSound[];
  music: GuideMusic[];
}
