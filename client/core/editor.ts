// The editor's code, fetched when first needed (editor-load.ts): build mode, the template hammer, and the plans.

import { pieceBook } from "../../shared/world/plan.ts";
import { Builder } from "./build.ts";
import { offerEditor } from "./editor-load.ts";
import { Hammer } from "./hammer.ts";

offerEditor({ Builder, Hammer, pieceBook });
