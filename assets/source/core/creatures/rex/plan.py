"""Original adult coastal Tyrannosaurus in metres. X left, Y up, Z forward."""

from mathutils import Vector

FPS = 30


def to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def to_animal(v):
    return Vector((v[0], v[2], -v[1]))


def point_blender(v):
    return to_blender((v[0], v[1] - 0.036, v[2]))


# Axial stations give depth above and below each centre independently. The
# gastral basket is deepest forward of the hip; the raised tail balances the head.
# z, centre height, half-width, dorsal and ventral depths.
BODY = [
    (-7.12, 1.79, 0.012, 0.018, 0.017),
    (-6.70, 1.76, 0.051, 0.077, 0.052),
    (-6.08, 1.79, 0.096, 0.135, 0.102),
    (-5.35, 1.91, 0.163, 0.198, 0.146),
    (-4.52, 2.10, 0.235, 0.287, 0.211),
    (-3.76, 2.33, 0.329, 0.390, 0.302),
    (-3.08, 2.55, 0.432, 0.513, 0.412),
    (-2.48, 2.73, 0.523, 0.649, 0.485),
    (-1.91, 2.91, 0.635, 0.758, 0.587),
    (-1.43, 3.04, 0.735, 0.862, 0.71),
    (-0.94, 3.09, 0.831, 0.956, 0.81),
    (-0.48, 3.075, 0.852, 0.909, 0.912),
    (0.04, 3.035, 0.844, 0.869, 1.03),
    (0.58, 3.018, 0.797, 0.843, 1.13),
    (1.06, 3.01, 0.76, 0.84, 1.125),
    (1.47, 3.055, 0.679, 0.846, 0.97),
    (1.81, 3.16, 0.601, 0.845, 0.83),
    (2.16, 3.29, 0.544, 0.874, 0.72),
    (2.49, 3.44, 0.549, 0.853, 0.637),
    (2.77, 3.57, 0.572, 0.795, 0.603),
    (3.02, 3.64, 0.555, 0.654, 0.541),
    (3.22, 3.68, 0.470, 0.459, 0.390),
    (3.39, 3.66, 0.333, 0.297, 0.245),
]
# Adult postorbital table expands laterally behind both eyes. Nasals narrow
# toward a broad, steep premaxillary face; the lip turns up behind the arcade.
SKULL = [
    (2.70, 0.234, 3.52, 4.073),
    (2.83, 0.463, 3.42, 4.285),
    (2.98, 0.649, 3.356, 4.478),
    (3.16, 0.745, 3.416, 4.590),
    (3.33, 0.750, 3.550, 4.571),
    (3.48, 0.663, 3.555, 4.470),
    (3.63, 0.581, 3.503, 4.346),
    (3.78, 0.532, 3.439, 4.276),
    (4.00, 0.511, 3.382, 4.246),
    (4.23, 0.489, 3.357, 4.216),
    (4.46, 0.448, 3.375, 4.180),
    (4.66, 0.403, 3.411, 4.117),
    (4.85, 0.354, 3.450, 4.057),
    (4.99, 0.301, 3.474, 3.986),
    (5.093, 0.207, 3.496, 3.930),
    (5.14, 0.107, 3.527, 3.865),
    (5.146, 0.027, 3.573, 3.785),
]
JAW = [
    (2.79, 0.17, 3.46, 3.21),
    (2.91, 0.43, 3.476, 2.943),
    (3.035, 0.559, 3.484, 2.835),
    (3.18, 0.595, 3.509, 2.841),
    (3.35, 0.560, 3.494, 2.908),
    (3.55, 0.502, 3.488, 2.977),
    (3.76, 0.455, 3.437, 3.036),
    (4.02, 0.426, 3.367, 3.000),
    (4.24, 0.405, 3.338, 2.995),
    (4.50, 0.372, 3.364, 3.050),
    (4.73, 0.327, 3.415, 3.124),
    (4.92, 0.264, 3.452, 3.199),
    (5.043, 0.171, 3.453, 3.291),
    (5.08, 0.063, 3.454, 3.378),
]
EYE = (0.653, 4.189, 3.448)
NARIS = (0.414, 3.918, 4.685)
LEGS = [(0.62, 3.02, -0.74), (0.72, 1.94, 0.04), (0.64, 0.940, -0.87), (0.64, 0.146, -0.46)]
ARM = [(0.51, 2.93, 1.64), (0.64, 2.55, 1.42), (0.70, 2.525, 1.86)]
SEAT = (0, 4.12, 0.49)


def mirror(p, sign):
    return (sign * p[0], p[1], p[2])


BONES = []


def bone(n, parent, a, b):
    BONES.append((n, parent, a, b))


bone("pelvis", None, (0, 3.02, -0.74), (0, 3.03, 0.28))
bone("chest", "pelvis", (0, 3.03, 0.28), (0, 3.10, 1.64))
bone("neck_1", "chest", (0, 3.10, 1.64), (0, 3.36, 2.36))
bone("neck_2", "neck_1", (0, 3.36, 2.36), (0, 3.63, 3.04))
bone("skull", "neck_2", (0, 3.63, 3.04), (0, 3.7, 4.90))
bone("maxilla", "skull", (0, 3.90, 3.75), (0, 3.80, 5.10))
bone("jaw", "skull", (0, 3.43, 3.08), (0, 3.40, 4.86))
tail = [(0, 3.02, -0.74), (0, 2.89, -2.13), (0, 2.47, -3.43), (0, 2.05, -4.64), (0, 1.72, -5.86), (0, 1.51, -7.12)]
for i, (a, b) in enumerate(zip(tail, tail[1:])):
    bone("tail_" + str(i + 1), "pelvis" if i == 0 else "tail_" + str(i), a, b)
for side, sign in [("l", 1), ("r", -1)]:

    def paired(n, parent, a, b):
        bone(n + "_" + side, parent, mirror(a, sign), mirror(b, sign))

    for i, n in enumerate(("thigh", "shank", "metatarsus")):
        paired(n, "pelvis" if i == 0 else ("thigh", "shank")[i - 1] + "_" + side, LEGS[i], LEGS[i + 1])
    paired("toes", "metatarsus_" + side, LEGS[-1], (0.65, 0.075, 0.24))
    paired("humerus", "chest", ARM[0], ARM[1])
    paired("forearm", "humerus_" + side, ARM[1], ARM[2])
    paired("manus", "forearm_" + side, ARM[2], (0.71, 2.42, 2.06))
    paired("eye", "skull", EYE, (EYE[0], EYE[1], EYE[2] + 0.081))
    paired("lid", "skull", EYE, (EYE[0], EYE[1] + 0.051, EYE[2] + 0.03))
