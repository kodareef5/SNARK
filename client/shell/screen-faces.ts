// The page's side of the screens on props (core/video/faces.ts): pictures fetched from our own server and decoded at a
// layer's size away from the page's thread, and clips' elements hidden in the page so a phone plays them inline. The
// page fetches this file the first frame a screen is in reach.

import type { FaceHost } from "../core/video/faces.ts";
import type { VideoLike } from "../core/video/player.ts";

export function faceHost(): FaceHost {
  return {
    json: (path) => fetch(path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path}: ${r.status}`)))),
    async image(path, width, height) {
      const r = await fetch(path);
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return createImageBitmap(await r.blob(), { resizeWidth: width, resizeHeight: height, resizeQuality: "medium", premultiplyAlpha: "none" });
    },
    video(): VideoLike {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "none";
      v.disablePictureInPicture = true;
      v.setAttribute("playsinline", "");
      v.setAttribute("aria-hidden", "true");
      Object.assign(v.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0.01", pointerEvents: "none", zIndex: "-1" });
      document.body.appendChild(v);
      return v as unknown as VideoLike;
    },
    visible: () => !document.hidden,
  };
}
