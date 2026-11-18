import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tanker"))
from blender_mesh import mesh
from geometry import model, posed, STATES, flat_paint

fine = model(level=0)
others = [model(level=1), model(level=2), model(False, True)]
for state in STATES:
    name = "tanker_" + state
    mesh(name, posed(fine, state, with_uv=True))
    for i, geometry in enumerate(others, 1):
        mesh(name + "_LOD" + str(i), posed(flat_paint(geometry), state), flat=True)
