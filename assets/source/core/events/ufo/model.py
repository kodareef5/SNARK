"""The UFO's pieces (asset.ts): the craft in three parts, its wreck and its core. Each is one Blender object, its
finest level; the art tool makes the coarser ones."""

from core import core
from craft import craft, ring, rim

import runpy
from pathlib import Path

for name, make in (("craft", craft), ("rim", rim), ("ring", ring), ("core", core)):
    mesh = make()
    mesh.build(name)
    print(f"model: {name} {mesh.triangles()} triangles")
# The wreck is built from the same parts, cut and bent in Blender.
runpy.run_path(str(Path(__file__).with_name("wreck.py")), run_name="__main__")
