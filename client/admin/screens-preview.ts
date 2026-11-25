// The Screens page's preview, built on its own: the twin it draws with is far larger than the page, so the page loads it as a script when it first draws.
import { PREVIEW_VIEWS, drawPreview } from "../core/admin/screens-preview.ts";

(globalThis as { screensPreview?: unknown }).screensPreview = { PREVIEW_VIEWS, drawPreview };
