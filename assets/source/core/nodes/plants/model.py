# The low plants: every individual of every kind, each with its levels, and what is left of it when it is used up.
# Object names are the mesh ids without "core:", as asset.ts lists them; "<name>_LOD<n>" is level n.

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bush  # noqa: E402
import creeper  # noqa: E402
import fern  # noqa: E402
import kit  # noqa: E402
import palmetto  # noqa: E402
import seagrape  # noqa: E402
import variants  # noqa: E402
import vine  # noqa: E402

BUILDERS = {"bush": bush, "palmetto": palmetto, "fern": fern, "seagrape": seagrape, "creeper": creeper, "vine": vine}


def emit(name, levels):
    for i, level in enumerate(levels):
        if level.count:
            kit.to_object(level, name if i == 0 else f"{name}_LOD{i}")


for kind, individuals in variants.KINDS.items():
    builder = BUILDERS.get(kind)
    if builder is None:
        continue
    for i, v in enumerate(individuals, 1):
        emit(f"{kind}_{i}", builder.build(v))
        if variants.DEPLETED.get(kind) == "each":
            emit(f"{kind}_{i}_depleted", builder.build(v, picked=True))
    if variants.DEPLETED.get(kind) == "one":
        emit(f"{kind}_depleted", builder.build(individuals[0], picked=True))
