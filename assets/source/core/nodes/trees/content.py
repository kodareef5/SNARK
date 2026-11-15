# Prints what content/core.ts should say of each tree kind for these meshes: its variants, each with its weight and
# the boxes a body bumps into, its sizes, and the stump each leaves with its boxes. The boxes are measured on the same
# skeletons the meshes are built from, in metres from the mesh's origin at its modelled size. Run with python3 from
# this folder and paste the lines over the kinds' variants.

import math

import banyans
import figs
import mangroves
import oaks
import palms
import young

# kind: (module, size range, a weight for each individual in the module's order)
KINDS = {
    "core:palm": (palms, (0.85, 1.15), (3, 2, 2, 3, 2, 2)),
    "core:tree": (young, (0.85, 1.15), (3, 3, 2, 2)),
    "core:oak": (oaks, (0.85, 1.2), (3, 2, 2)),
    "core:fig": (figs, (1.0, 1.25), (2, 3, 2)),
    "core:banyan": (banyans, (0.9, 1.15), (3, 2, 1)),
    "core:mangrove": (mangroves, (0.8, 1.2), (2, 3, 3, 2)),
}


def grounded(box):
    """A box standing on the ground carried below it as the mesh is: 0.6 of the way out to its farthest corner, so it
    still meets ground falling away from the node at 32 degrees."""
    (x, y, z), (hx, hy, hz) = box["at"], box["half"]
    bottom, top = y - hy, y + hy
    if bottom > 0.05:
        return box
    reach = max(math.hypot(x + sx * hx, z + sz * hz) for sx in (-1, 1) for sz in (-1, 1))
    bottom = min(bottom, -0.6 * reach)
    return {"at": [x, round((top + bottom) / 2, 2), z], "half": [hx, round((top - bottom) / 2, 2), hz]}


def ts(boxes):
    boxes = [grounded(b) for b in boxes]
    return "[" + ", ".join(f"{{ at: [{', '.join(f'{v:g}' for v in b['at'])}], half: [{', '.join(f'{v:g}' for v in b['half'])}] }}" for b in boxes) + "]"


if __name__ == "__main__":
    for kind, (module, size, weights) in KINDS.items():
        print(f"// {kind}")
        print(f"size: [{size[0]}, {size[1]}],")
        print("variants: [")
        for (piece, name), weight in zip([p for p in module.PIECES if not p[0].endswith("_depleted")], weights):
            print(f"  {{ mesh: \"core:{piece}\", weight: {weight}, boxes: {ts(module.boxes(name))},")
            print(f"    depleted: {{ mesh: \"core:{piece}_depleted\", boxes: {ts(module.stump_boxes(name))} }} }},")
        print("],")
