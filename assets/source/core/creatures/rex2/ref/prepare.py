# Saves the source GLB's three pictures as PNGs in tex/, where the build reads them. Run it once after downloading
# the GLB, or again if the pictures need to be made afresh. It checks the file is the one SOURCES.md describes.
#   blender -b --factory-startup --python-exit-code 1 -P assets/source/core/creatures/rex2/ref/prepare.py

import hashlib
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FOLDER = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(FOLDER, "../../../../.."))
SOURCE = os.path.join(ROOT, "assets/raw/patch/anymove-trex.glb")
SHA256 = "1ef52f9b3ec54ab812e75ff3c2851f3121ae3d93f80ba953315091faae7355cb"

# The GLB's picture name, and the name the asset's material reads it by.
PICTURES = {"trex_color": "rex2_base", "trex_normalgl": "rex2_normal", "trex_orm": "rex2_packed"}

with open(SOURCE, "rb") as f:
    digest = hashlib.sha256(f.read()).hexdigest()
if digest != SHA256:
    raise SystemExit(f"prepare: {SOURCE} is not the expected file (sha256 {digest})")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
os.makedirs(os.path.join(FOLDER, "tex"), exist_ok=True)
found = {image.name.rsplit(".", 1)[0]: image for image in bpy.data.images}
for source, name in PICTURES.items():
    image = found.get(source)
    if image is None:
        raise SystemExit(f"prepare: the GLB has no picture {source}; it has {sorted(found)}")
    # The GLB's pictures are JPEGs packed in the file. Saving one keeps it a JPEG, so copy its decoded pixels into a
    # new picture and save that. Every picture is read as plain numbers, so nothing changes their values on the way.
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    copy = bpy.data.images.new(name, w, h, alpha=False)
    copy.colorspace_settings.name = "Non-Color"
    copy.pixels.foreach_set(pixels)
    out = os.path.join(FOLDER, "tex", f"{name}.png")
    copy.filepath_raw = out
    copy.file_format = "PNG"
    copy.save()
    # Read it back and compare, to the nearest step of 1/255.
    back = bpy.data.images.load(out)
    back.colorspace_settings.name = "Non-Color"
    again = np.empty(w * h * 4, dtype=np.float32)
    back.pixels.foreach_get(again)
    worst = float(np.abs(again - pixels).max()) * 255
    if worst > 0.5:
        raise SystemExit(f"prepare: {out} differs from the source by {worst:.1f} steps")
    print(f"prepare: wrote {out} from {source}, {w} x {h}, same pixels")
