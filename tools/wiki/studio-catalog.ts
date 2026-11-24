import type { WikiSceneMedia, WikiSceneRecipe } from "../../shared/player-scenes.ts";
import { OPENING_SHOT } from "../../shared/title-scene.ts";
import { FOOTER_SHOT, photoName, photoPosition, WIKI_HOME_SECONDS, WIKI_FOOTER_SECONDS, WIKI_SCENE_BRIEFS } from "./photo-recipes.ts";
import { PLACE_RECIPES, type PlaceShot } from "./places-shots.ts";
import type { WikiScene } from "./scenes.ts";

const sectionId = (route: string) => `wiki-${photoName(route)}`;
const placeId = (city: string, name: string) => `wiki-${city}-${name}`;

export function wikiSceneCatalog(): WikiSceneRecipe[] {
  const sections: WikiSceneRecipe[] = WIKI_SCENE_BRIEFS.map((composition) => {
    const { route, caption: name, alt } = composition;
    const common = { id: sectionId(route), name, alt, route: `/wiki/${route === "footer" ? "" : route}`, map: "miami" };
    if (!route || route === "footer") {
      const shot = route === "footer" ? FOOTER_SHOT : OPENING_SHOT;
      return { ...common, kind: "shore", shot, seconds: route === "footer" ? WIKI_FOOTER_SECONDS : WIKI_HOME_SECONDS };
    }
    return { ...common, kind: "section", composition, position: photoPosition(route) };
  });
  const places: WikiSceneRecipe[] = Object.entries(PLACE_RECIPES).flatMap(([map, shots]) => shots.map(({ name: id, caption: name, alt, ...shot }) => ({
    id: placeId(map, id), name, alt, route: `/wiki/maps/${map}/`, map, ...shot,
  })));
  return [...sections, ...places];
}

export function wikiSceneMedia(scenes: ReadonlyMap<string, WikiScene>, places: ReadonlyMap<string, PlaceShot[]>): Record<string, WikiSceneMedia> {
  const media: Record<string, WikiSceneMedia> = {};
  for (const [route, scene] of scenes) media[sectionId(route)] = { landscape: scene.picture, portrait: scene.portrait };
  for (const [map, photos] of places) for (const photo of photos) {
    if (photo.name) media[placeId(map, photo.name)] = { landscape: photo };
  }
  return media;
}
