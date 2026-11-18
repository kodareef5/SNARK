// Blender reads the exact same measured seats, drive pivots and boarding positions as the game.
import { POWER_CATS } from "../../../../../content/vehicles/power-cats.ts";
console.log(JSON.stringify(POWER_CATS.find(m => m.id === `core:${process.argv[2]}`)));
