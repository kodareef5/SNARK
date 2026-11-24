import { takeSamples } from "../core/wiki/sound.ts";

type Take = {
  button: HTMLButtonElement;
  row: HTMLElement;
  source: AudioBufferSourceNode | null;
};

function takeState(take: Take, state: "idle" | "loading" | "playing" | "failed"): void {
  const { button, row } = take;
  const status = row.querySelector<HTMLElement>("[data-audio-status]");
  if (state === "idle") delete button.dataset.state;
  else button.dataset.state = state;
  button.classList.toggle("failed", state === "failed");
  if (state === "loading") button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
  const pressed = String(state === "playing");
  if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
  if (status) status.textContent = state === "loading" ? "Loading sound…" : state === "failed" ? "Sound unavailable. Press play to retry." : "";
}

export function wireAudio(): void {
  let context: AudioContext | null = null;
  let active: Take | null = null;
  const cached = new WeakMap<HTMLButtonElement, Promise<AudioBuffer>>();

  function stopTake(): void {
    if (!active) return;
    const take = active;
    active = null;
    take.source?.stop();
    take.source?.disconnect();
    takeState(take, "idle");
  }

  function pauseMusic(keep?: HTMLAudioElement): void {
    for (const music of document.querySelectorAll<HTMLAudioElement>("audio[data-wiki-audio]")) {
      if (music !== keep && !music.paused) music.pause();
    }
  }

  function bufferOf(take: Take, audio: AudioContext): Promise<AudioBuffer> {
    const { button, row } = take;
    const kept = cached.get(button);
    if (kept) return kept;
    const requested = takeSamples(row.dataset, Number(button.dataset.k), fetch).then((samples) => {
      const buffer = audio.createBuffer(1, samples.length, Number(row.dataset.rate));
      buffer.copyToChannel(samples, 0);
      return buffer;
    }).catch((error: unknown) => {
      cached.delete(button);
      throw error;
    });
    cached.set(button, requested);
    return requested;
  }

  async function play(take: Take): Promise<void> {
    try {
      const audio = context ??= new AudioContext();
      const resumed = audio.resume();
      const [buffer] = await Promise.all([bufferOf(take, audio), resumed]);
      if (active !== take) return;
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.destination);
      source.onended = () => {
        if (active !== take) return;
        active = null;
        source.disconnect();
        takeState(take, "idle");
      };
      take.source = source;
      source.start();
      takeState(take, "playing");
    } catch {
      if (active !== take) return;
      active = null;
      take.source?.disconnect();
      takeState(take, "failed");
    }
  }

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-k]");
    const row = button?.closest<HTMLElement>("[data-takes]");
    if (!button || !row) return;
    const repeat = active?.button === button;
    stopTake();
    if (repeat) return;
    pauseMusic();
    active = { button, row, source: null };
    takeState(active, "loading");
    void play(active);
  });

  document.addEventListener("play", ({ target }) => {
    if (!(target instanceof HTMLAudioElement) || !target.hasAttribute("data-wiki-audio") || target.paused) return;
    stopTake();
    pauseMusic(target);
  }, true);

  document.addEventListener("error", ({ target }) => {
    if (!(target instanceof HTMLAudioElement) || !target.hasAttribute("data-wiki-audio")) return;
    const status = target.parentElement?.querySelector<HTMLElement>("[data-audio-status]");
    if (status) status.textContent = "Track unavailable.";
  }, true);

  addEventListener("pagehide", () => {
    stopTake();
    pauseMusic();
  });
}
