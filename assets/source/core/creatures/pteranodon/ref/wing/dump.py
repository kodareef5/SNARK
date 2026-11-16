"""Writes what fold.py searches with, to the system's temporary folder (pteranodon_fold.json): the rig's bones, the
membrane's grid and the weights its leading edge and root take from the arm, the finger and the skin, the shell and
leg as triangles with their weights, every bone in check.py's poses, and every frame of the animators' clips (not
the layers), all as the rig and model stand now.

    blender --background --factory-startup --disable-autoexec --python ref/wing/dump.py
"""

import json
import os
import runpy
import sys
import tempfile

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(tempfile.gettempdir(), "pteranodon_fold.json")


def deltas(rig, r):
    """Each deforming bone's turn and move from rest, Blender's axes, as a 4 by 4 matrix."""
    out = {}
    for b in rig.DEFORM:
        pb = r.obj.pose.bones[b]
        out[b] = [list(row) for row in pb.matrix @ pb.bone.matrix_local.inverted()]
    return out


def main():
    sys.dont_write_bytecode = True
    sys.path[:0] = [FOLDER, HERE]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    for name in ("rig.py", "model.py"):
        runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")
    import check
    import model
    import rig
    r = rig.find()
    data = {"joint": {b[0]: b[2] for b in rig.BONES}, "tail": {b[0]: b[3] for b in rig.BONES},
            "fold": {k: rig.FOLD[k] for k in ("web_1", "web_2", "web_3")},
            "tuck": {k: rig.TUCK[k] for k in ("web_1", "web_2", "web_3")},
            "roll": dict(rig.FINGER_ROLL), "fit": dict(model.MEMBRANE_FIT), "half": model.MEMBRANE_HALF}
    left = model.rig._JOINT["upper_arm_l"][0]
    span = model.rig._TAIL["wing_4_l"][0] - left
    data["along"] = {n: (model.rig._JOINT[n][0] - left) / span for n in ("forearm_l", "hand_l", "wing_2_l")}

    shell = model.shell_part()
    model.shell_weights(shell)
    model.smooth_weights(shell, rounds=3, amount=0.4)
    leg = model.leg_part()
    model.attach(leg, shell, at=leg.anchor)
    grid, fracs = model.membrane_grid()
    data["grid"], data["fracs"] = grid.tolist(), list(map(float, fracs))
    data["lead"] = [model.lead_weights(grid[i, 0]) for i in range(len(grid))]
    data["root"] = [model.skin_weights_at(grid[0, j], (shell, leg)) for j in range(grid.shape[1])]
    data["solids"] = {p.name: {"points": [list(q) for q in p.points], "faces": [list(f) for f in p.faces],
                               "weights": model.finish_weights(p.weights)} for p in (shell, leg)}

    data["poses"] = {}
    for name, spec in check.POSES.items():
        check.pose(rig, r, spec)
        fold = spec.get("wings", {}).get("fold", 1.0 if spec.get("stance") else 0.0)
        data["poses"][name] = {"fold": fold, "bones": deltas(rig, r)}
    r.rest()

    for owner in ("move", "act", "life"):
        try:
            runpy.run_path(os.path.join(FOLDER, f"clips_{owner}.py"), run_name="__main__")
        except SystemExit as stop:
            print(f"dump: clips_{owner}.py stopped: {stop}")
    data["clips"], data["grounded"] = {}, []
    for name, spec in rig.CLIPS.items():
        action = bpy.data.actions.get(name)
        if action is None or "layer" in spec:
            continue
        if spec.get("start") in ("ground", "gait") or spec.get("end") == "ground":
            data["grounded"].append(name)
        r.obj.animation_data.action = action
        if action.slots:
            r.obj.animation_data.action_slot = action.slots[0]
        lifted = bool(spec.get("lifted"))
        frames = {}
        for f in range(int(action.frame_range[0]), int(action.frame_range[1]) + 1):
            bpy.context.scene.frame_set(f)
            frames[f] = {"lift": rig.take_off_lift(f) if lifted else 0.0, "bones": deltas(rig, r)}
        data["clips"][name] = frames
        print(f"dump: {name} {len(frames)} frames")
    r.rest()
    with open(OUT, "w") as fh:
        json.dump(data, fh)
    print("dump: wrote", OUT)


main()
