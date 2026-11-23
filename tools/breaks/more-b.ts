// Sample components with geometry of their own: the sheet bay, the pitched roof and the balcony.

import { balcony } from "./balcony.ts";
import type { Component } from "./forms.ts";
import { pitchedRoofSample } from "./roof.ts";
import { sheetBay } from "./sheet-bay.ts";

export const MORE_B: readonly Component[] = [sheetBay(), pitchedRoofSample(), balcony()];
