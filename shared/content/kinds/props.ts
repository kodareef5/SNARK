// Props: what stands in the world and neither moves nor lives. A dropped bag, an egg, a cloud of gas, a supply crate.

import { drawnFaults, f, f32, mesh, row, u16, u8, type Fields, type Kind, type Named } from "../kind.ts";

/** An entity that stands in the world but does not move or live, such as an item cache. Its record can hold an inventory. */
export interface PropDef extends Named {
  readonly type: "prop";
  readonly class: "container" | "projectile" | "egg" | "crate" | "cloud";
  readonly id: string;
  readonly mesh: string;
  readonly color: number;
  readonly radius: number;
  readonly height: number;
  /** Inventory slots of its record. */
  readonly slots?: number;
  /** It is drawn tilted to its pitch as well as turned to its facing, with its mesh's +Z leading, like an arrow stuck where it landed. */
  readonly pitched?: boolean;
  /** Drawn at this multiple of its mesh's modelled size. 1 where not given. */
  readonly size?: number;
  /** An egg: the item it is when picked up. */
  readonly item?: string;
  /** An egg: the item it is when picked up fertilised, which stacks to 1 and keeps the young it holds. */
  readonly fertile?: string;
}

const FIELDS = {
  mesh: f("text"),
  color: f("number"),
  radius: f("number"),
  height: f("number"),
  slots: f("number"),
  pitched: f("switch"),
  size: f("number", "the egg's size class"),
  item: f("text", "the egg item a dropped egg is", { refs: { "": "item/egg" } }),
  fertile: f("text", "the egg item a fertilised egg is", { refs: { "": "item/egg" } }),
} satisfies Fields<PropDef>;

const PROP_BODY = ["mesh", "color", "radius", "height"] as const;
const PROP_SLOTS = { mesh: mesh("must", "{mesh}", "box") };

const columns = (n: number) => ({
  /** 1 for a kind whose inventory is only ever taken from: a supply capsule (prop/crate). Nothing is put in or swapped in. */
  takeOnly: u8(n),
  /** Per prop: the multiple of its mesh's modelled size it is drawn at, 1 for everything else; for an egg, the item it is once picked up (0 for none). */
  drawSize: f32(n, 1),
  propItem: u16(n),
  /** Per prop: for an egg, the item it is once picked up fertilised (0 for none). */
  propFertile: u16(n),
});

export const props: Kind<PropDef, ReturnType<typeof columns>> = {
  type: "prop",
  fields: FIELDS,
  rows: [
    row("prop", "prop", FIELDS, { abstract: true, ark: "an actor that is not alive", shelf: "props", doc: "Stands in the world and neither moves nor lives." }),
    row("prop/container", "prop", FIELDS, { parent: "prop", ark: "a death cache, a dropped bag", shelf: "props/containers", must: [...PROP_BODY, "slots"], slots: PROP_SLOTS, doc: "Holds what was dropped or left by the dead." }),
    row("prop/projectile", "prop", FIELDS, { parent: "prop", ark: "a projectile actor", status: "partial", shelf: "props/projectiles", must: PROP_BODY, may: ["pitched"], slots: PROP_SLOTS, doc: "Something loosed or thrown, where it lies. How it flies is on the ammunition." }),
    row("prop/egg", "prop", FIELDS, { parent: "prop", ark: "a laid or dropped egg, fertilised or not", shelf: "props/eggs", must: PROP_BODY, may: ["size", "item", "fertile"], slots: PROP_SLOTS, doc: "An egg where it lies: taken up as its item, and hatching where it lies if fertilised." }),
    row("prop/cloud", "prop", FIELDS, { parent: "prop", ark: "the gas and smoke actors of grenades", shelf: "props/clouds", must: PROP_BODY, slots: PROP_SLOTS, doc: "Smoke or gas that stays where a grenade burst, as far as its radius and as high as its height, for its grenade's seconds, giving its buff to the survivors inside it every half second (server/clouds.ts). It has no body, and is drawn as puffs over that reach (client/core/render/clouds.ts); its mesh is not drawn." }),
    row("prop/crate", "prop", FIELDS, { parent: "prop", ark: "SupplyCrate_", shelf: "props/crates", must: [...PROP_BODY, "slots"], slots: PROP_SLOTS, doc: "A supply drop's capsule where it landed: it holds what was rolled for it, is only ever taken from, and goes when it is emptied or its time is up (server/supply.ts)." }),
  ],
  check(d, cx) {
    const { positive } = cx;
    // A cloud's radius is its reach, not a body's (server/clouds.ts).
    positive(d, "radius", d.radius, d.class === "cloud" ? 32 : 8);
    positive(d, "height", d.height, 32);
    if (d.size !== undefined) positive(d, "size", d.size, 8);
    drawnFaults(d, cx);
  },
  among(d, { errors, input }) {
    if (d.fertile !== undefined && input.some((o) => o.id === d.fertile && o.type === "item" && o.stack !== 1)) errors.push(`${d.id}: its fertile item must stack to 1`);
  },
  columns,
  fill(d, i, reg) {
    // A cloud has no body, so nothing aims at it, opens it or meets it; its reach is its definition's (server/clouds.ts).
    const body = d.class !== "cloud";
    reg.bodyRadius[i] = body ? d.radius : 0;
    reg.bodyHeight[i] = body ? d.height : 0;
    reg.drawSize[i] = d.size ?? 1;
  },
  link(d, i, reg) {
    if (d.item !== undefined) reg.propItem[i] = reg.index.get(d.item)!;
    if (d.fertile !== undefined) reg.propFertile[i] = reg.index.get(d.fertile)!;
    if (d.class === "crate") reg.takeOnly[i] = 1;
  },
};
