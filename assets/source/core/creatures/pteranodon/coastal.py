"""Load the retargeted donor skin into the native flight and riding rig."""

from pathlib import Path

import bpy
import rig

skeleton = rig.find()
skeleton.drop_blockout()
source = Path(__file__).with_name("coastal.blend")
with bpy.data.libraries.load(str(source), link=False) as (_, target):
    target.objects = ["Coastal flyer"]
body = target.objects[0]
bpy.context.collection.objects.link(body)
body.name = "pteranodon_model"
body["shell_points"] = len(body.data.vertices)
skeleton.bind(body)
