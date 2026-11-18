"""Original four-door mountain patrol utility. Blender runs this on an empty scene for the native asset build."""

import geometry as g
from bodywork import body, doors, hardtop
from running_gear import chassis, wheel
from equipment import front_and_rear, lightbar, interior

joints = {"chassis": (0, 0, 0)}
for end, z in (("front", 1.45), ("rear", -1.45)):
    for side, sg in (("left", 1), ("right", -1)):
        joints[f"wheel_{end}_{side}"] = (sg * 0.85, 0.42, z)
joints.update(
    {
        "door_left": (0.87, 0.99, 0.87),
        "door_right": (-0.87, 0.99, 0.87),
        "steering_wheel": (0.446, 1.20, 0.63),
        "door_rear_left": (0.87, 0.99, -0.14),
        "door_rear_right": (-0.87, 0.99, -0.14),
    }
)

chassis()
body()
doors()
hardtop()
front_and_rear()
lightbar()
interior()
for name, at in list(joints.items())[1:5]:
    g.bone = name
    wheel(at, 1 if at[0] > 0 else -1)
g.bone = "chassis"
wheel((0, 1.146, -2.245), 1, spare=True)
g.finish(joints)
