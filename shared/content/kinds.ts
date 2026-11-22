// Every kind of content, in the order compileContent walks them (registry.ts) and the class table lists their classes
// (classes.ts). A new kind is a file under kinds/ and a line here.

import { buffs } from "./kinds/buffs.ts";
import { damage } from "./kinds/damage.ts";

export const KINDS = [buffs, damage] as const;
