"""check.py's count through the animators' clips: builds rig.py and model.py, runs clips_move.py, clips_act.py and
clips_life.py, and counts for the left wing in every `--step`th frame of each clip (layers left out, as they are
drawn on another clip) the membrane crossing itself, the shell and legs, and the other wing, and folds tighter than
the skin is thick.

    blender --background --factory-startup --disable-autoexec --python ref/wing/clips.py -- [--step 2] [--out FILE]

Prints each clip's frames with any crossing and writes the table to clips.json beside this script.
"""

import json
import os
import runpy
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(os.path.dirname(HERE))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    step = int(argv[argv.index("--step") + 1]) if "--step" in argv else 2
    out = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(HERE, "clips.json")
    sys.dont_write_bytecode = True
    sys.path[:0] = [FOLDER, HERE]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    # the clips before the model, as the build has them: their checks look at the block-out, which the model drops
    for name in ("rig.py", "clips_move.py", "clips_act.py", "clips_life.py", "model.py"):
        try:
            runpy.run_path(os.path.join(FOLDER, name), run_name="__main__")
        except SystemExit as stop:
            print(f"clips: {name} stopped: {stop}")
    import check
    import rig
    r = rig.find()
    obj = bpy.data.objects["pteranodon_model"]
    groups, centre = check.groups_of(obj)
    report = {}
    for name, spec in rig.CLIPS.items():
        action = bpy.data.actions.get(name)
        if action is None or "layer" in spec:
            continue
        r.rest()
        r.obj.animation_data.action = action
        if action.slots:
            r.obj.animation_data.action_slot = action.slots[0]
        rows = {}
        for f in range(int(action.frame_range[0]), int(action.frame_range[1]) + 1, step):
            bpy.context.scene.frame_set(f)
            rows[f] = check.measure(obj, centre, groups)
        bad = {f: c for f, c in rows.items() if c["self"] or c["body"] or c["wings"]}
        report[name] = {"frames": len(rows), "crossing": {str(f): c for f, c in bad.items()}}
        worst = max(rows.values(), key=lambda c: c["self"] + c["body"] + c["wings"])
        print(f"clips: {name:14s} {len(bad):3d} of {len(rows):3d} frames cross; worst {worst}; frames {sorted(bad)}")
    r.rest()
    with open(out, "w") as fh:
        json.dump(report, fh, indent=1)
    print("clips: wrote", out)


main()
