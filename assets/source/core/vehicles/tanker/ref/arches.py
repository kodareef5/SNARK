"""Blender background preflight. Preserve the negative space under the stamped front and rear arches."""

from pathlib import Path
import bpy, numpy as np

root = Path(__file__).resolve().parent
donor = np.load(root / "parts.npz")
result = {}
for i in (3, 19, 113):
    key = f"body_{i}"
    v = donor[key + "_v"]
    f = donor[key + "_f"]
    for level, ratio in enumerate([0.49, 0.27, 0.12]):
        m = bpy.data.meshes.new(key)
        m.from_pydata(v.tolist(), [], f.tolist())
        m.update()
        o = bpy.data.objects.new(key, m)
        bpy.context.collection.objects.link(o)
        mod = o.modifiers.new("Preserve arches", "DECIMATE")
        mod.ratio = ratio
        obj = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        geo = obj.to_mesh()
        geo.calc_loop_triangles()
        result[str(level) + key + "_v"] = np.array([v.co[:] for v in geo.vertices], dtype="f4")
        result[str(level) + key + "_f"] = np.array(
            [tri.vertices[:] for tri in geo.loop_triangles], dtype="u2"
        )
        obj.to_mesh_clear()
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(m)
np.savez_compressed(root / "arches.npz", **result)
