// Binds the HUD view model to DOM nodes. Writes only what changed.

import type { HudModel } from "../core/hud.ts";

const MARKER_COLORS: Record<string, string> = { self: "#fff", player: "#e05050", creature: "#40aaaa", spawn: "#60b068", death: "#111" };

export class HudView {
  private readonly text: HTMLElement;
  private readonly bars = new Map<string, HTMLElement>();
  private readonly map: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private last = "";

  constructor(root: HTMLElement, model: HudModel, minimap: Uint8ClampedArray, size: number) {
    this.text = root.querySelector("#readout")!;
    const vitals = root.querySelector("#vitals")!;
    for (const v of model.vitals) {
      const row = document.createElement("div");
      row.className = "vital";
      row.innerHTML = `<span>${v.label}</span><i><b></b></i>`;
      vitals.append(row);
      this.bars.set(v.id, row.querySelector("b")!);
    }
    const canvas = root.querySelector<HTMLCanvasElement>("#minimap")!;
    canvas.width = canvas.height = size;
    this.map = canvas.getContext("2d")!;
    this.image = new ImageData(new Uint8ClampedArray(minimap), size, size);
  }

  update(m: HudModel): void {
    const text =
      `${m.lat.toFixed(1)} lat  ${m.lon.toFixed(1)} lon  ${m.compass} ${m.heading.toFixed(0)}\n` +
      `x ${m.x.toFixed(1)}  y ${m.y.toFixed(1)}  z ${m.z.toFixed(1)}  ${m.speed.toFixed(1)} m/s\n` +
      `${m.fps.toFixed(0)} fps  ${m.pingMs.toFixed(0)} ms  ${m.corrections} corrections  ${m.nearby} nearby`;
    if (text !== this.last) this.text.textContent = this.last = text;
    for (const v of m.vitals) this.bars.get(v.id)!.style.width = `${Math.round(v.fraction * 100)}%`;
    const size = this.image.width;
    this.map.putImageData(this.image, 0, 0);
    for (const k of m.markers) {
      this.map.fillStyle = MARKER_COLORS[k.kind] ?? "#fff";
      this.map.fillRect(k.u * size - 2, k.v * size - 2, 4, 4);
    }
  }
}
