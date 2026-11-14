# The numbers the pup's scripts share. Blender's +Z is up. The pup faces -Y with
# its left at +X, which the exporter turns into the engine's +Y up, facing +Z.

# Where each joint is, as (x, y, z) in metres, and the joint it hangs on.
JOINTS = {
    "Hips": (0.0, 0.15, 0.42),
    "Chest": (0.0, -0.10, 0.45),
    "Head": (0.0, -0.32, 0.55),
    "Tail": (0.0, 0.30, 0.40),
    "Leg.L": (0.09, 0.12, 0.36),
    "Leg.R": (-0.09, 0.12, 0.36),
    "Foot.L": (0.09, 0.12, 0.03),
    "Foot.R": (-0.09, 0.12, 0.03),
}
PARENTS = {"Chest": "Hips", "Head": "Chest", "Tail": "Hips", "Leg.L": "Hips", "Leg.R": "Hips", "Foot.L": "Leg.L", "Foot.R": "Leg.R"}

# The body is rings along the spine: where along Y, how high, how wide, and the bone the ring follows.
RINGS = [
    (0.52, 0.38, 0.015, "Tail"),
    (0.34, 0.40, 0.06, "Tail"),
    (0.20, 0.42, 0.13, "Hips"),
    (0.02, 0.43, 0.15, "Hips"),
    (-0.14, 0.45, 0.13, "Chest"),
    (-0.28, 0.52, 0.09, "Chest"),
    (-0.36, 0.56, 0.10, "Head"),
    (-0.50, 0.55, 0.07, "Head"),
    (-0.58, 0.53, 0.02, "Head"),
]
# Points to a ring.
AROUND = 10

# Hip to ankle, the frames of the walk, and how far a foot travels while it is down.
LEG = 0.33
FRAMES = 24
STEP = 0.30
