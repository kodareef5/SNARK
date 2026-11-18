"""A vessel's wreck forms: the vessel as its own scripts build it, on its own layout and rig, then heeled and trimmed as it
lies, its hull stove in where it was struck, its rails bent, and where it burnt what burns gone and what is left slumped.
Each wreck folder's model.py calls `wreck(vessel, form)`; the forms' measures are in forms.json. Coordinates in FORMS are the
game's (X port, Y up, Z bow); the meshes are in Blender's (x, -z, y) by the time this runs.

  damaged  afloat and badly hurt: a few degrees of heel, a stove-in hull, bent rails, the cockpit's canvas and cushions
           as they were (the pictures say how they are);
  sunk     on the bottom, or burnt and then sunk: heeled and trimmed further, holed, and where it burnt its upholstery,
           glazing and canvas gone and its upper works slumped toward the deck."""
import json
import math
import os
import runpy
import sys

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
# Metres above a burnt form's slump floor over which its upper works crumple.
BAND = 2.0

# Parts that burn away (by the shipyards' part names), what they stand on, which stays, what is bolted through them,
# which falls into the hull with them, and the thin rails a blow or a fire bends.
BURNS = ("cushion", "bolster", "backrest", "seatback", "lounge insert", "thigh roll", "head roll", "arm pad", "piping",
         "welt", "pillow", "mattress", "upholster", "settee", "throw", "deflector", "windscreen", "windshield", "canvas",
         "bimini", "sunpad", "saddle")
STANDS = ("plinth", "base", "pedestal", "post", "frame", "brow", "sill", "bright cap", "pier", "blade")
FALLS = ("passenger handle",)
RAILS = ("rail", "stanchion", "pulpit", "lifeline", "handrail", "grab", "guard")

# Each vessel's forms, as forms.json gives them.
FORMS = json.load(open(os.path.join(HERE, "forms.json")))


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def noise(x, y, z, seed):
    """Smooth repeatable noise, -1 to 1, varying over about a metre."""
    return (math.sin(x * 2.1 + seed * 1.7) * math.cos(z * 1.3 - seed) + math.sin(y * 2.9 + z * .7 + seed * 3.1)) * .5


def wreck(vessel, form):
    folder = os.path.join(os.path.dirname(HERE), vessel)
    sys.path.insert(0, folder)
    runpy.run_path(os.path.join(folder, "model.py"), run_name="__main__")
    f = FORMS[vessel][form]
    seed = sum(map(ord, vessel + form))
    heel, trim = math.radians(f["heel"]), math.radians(f["trim"])
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        parts = json.loads(o["marine"])["parts"]
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        owner = bm.faces.layers.int.get("part")
        named = lambda face: parts[face[owner]].lower()
        # What burns is gone; nothing else is cut, so every part left stays closed.
        if f.get("burnt"):
            gone = [face for face in bm.faces if (any(w in named(face) for w in BURNS) and not any(w in named(face) for w in STANDS)) or any(w in named(face) for w in FALLS)]
            bmesh.ops.delete(bm, geom=gone, context="FACES")
        thin = set()
        for face in bm.faces:
            if any(w in named(face) for w in RAILS):
                thin.update(v.index for v in face.verts)
        bm.verts.ensure_lookup_table()
        tilt = {}
        for v in bm.verts:
            x, y, z = v.co.x, v.co.z, -v.co.y
            # Stove in toward the centreline where it was struck, crumpled.
            for (px, py, pz), r, depth in f["dents"]:
                d = math.dist((x, y, z), (px, py, pz))
                if d < r:
                    k = smooth(1 - d / r) ** 1.5 * depth * (.75 + .25 * noise(x * 6, y * 6, z * 6, seed))
                    x -= math.copysign(k, px) if abs(px) > .05 else 0
                    y += k * .35 if abs(px) <= .05 else 0
                    z -= k * .5 if abs(px) <= .05 else 0
            if v.index in thin:
                x += f["bend"] * noise(z, y, x, seed + 1)
                y -= abs(f["bend"] * noise(z * .7, x, y, seed + 2)) * .6
            if f.get("burnt"):
                floor, share = f["slump"][0], f["slump"][1]
                if y > floor:
                    # Burnt upper works crumple over the band above the slump's floor, by `share` of it, and what stood
                    # above the band drops onto it whole, so a part keeps its thickness; then they buckle by up to 15 cm,
                    # slowly across the deck and never up it, and lean, more the higher they stood.
                    up = y - floor
                    y = floor + up - share * min(up, BAND) - .15 * smooth(up / 2) * (.5 + .5 * noise(x * .4, 0, z * .4, seed + 3))
                    x *= 1 - .08 * smooth(up / 2.5)
                    x += .25 * smooth(up / 3) * noise(z * .5, 0, 0, seed + 4)
                    z += .2 * smooth(up / 3) * noise(0, x, z * .5, seed + 5)
            # Heel about the keel line and trim about midships.
            cy, sy = math.cos(heel), math.sin(heel)
            x, y = x * cy + y * sy, y * cy - x * sy
            ct, st = math.cos(trim), math.sin(trim)
            y, z = y * ct - z * st, y * st + z * ct
            tilt[v.index] = (x, y, z)
        for v in bm.verts:
            x, y, z = tilt[v.index]
            v.co.x, v.co.y, v.co.z = x, -z, y
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
