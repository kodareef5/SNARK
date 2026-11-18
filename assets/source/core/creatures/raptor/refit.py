"""Fit the baked Grab3D surface to the Quaternius bind pose in metres."""
import math
from pathlib import Path

import bpy
import numpy as np

folder = Path(__file__).resolve().parent
raw = folder.parents[3] / "raw"
# Match the sample FBX import clock before the exporter samples its actions.
bpy.context.scene.render.fps = 24
bpy.ops.import_scene.fbx(filepath=str(raw / "quaternius/dinosaurs/Velociraptor.fbx"))
rig = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
for obj in list(bpy.context.scene.objects):
    if obj.type == "MESH":
        bpy.data.objects.remove(obj, do_unlink=True)
for action in bpy.data.actions:
    action.name = action.name.split("|")[-1]
with bpy.data.libraries.load(str(folder / "plumage.blend")) as (source, loaded):
    loaded.objects = ["Plumage"]
body = loaded.objects[0]
bpy.context.collection.objects.link(body)
body.parent = rig
skin = body.modifiers.new("Plumage skin", "ARMATURE")
skin.object = rig

def ease(value, low, high):
    t = min(1, max(0, (value-low)/(high-low)))
    return t*t*(3-2*t)

def mix(a, b, t):
    return a + (b-a)*t

groups = {bone.name: body.vertex_groups.new(name=bone.name) for bone in rig.data.bones}
for vertex in body.data.vertices:
    x, minus_z, height = vertex.co
    z = -minus_z
    # Remove the lateral arc in the tail. Centre the skull over the cervical
    # chain and turn it to the forward axis about the base of the skull.
    centre = np.interp(z, [-.9, -.65, -.35, 0, .32, .55, .82], [.22, .13, .045, 0, -.015, -.038, -.059])
    x -= centre
    yaw = math.radians(108) * ease(height, .76, .94)
    dx = math.cos(yaw)*x - math.sin(yaw)*(z-.814)
    dz = math.sin(yaw)*x + math.cos(yaw)*(z-.814) + .814
    side = ".L" if x > 0 else ".R"
    # The right leg stands one foot ahead. Undo the stagger at the ankle
    # and fade into the pelvis. Keep both folded wings with their shoulders.
    wing_edge = (.49 if side == ".L" else .54) + max(0, height-.34)*.25
    leg = (1-ease(z, wing_edge-.045, wing_edge+.035)) * (1-ease(height,.42,.59)) * ease(z,.12,.22)
    # The distal claws project past the wing in side view.
    leg = mix(1,leg,ease(height,.18,.23))
    ankle_z = .252 if side == ".L" else .478
    ankle_x = .09 if side == ".L" else -.12
    sideways = mix(dx*1.78, (x-ankle_x)*1.65 + (.27 if side == ".L" else -.27), leg)
    forward = mix((dz-.38)*2.02, (z-ankle_z)*1.66-.072, leg)
    up = height * 1.53
    vertex.co = (sideways/.28, -forward/.28, up/.28)

    # Interpolate between successive joint centres. Separate the folded wing
    # from the flank so its long primaries follow the forelimb on extension.
    weights = {}
    def chain(t, knots, amount):
        for i, (at, bone) in enumerate(knots):
            stop = knots[i+1][0] if i+1 < len(knots) else None
            if stop is None or t < stop:
                blend = ease(t, at, stop) if stop is not None else 0
                weights[bone] = weights.get(bone, 0) + amount*(1-blend)
                if blend:
                    child = knots[i+1][1]
                    weights[child] = weights.get(child, 0) + amount*blend
                return
    wing = (1-leg) * ease(abs(x),.08,.15) * ease(z,.46,.54) * (1-ease(height,.58,.75))
    chain(height, [(.075,"BackFoot"+side),(.14,"BackLowLeg"+side),(.32,"BackUpLeg"+side),(.52,"BackLeg"+side)], leg)
    chain(height, [(.29,"FrontFoot"+side),(.45,"FrontLowLeg"+side),(.56,"FrontUpLeg"+side),(.66,"FrontLeg"+side)], wing)
    neck = ease(height,.73,.88)*ease(z,.65,.75) * (1-leg-wing)
    chain(height, [(.78,"Neck"),(.94,"Head")], neck)
    chain(dz, [(-.78,"Tail5"),(-.54,"Tail4"),(-.30,"Tail3"),(-.08,"Tail2"),(.18,"Tail1"),(.33,"Back"),(.43,"Hips"),(.55,"Torso"),(.73,"Shoulders"),(.85,"Neck")], 1-leg-wing-neck)
    strongest = sorted(((weight, name) for name, weight in weights.items() if weight > .00001), reverse=True)[:4]
    total = sum(weight for weight, _ in strongest)
    for weight, name in strongest:
        groups[name].add([vertex.index], weight/total, "REPLACE")
body.data.update()
