import type { Cell, Entry, Kind } from "./catalogue.ts";

export interface Directory {
  columns: string[];
  rows: { entry: Entry; cells: Cell[][]; filters: Record<string, string> }[];
  filters: { key: string; label: string; values: string[] }[];
}

const fact = (entry: Entry, label: string): Cell[] => entry.facts.find((f) => f.label === label)?.value ?? [];

function yields(entry: Entry): Cell[] {
  const table = entry.tables.find((t) => t.title === "Picking" || t.title === "Gathering");
  return (table?.rows ?? []).flatMap(([item], index) => item && !Array.isArray(item) ? [...(index ? [", "] : []), item] : []);
}

type DirectoryRow = Omit<Directory["rows"][number], "entry">;
interface Layout {
  columns: string[];
  filters: Record<string, string>;
  row(entry: Entry): DirectoryRow;
}

const LAYOUTS: Partial<Record<Kind, Layout>> = {
  creatures: {
    columns: ["Type", "Temperament", "Taming", "Saddle", "Breeds"],
    filters: { group: "Type", temper: "Temperament", tameable: "Tameable", rideable: "Rideable" },
    row(entry) {
      const temper = fact(entry, "Temperament");
      const tame = fact(entry, "Tameable");
      const saddle = fact(entry, "Rideable").filter((cell) => typeof cell !== "string");
      const breeds = fact(entry, "Breeds");
      return {
        cells: [[entry.group], temper, tame, saddle, breeds.length ? breeds : ["No"]],
        filters: { group: entry.group, temper: String(temper[0] ?? ""), tameable: tame[0] === "By knockout" ? "Yes" : "No", rideable: saddle.length ? "Yes" : "No" },
      };
    },
  },
  items: {
    columns: ["Type", "Unlock", "Made at", "Stack"],
    filters: { group: "Type", recipe: "Crafting" },
    row(entry) {
      const station = fact(entry, "Crafted at");
      const heated = fact(entry, "Made in");
      const craft = entry.tables.some((table) => table.title === "Crafting");
      const made = station.length ? station : heated.length ? heated : craft ? ["Inventory"] : [];
      return {
        cells: [[entry.group], fact(entry, "Engram"), made, fact(entry, "Stack")],
        filters: { group: entry.group, recipe: craft ? "Has recipe" : "No recipe" },
      };
    },
  },
  resources: {
    columns: ["Type", "Yields", "Tools", "Regrows"],
    filters: { group: "Type" },
    row(entry) {
      const tools = fact(entry, "Worked with");
      return {
        cells: [[entry.group], yields(entry), tools.length ? tools : ["By hand"], fact(entry, "Grows back").slice(0, 1)],
        filters: { group: entry.group },
      };
    },
  },
  vehicles: {
    columns: ["Type", "Top speed", "Seats", "Fuel tank"],
    filters: { group: "Type" },
    row(entry) {
      return {
        cells: [[entry.group], fact(entry, "Top speed"), fact(entry, "Seats"), fact(entry, "Fuel tank")],
        filters: { group: entry.group },
      };
    },
  },
};

export function buildDirectory(kind: Kind, entries: readonly Entry[]): Directory | undefined {
  const layout = LAYOUTS[kind];
  if (!layout) return undefined;
  const rows = entries.filter((entry) => entry.kind === kind).map((entry) => ({ entry, ...layout.row(entry) }));
  const filters = Object.entries(layout.filters).map(([key, label]) => ({
    key, label, values: [...new Set(rows.map((row) => row.filters[key]).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b)),
  }));
  return { columns: layout.columns, rows, filters };
}
