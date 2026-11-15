# Prints the content lines the rock kinds should name (content/core.ts): each variant's mesh, weight and boxes, its
# broken base and its boxes, and the size range, from the boxes make.py fitted (mesh/<name>.json). Boxes are turned
# from Blender's axes (+Z up) to the game's (+Y up, Blender's -Y forward): at (x, z, -y), half (x, z, y).
#   python3 content.py

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

KINDS = {
    "core:rock": {"names": [f"rock_{k}" for k in range(1, 7)], "weights": [4, 3, 3, 2, 3, 1], "size": [0.8, 1.25]},
    "core:metal_rock": {"names": [f"metal_rock_{k}" for k in range(1, 4)], "weights": [2, 2, 2], "size": [0.75, 1.2]},
    "core:rubble": {"names": [f"rubble_{k}" for k in range(1, 4)], "weights": [2, 2, 2], "size": [0.85, 1.15]},
}


def boxes(fitted):
    out = []
    for cx, cy, cz, hx, hy, hz in fitted:
        at = [round(cx, 2), round(cz, 2), round(-cy, 2) + 0.0]
        half = [round(hx, 2), round(hz, 2), round(hy, 2)]
        out.append(f"{{ at: [{', '.join(map(str, at))}], half: [{', '.join(map(str, half))}] }}")
    return f"[{', '.join(out)}]"


for kind, k in KINDS.items():
    lines = []
    for name, weight in zip(k["names"], k["weights"]):
        path = os.path.join(HERE, "mesh", f"{name}.json")
        if not os.path.exists(path):
            continue
        with open(path) as f:
            made = json.load(f)
        whole, broken = made[name], made[f"{name}_depleted"]
        lines.append(f"    {{ mesh: \"core:{name}\", weight: {weight}, boxes: {boxes(whole['boxes'])},\n"
                     f"      depleted: {{ mesh: \"core:{name}_depleted\", boxes: {boxes(broken['boxes'])} }} }},")
    if lines:
        print(f"// {kind}: size {k['size']}\nvariants: [\n" + "\n".join(lines) + "\n],\n")
