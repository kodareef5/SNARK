"""Opens Patch's T-rex and gives it the game's names. Its shape, weights and motion are kept as they are.

- Bones get the game's Rex names, and the vertex groups and clips follow them.
- The glTF importer reads clips at the scene's 30 frames a second, the game's tick. Each clip's length is then
  rounded to whole ticks, so a loop still closes; that changes its speed by under 1%.
- Clips get the game's names. Clips the game doesn't use are removed, because the build writes every clip it finds.
"""

import hashlib
import os

import bpy

FOLDER = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.abspath(os.path.join(FOLDER, "../../../../raw/patch/anymove-trex.glb"))
SHA256 = "1ef52f9b3ec54ab812e75ff3c2851f3121ae3d93f80ba953315091faae7355cb"

BONES = {
    "pelvis": "pelvis", "spine1": "spine", "chest": "chest", "neck1": "neck_1", "neck2": "neck_2",
    "head": "skull", "jaw": "jaw",
    **{f"tail{i}": f"tail_{i}" for i in range(1, 7)},
    **{f"{a}_{s}": f"{b}_{s.lower()}" for s in "LR" for a, b in (
        ("upperarm", "humerus"), ("forearm", "forearm"),
        ("thigh", "thigh"), ("shin", "shank"), ("metatarsus", "metatarsus"), ("hpaw", "toes"),
    )},
}

# Source clip to game clip. The gaits come from Walk_Root and Run_Root, which carry the body forward as the feet push
# it. The game moves the body itself, so their steady forward travel is taken off (in_place). Their own Walk and Run
# stay in place by holding the pelvis still sideways too, which drags the planted feet across by the body's sway.
CLIPS = {"Idle": "idle", "Walk_Root": "walk", "Run_Root": "run", "Attack": "attack", "Hit": "flinch", "Roar": "call"}
GAITS = {"walk", "run"}


def check_source():
    with open(SOURCE, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"rex2: {SOURCE} is not the file ref/SOURCES.md describes (sha256 {digest})")


def fcurves(action):
    """Every F-curve of an action, through its layers and slots."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def rename_bones(rig, body):
    missing = sorted(set(BONES) - {b.name for b in rig.data.bones})
    if missing:
        raise SystemExit(f"rex2: the source has no bones {missing}")
    for old, new in BONES.items():
        rig.data.bones[old].name = new
    # Blender renames the vertex groups of a mesh bound to the armature with the bone. Make sure.
    for old, new in BONES.items():
        group = body.vertex_groups.get(old)
        if group:
            group.name = new
    for action in bpy.data.actions:
        for fc in fcurves(action):
            for old, new in BONES.items():
                prefix = f'pose.bones["{old}"]'
                if fc.data_path.startswith(prefix):
                    fc.data_path = f'pose.bones["{new}"]' + fc.data_path[len(prefix):]
                    break


def retime(action):
    start, end = action.frame_range
    span = end - start
    ticks = round(span)
    k = ticks / span
    for fc in fcurves(action):
        for key in fc.keyframe_points:
            key.co.x = start + (key.co.x - start) * k
            key.handle_left.x = start + (key.handle_left.x - start) * k
            key.handle_right.x = start + (key.handle_right.x - start) * k
        fc.update()
    action.frame_range = (start, start + ticks)
    return ticks


def pelvis_means(action):
    """The pelvis's average place over a clip, one number for each location channel."""
    start, end = action.frame_range
    out = {}
    for fc in fcurves(action):
        if fc.data_path == 'pose.bones["pelvis"].location':
            samples = [fc.evaluate(start + (end - start) * i / 64) for i in range(64)]
            out[fc.array_index] = sum(samples) / len(samples)
    return out


def in_place(action, centre):
    """Takes the pelvis's travel from the first frame to the last off it evenly over the clip, so the body stays put and
    the loop closes, while its sway and bob stay. Then moves the whole clip so the pelvis's average place is `centre`,
    the average of the source's own in-place clip, so the body doesn't jump as the game blends from idle. The pelvis is
    the root, so its location is the body's place."""
    start, end = action.frame_range
    curves = [fc for fc in fcurves(action) if fc.data_path == 'pose.bones["pelvis"].location']
    for fc in curves:
        travel = fc.evaluate(end) - fc.evaluate(start)
        for key in fc.keyframe_points:
            u = (key.co.x - start) / (end - start)
            for point in (key.co, key.handle_left, key.handle_right):
                point.y -= travel * u
        fc.update()
    now = pelvis_means(action)
    for fc in curves:
        shift = centre[fc.array_index] - now[fc.array_index]
        for key in fc.keyframe_points:
            for point in (key.co, key.handle_left, key.handle_right):
                point.y += shift
        fc.update()


def build():
    check_source()
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    rig = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    body = next(o for o in bpy.context.scene.objects if o.type == "MESH")

    # The file hangs the rig on an empty "Pivot" with no transform. The game wants the armature at the top.
    pivot = rig.parent
    if pivot is not None:
        world = rig.matrix_world.copy()
        rig.parent = None
        rig.matrix_world = world
        bpy.data.objects.remove(pivot)
    rig.name, rig.data.name = "rex2", "rex2"
    body.name, body.data.name = "rex2_body", "rex2_body"
    if rig.animation_data:
        rig.animation_data.action = None

    rename_bones(rig, body)

    material = body.data.materials[0]
    material.name = "rex2"
    for image in list(bpy.data.images):
        bpy.data.images.remove(image)

    # Where the source's in-place Walk and Run hold the pelvis on average, before those clips go.
    centres = {"walk": pelvis_means(bpy.data.actions["Walk"]), "run": pelvis_means(bpy.data.actions["Run"])}
    for action in list(bpy.data.actions):
        name = CLIPS.get(action.name)
        if name is None:
            bpy.data.actions.remove(action)
            continue
        ticks = retime(action)
        if name in GAITS:
            in_place(action, centres[name])
        action.name = name
        print(f"rex2: clip {name} from {[k for k, v in CLIPS.items() if v == name][0]}, {ticks} ticks")
    print(f"rex2: {len(rig.data.bones)} bones, {len(body.data.polygons)} faces, {len(body.data.vertices)} vertices")


if __name__ == "__main__":
    build()
