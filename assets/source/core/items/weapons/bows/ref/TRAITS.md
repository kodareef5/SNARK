# The bow and the crossbow: trait sheet

What makes a bow and a crossbow read as ARK: Survival Evolved's, written for the concept painter, the modeller and the
material maker. From public pages only (see [SOURCES.md](SOURCES.md)). Ratios are by eye; treat every number as
"about".

## The bow

1. **Made in the hand from what a survivor has in the first hour:** 15 wood and 50 fibre, at level 10 after the
   slingshot. Wood and plant fibre, nothing forged.
2. **A recurve "in the Mongolian style"** (the Bow page's trivia): the limbs sweep back from the grip toward the archer,
   and near each tip the curve reverses into a stiff ear that points almost straight up, the string lying along the
   ear's belly from its nock to a bridge at the knee. Seen from the side it is a strong, double-curved line, and that
   profile is how it reads.
3. **Held upright in the left hand**, the arrow on the right of the grip for a right-handed archer, drawn back with the
   right.

| The read at a glance | Proportions, by eye |
|---|---|
| A tall double-curved line with a straight string behind it | 1.3 m tip to tip, the string about 0.15 m behind the grip |

## The crossbow

1. **A smithy's weapon:** 7 metal ingots, 10 wood, 35 fibre at the refining forge. A wooden tiller, a metal prod, a
   fibre string. It fires the bow's arrows, and fires under water.
2. **Heavier than the bow, and slower:** it looks blunt and powerful.

| The read at a glance | Proportions, by eye |
|---|---|
| A T: a thick tiller and a prod across its nose, with a V of string drawn back to the nut | 0.78 m from the butt to the stirrup; the prod 0.6 m across |

## What does not matter to the read

The wood's species, the number of turns of a binding, the trigger's mechanism, how the prod is seated.

## What is deliberately ours

SNARK is a parody with its own look: readable, low-poly, chunky and a little playful, made to sit beside the stone tools
(`core/items/stone-tools/`), whose materials both share.

- **Chunky:** the bow's limbs about 20% wider and thicker than a real bow's; the crossbow's tiller a square beam.
- **The stone tools' cord.** A thick binding of tan fibre where each ear joins its limb, with two short cut tails, as
  the tools have; the crossbow's prod held on by a figure-eight binding of the same cord.
- **A spiral of hide on the bow's grip**, and a carved arrow shelf on its left.
- **Carved nock knobs** at the ears' tips.
- **A steel stirrup** at the crossbow's nose for the foot when cocking, and a raked wooden pistol grip under the tiller.

## The bow in the left hand

The box `tools/pack/weapons.ts` draws for the bow is held on the left hand's prop bone, with its limbs along Y and the
arrow along +X: the axes the left-hand animations were made for. `model.py` builds the bow in those axes ("bow"). But
the art check (`tools/art/check.ts`, `heldFaults`) holds any held piece, `prop_l` as `prop_r`, to the right hand's
rule: its longest extent along +Z, further forward than back. A bow in its own axes is longest along Y and fails it,
and turning it to pass would draw it lying across the hand. So until a left-hand axis is stated (D401's open point),
this asset ships only the bow's lying piece, `core:bow/dropped` (the bow on its side, as a bag of one bow shows it and
its inventory picture is drawn from), and the box stays in the hand. The held bow is in the scene, ready: naming it
`{ id: "core:bow", object: "bow", hold: "prop_l", dropped: "bow_lying" }` is all that is left once the check knows the
left hand's axes.

Nothing here is copied from a picture of ARK's weapons: no picture of them was given to the image model or traced.
