# The looks a salvaged wreck goes down to (content/vehicles/salvage.ts), for a body whose street looks parked.py makes.
# An asset folder <vehicle>_salvaged calls `build` from its script, and draws them with the abandoned looks' pictures:
#   stripped   as parked.py's: wheels, steering wheel and driver's door taken, the passenger's door ajar, on its sills;
#   shell      every wheel, door and pane on a bone of its own taken, and the parts `off` says, level on what is left.
# The live models are run as they are. Their part makers are wrapped for this session, so each vertex also follows a
# group named for the part it was made as, and a part joined into the chassis can still be taken off by name. A heavy
# road vehicle's prepared parts (../<vehicle>/lod0.json.gz) have no names: `off` takes those by where they are.

import gzip
import json
import math
import os
import re
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parked
from parked import VEHICLES, _copied, _drop, _joined, _low, _model, _on, _turn

PART = "part:"
BOXED = PART + "in a box"
PANE = "Pane of "


def _named(o, name):
    # A part with a face of glass also goes by "Pane of" its name: a pane made under the name of the panel it is in.
    glazed = any(m is not None and m.name == "t_glass" for m in o.data.materials)
    for called in [name] + ([PANE + name] if glazed else []):
        o.vertex_groups.new(name=PART + called).add(list(range(len(o.data.vertices))), 1, "REPLACE")
    return o


def _name_parts():
    """Every part the fleet's makers build (../compact/parts.py) carries its name from here on."""
    sys.path.insert(0, os.path.join(VEHICLES, "compact"))
    import parts

    obj, mesh_obj = parts.Part.obj, parts.mesh_obj
    parts.Part.obj = lambda self, name: _named(obj(self, name), name)
    parts.mesh_obj = lambda name, bm, tag: _named(mesh_obj(name, bm, tag), name)


def _made_as(o):
    """The names of the parts joined into `o`, or none where it is one part still and goes by its own name."""
    made = [g.name for g in o.vertex_groups if g.name.startswith(PART)]
    return made if sum(1 for g in made if not g.startswith(PART + PANE)) > 1 else []


def _own(o):
    return re.sub(r"\.\d{3}$", "", o.name)


def _take(objs, names):
    """Takes away the parts whose name one of `names` matches from its start: a whole object by its own name, and
    what was joined into one by the name it was made as."""
    if not names:
        return
    match = re.compile("|".join(f"(?:{n})" for n in names))
    for o in list(objs):
        # One part still goes by its own name, and a glazed one as a pane too.
        pane = o.vertex_groups.get(PART + PANE + _own(o)) is not None
        if not _made_as(o) and (match.match(_own(o)) or (pane and match.match(PANE + _own(o)))):
            objs.remove(o)
            bpy.data.objects.remove(o)
    for o in list(objs):
        gone = [g for g in _made_as(o) if match.match(g[len(PART):])]
        if gone:
            _drop([o], gone)
            if len(o.data.vertices) == 0:
                objs.remove(o)
                bpy.data.objects.remove(o)


def _within(points, boxes):
    """Whether every point of a prepared part (x, y, z in a row, the engine's frame: +Y up, +Z its nose) is in one of
    `boxes`, each (x0, x1, y0, y1, z0, z1)."""
    lo = [min(points[k::3]) for k in range(3)]
    hi = [max(points[k::3]) for k in range(3)]
    return any(all(box[2 * k] <= lo[k] and hi[k] <= box[2 * k + 1] for k in range(3)) for box in boxes)


def _boxed(vehicle, o, boxes):
    """Names `BOXED` the vertices of the prepared parts that are in `boxes`: `o` has them in the order of the file."""
    with open(os.path.join(VEHICLES, vehicle, "lod0.json.gz"), "rb") as f:
        rows = json.loads(gzip.decompress(f.read()))
    at, inside = 0, []
    for _bone, _tile, points, _tris in rows:
        n = len(points) // 3
        if _within(points, boxes):
            inside.extend(range(at, at + n))
        at += n
    if at != len(o.data.vertices):
        raise SystemExit(f"salvaged: {vehicle}'s model has {len(o.data.vertices)} vertices, and its prepared parts {at}")
    o.vertex_groups.new(name=BOXED).add(inside, 1, "REPLACE")


def _on_sills(parts, name, turn):
    """Joins `parts` as `name`, turned by `turn` and set down on its lowest point. Returns the pose it was given."""
    look = _joined(parts, name)
    look.data.transform(turn)
    down = Matrix.Translation((0, 0, -_low(look)))
    look.data.transform(down)
    look.data.update()
    return down @ turn


def build(vehicle, name, looks=("stripped", "shell"), off=(), levels=(), names=False):
    """Leaves objects `name`_stripped and `name`_shell for build.py to write. `off` is what a shell has lost besides
    its doors and wheels: patterns of parts' names, and boxes that prepared parts lie in (`_within`). `levels` are a
    heavy road vehicle's own coarser levels, as parked.py takes them. `names` prints every part's name and stops."""
    _name_parts()
    parts, joints = _model(vehicle)
    if names:
        seen = {}
        for o in parts:
            for g in _made_as(o):
                seen[g[len(PART):]] = seen.get(g[len(PART):], 0) + len(_on(o, g))
            if not _made_as(o):
                seen[_own(o)] = seen.get(_own(o), 0) + len(o.data.vertices)
        for part, count in sorted(seen.items()):
            print(f"salvaged: part {part!r} {count} vertices")
        raise SystemExit(0)
    boxes = [b for b in off if not isinstance(b, str)]
    if boxes:
        _boxed(vehicle, parts[0], boxes)
    wheels = [b for b in joints if b.startswith("wheel_")]
    if "stripped" in looks:
        # As parked.py's stripped look, step for step.
        stripped = _copied(parts)
        gone = wheels + ["steering_wheel", "door_left"]
        _drop(stripped, gone)
        if "door_right" in joints:
            _turn(stripped, "door_right", 0.35, joints["door_right"])
        pose = _on_sills(stripped, name + "_stripped", Matrix.Rotation(math.radians(-1.2), 4, "X") @ Matrix.Rotation(math.radians(0.8), 4, "Y"))
        if levels:
            parked._authored(vehicle, name + "_stripped", levels, pose, lambda bone, points: bone in gone)
    if "shell" in looks:
        # Nothing that unbolts is left: it sits level on what is, a little to the driver's side.
        shell = _copied(parts)
        gone = wheels + ["steering_wheel"] + [b for b in joints if b.startswith("door_") or b.startswith("glass_")]
        _drop(shell, gone + ([BOXED] if boxes else []))
        _take(shell, [n for n in off if isinstance(n, str)])
        pose = _on_sills(shell, name + "_shell", Matrix.Rotation(math.radians(0.6), 4, "Y"))
        if levels:
            parked._authored(vehicle, name + "_shell", levels, pose, lambda bone, points: bone in gone or _within(points, boxes))
    for o in parts:
        bpy.data.objects.remove(o)
    print(f"salvaged: {name} from {vehicle}, {', '.join(looks)}")
