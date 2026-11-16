// The server's own commands, by family: the host registers them all, and the wiki lists them under these names.

import type { Console } from "../console.ts";
import { addAdminCommands } from "./admin.ts";
import { addClusterCommands } from "./cluster.ts";
import { addCombatCommands } from "./combat.ts";
import { addCoreCommands } from "./core.ts";
import { addCreatureCommands } from "./creatures.ts";
import { addSettingsCommands } from "./settings.ts";
import { addSocialCommands } from "./social.ts";

export const COMMAND_FAMILIES: readonly (readonly [family: string, add: (con: Console) => void])[] = [
  ["Session and world", addCoreCommands],
  ["Moving and making", addAdminCommands],
  ["Combat and equipment", addCombatCommands],
  ["Tribes and talk", addSocialCommands],
  ["Creatures and breeding", addCreatureCommands],
  ["Settings", addSettingsCommands],
  ["Cluster", addClusterCommands],
];
