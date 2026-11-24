import { AT_DEFAULTS, tamingMaximum, tamingRow, type TamingInput } from "../core/wiki/rates.ts";
import type { ServerSaid } from "../core/wiki/world.ts";

export function setupTamingTools(settings: Promise<ServerSaid | null>): void {
  for (const form of document.querySelectorAll<HTMLFormElement>("[data-taming-tools]")) {
    const input = form.querySelector<HTMLInputElement>("input[name=level]");
    const message = form.querySelector<HTMLOutputElement>("output");
    const table = form.closest("section")?.querySelector<HTMLTableElement>("table[data-taming]");
    const samples = table?.tBodies[0];
    const result = table?.querySelector<HTMLTableSectionElement>("[data-taming-result]");
    if (!input || !message || !table?.dataset.taming || !samples || !result) continue;
    const tame = JSON.parse(table.dataset.taming) as TamingInput;
    let world = AT_DEFAULTS;
    const update = (): void => {
      const maximum = tamingMaximum(world);
      input.max = String(maximum);
      const level = input.valueAsNumber;
      const valid = Number.isInteger(level) && level >= 1 && level <= maximum;
      const invalid = !valid && (input.value !== "" || input.validity.badInput);
      if (invalid) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      result.hidden = !valid;
      samples.hidden = valid;
      result.replaceChildren();
      if (valid) {
        const row = result.insertRow();
        for (const [index, value] of tamingRow(tame, level, world).entries()) {
          const cell = row.appendChild(document.createElement(index ? "td" : "th"));
          if (index === 0) cell.scope = "row";
          cell.textContent = value;
        }
      }
      message.value = valid ? `Estimate for level ${level}. Clear the field to show example levels.`
        : invalid ? `Enter a whole level from 1 to ${maximum}.` : `Enter a level from 1 to ${maximum} for an estimate.`;
    };
    form.addEventListener("submit", (event) => event.preventDefault());
    input.addEventListener("input", update);
    update();
    form.hidden = false;
    void settings.then((said) => {
      if (!said) return;
      world = said;
      update();
    }, () => {});
  }
}
