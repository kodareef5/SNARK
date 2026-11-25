// The page's side of the screens' video (core/video/player.ts): its elements, hidden in the page so a phone plays them
// inline, the manifest and posters fetched from our own server, and the sound routed into the world's. A map with an
// orb fetches this file with the orb's; no other does.

import type { Picture, VideoHost, VideoLike } from "../core/video/player.ts";
import type { SoundIo } from "../sound/sound.ts";

export function videoHost(sound: SoundIo | null): VideoHost {
  return {
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
    json: (path) => fetch(path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path}: ${r.status}`)))),
    async image(path): Promise<Picture> {
      const r = await fetch(path);
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      const bitmap = await createImageBitmap(await r.blob());
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    },
    visible: () => !document.hidden,
    audible: () => sound?.running ?? false,
    sound: (v, on, x, y, z, gain) => sound?.screen(v as unknown as HTMLMediaElement, on, x, y, z, gain),
  };
}
