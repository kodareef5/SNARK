"""Industrial stations centred in their existing placement boxes."""

from pathlib import Path
import sys

parent = Path(__file__).resolve().parent
sys.path[:0] = [str(parent), str(parent.parent.parent / "items")]

from hand_geometry import Prop
from heat import cooker_industrial, forge_industrial, grinder
from secure import chemistry_bench, soul_vault, vault
from utilities import air_conditioner, generator, refrigerator

SWATCHES = {
    "steel": (0.24, (150, 152, 156)),
    "iron": (0.16, (92, 98, 110)),
    "brass": (0.16, (170, 124, 48)),
    "enamel": (0.38, (101, 117, 104)),
    "cream": (0.38, (200, 200, 196)),
    "polymer": (0.16, (46, 36, 32)),
    "glass": (0.18, (60, 110, 170)),
    "status": (0.18, (150, 190, 230)),
}

for build in (generator, refrigerator, air_conditioner, grinder, vault, forge_industrial, chemistry_bench, soul_vault, cooker_industrial):
    for level in range(4):
        prop = Prop(level, SWATCHES)
        if build is soul_vault:
            build(prop, False)
            lit = Prop(level, SWATCHES)
            build(lit, True)
            lit.build("soul_vault_lit")
        else:
            build(prop)
        prop.build(build.__name__)
