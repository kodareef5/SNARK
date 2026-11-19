import { readFileSync } from "node:fs";
import {
  streetCar,
  type StreetCar,
} from "../../../../../content/vehicles/street-cars.ts";
import { heavyRoadAsset } from "../heavy_road/spec.ts";

export function streetAsset(folder: string, name: StreetCar) {
  const budgets: number[] = JSON.parse(
    readFileSync(folder + "/budgets.json", "utf8"),
  );
  return heavyRoadAsset(folder, name, streetCar(name).anchors, budgets);
}
