# Declare a player scene

Add an entry to [player-scene-declarations.json](player-scene-declarations.json).
Give it a unique lowercase `id`, a `category` of `title` or `loaders`, and a
player-facing `name`. Keep an existing ID when changing its composition or
label. The first entry in each category supplies the default on a new cluster.

```json
{ "id": "shore-at-dusk", "category": "loaders", "name": "Shore at dusk", "camera": { "hour": 18.1 } }
```

You can omit `camera` or override any of its fields. The category supplies its
Wynwood framing. Use `subject` to choose `rider`, `rex`, or `coast`. The
mounted rider is the default. Truck, dolly, and height are in metres. Pan, tilt, and field of
view are in degrees. `hour` sets the local sun hour. The adjacent schema supplies
the bounds. The build also checks ID uniqueness and requires at least one scene
in each category.

Run `bun run build` and open Scene Studio under `/admin/scenes/`. Preview both
frames before publishing. The cluster keeps existing saved shots and publishes
the chosen title and loader independently.

Wiki composition lives with the native recipes in `tools/wiki/photo-recipes.ts`
and `tools/wiki/places-shots.ts`. The game build lists those recipes in Scene
Studio. Run `bun run wiki` to generate their optional preview images.
