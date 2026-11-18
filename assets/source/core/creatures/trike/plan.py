"""The original coastal Trike, in metres: X left, Y up, Z forward.

No imported mesh, skeleton or animation is used. The readable anatomy is
specified here before detailed skin and motion. Blender uses (x, -z, y).
"""

import math

from mathutils import Vector

FPS = 30
# The authored sole plane is 65 mm above the anatomical coordinate origin.
# Move every authored point (rig, skin, saddle and contact targets)
# together, keeping all socket offsets and chain lengths unchanged.
GROUND = .065
TRIANGLES = [22000, 9000, 4000, 1400, 400, 96]
SADDLE_TRIANGLES = [2400, 1000, 400, 120]
STRIDES = {"walk": 2.4, "run": 4.8, "charge": 4.8}
SEAT = (0, 3.04, -0.25)

# z, centre height, half width, height above centre, height below centre.
# Tail and trunk are continuous, with substantial shoulder and hip masses.
BODY = [
    (-4.50, .60, .012, .016, .016), (-4.28, .64, .055, .065, .05),
    (-3.95, .73, .10, .12, .09), (-3.55, .89, .15, .18, .13),
    (-3.10, 1.09, .23, .25, .20), (-2.65, 1.31, .35, .34, .28),
    (-2.30, 1.48, .50, .44, .38), (-1.98, 1.62, .69, .57, .46),
    (-1.62, 1.71, .90, .73, .56), (-1.22, 1.74, 1.01, .71, .68),
    (-.70, 1.75, 1.08, .70, .80), (-.12, 1.77, 1.04, .76, .75),
    (.38, 1.78, .88, .84, .67), (.78, 1.81, .71, .74, .58),
    (1.08, 1.85, .63, .59, .46), (1.36, 1.89, .59, .51, .39),
    (1.60, 1.89, .63, .48, .35), (1.92, 1.86, .64, .42, .32),
    (2.22, 1.80, .53, .37, .28), (2.50, 1.71, .39, .34, .26),
    (2.76, 1.67, .30, .28, .20), (2.98, 1.62, .24, .25, .16),
    (3.13, 1.53, .16, .20, .12), (3.21, 1.44, .055, .09, .045),
    (3.24, 1.38, .012, .025, .020),
]

LEGS = {
    "front": [(0.62, 1.93, .55), (.91, 1.20, .12), (.86, .42, .70), (.86, .16, .92)],
    "back": [(0.67, 1.92, -1.53), (.89, 1.11, -1.28), (.85, .43, -1.54), (.85, .16, -1.40)],
}
LEG_WIDTH = {"front": [.37, .30, .20, .25], "back": [.44, .34, .19, .28]}
LEG_DEPTH = {"front": [.40, .28, .19, .36], "back": [.47, .35, .20, .38]}


def pads(end):
    """Original left foot pad primitives, shared by surface and pose support."""
    foot=LEGS[end][-1]
    out=[('pad',(foot[0],.17,foot[2]+.10),(.29,.16,.30),20,10)]
    if end=='front':
        for digit,dx,dz,r in ((4,.25,.025,.095),(5,.22,-.115,.08)):
            out.append((f'manus_{digit}',(foot[0]+dx,.16,foot[2]+dz),(r,.105,r*1.4),16,8))
    return out


def hooves(end):
    """Unequal, slightly splayed left hoof sections; three manus, four pes."""
    foot=LEGS[end][-1];count=3 if end=='front' else 4
    for k in range(count):
        across=k-(count-1)*.5
        x=foot[0]+across*(.145 if end=='front' else .13)
        start=foot[2]-.055*abs(across)
        width=(.095,.087,.061)[k] if end=='front' else (.071,.079,.076,.058)[k]
        rings=[]
        for z,w,top,bottom in ((start+.20,width*.78,.17,.075),(start+.32,width,.155,.065),
                              (start+.43,width*.90,.115,.065),(start+.47,width*.72,.10,.070)):
            outline=[(-.72,bottom),(.72,bottom),(1,bottom+.012),(1,top-.012),
                     (.65,top),(-.65,top),(-1,top-.012),(-1,bottom+.012)]
            angle=across*.22;travel=z-start-.20
            rings.append([(x+w*u+travel*math.sin(angle),y,start+.20+travel*math.cos(angle)) for u,y in outline])
        yield k,rings

EYE = (.67, 2.08, 2.07)
EYE_RADIUS = .038
HORNS = [
    ((.43, 2.18, 2.10), .170), ((.45, 2.39, 2.23), .150),
    ((.47, 2.58, 2.47), .115), ((.49, 2.71, 2.76), .078),
    ((.48, 2.77, 3.06), .045), ((.44, 2.75, 3.34), .014),
    ((.42, 2.73, 3.49), .0015),
]
NASAL = [((0, 1.95, 2.68), .16), ((0, 2.13, 2.73), .13),
         ((0, 2.30, 2.80), .08), ((0, 2.43, 2.89), .025), ((0, 2.47, 2.95), .002)]

# Each bone: name, parent, head, tail. Four real bent leg chains; no detached feet.
BONES = [
    ("body", None, (0, 1.72, -.62), (0, 1.81, .40)),
    ("pelvis", "body", (0, 1.72, -.62), (0, 1.81, -1.60)),
    ("chest", "body", (0, 1.72, -.62), (0, 1.90, .80)),
    ("neck", "chest", (0, 1.90, .80), (0, 1.94, 1.55)),
    ("skull", "neck", (0, 1.94, 1.55), (0, 1.80, 2.67)),
    ("jaw", "skull", (0, 1.72, 1.90), (0, 1.46, 3.08)),
    ("tail_1", "pelvis", (0, 1.67, -1.72), (0, 1.33, -2.60)),
    ("tail_2", "tail_1", (0, 1.33, -2.60), (0, .95, -3.42)),
    ("tail_3", "tail_2", (0, .95, -3.42), (0, .70, -4.06)),
    ("tail_tip", "tail_3", (0, .70, -4.06), (0, .60, -4.50)),
    ("horn_nose", "skull", (0, 1.96, 2.68), (0, 2.47, 2.95)),
]
for side, sign in (("l", 1), ("r", -1)):
    def mirror(p):
        return (p[0] * sign, p[1], p[2])
    for end, chain in LEGS.items():
        parent = "chest" if end == "front" else "pelvis"
        for k, part in enumerate(("upper", "lower", "foot")):
            name = f"{end}_{part}_{side}"
            BONES.append((name, parent, mirror(chain[k]), mirror(chain[k + 1])))
            parent = name
        p = mirror(chain[-1])
        BONES.append((f"{end}_toes_{side}", parent, p, (p[0], .10, p[2] + .22)))
    BONES += [
        (f"eye_{side}", "skull", mirror(EYE), mirror((.64, 2.025, 2.09))),
        (f"lid_{side}", "skull", mirror(EYE), mirror((EYE[0], EYE[1], EYE[2]+.08))),
        (f"frill_{side}", "skull", mirror((.45, 2.02, 1.55)), mirror((1.02, 2.62, 1.10))),
        (f"horn_{side}", "skull", mirror(HORNS[0][0]), mirror(HORNS[-1][0])),
    ]

# Rigid contact witnesses add no articulated masses. A broad thin shield and
# an oval trunk cannot be represented by one inflated circular capsule.
for side,sign in (("l",1),("r",-1)):
    BONES += [
        (f"flank_support_{side}","body",(sign*.45,1.75,-.60),(sign*.45,1.75,.45)),
        (f"frill_rim_{side}",f"frill_{side}",(sign*1.02,2.05,1.34),(sign*.59,3.03,.96)),
        (f"frill_rib_{side}",f"frill_{side}",(sign*.75,2.00,1.60),(sign*.62,2.93,1.01)),
        (f"back_support_{side}","body",(sign*.55,2.17,-.60),(sign*.55,2.17,.40)),
    ]
BONES.append(("frill_keel","skull",(0,2.20,1.55),(0,3.13,.95)))
# A thin broad foot needs a separate anterior contact carried by the real
# toe chain. These witnesses carry no skin or extra articulated mass.
for side,sign in (("l",1),("r",-1)):
    for end,chain in LEGS.items():
        p=chain[-1];head=(p[0]*sign,p[1],p[2])
        BONES.append((f'{end}_pad_{side}',f'{end}_toes_{side}',head,
                      (head[0],head[1],head[2]+.30)))



def to_blender(p):
    return Vector((p[0], -p[2], p[1]))


def point_blender(p):
    return Vector((p[0], -p[2], p[1] - GROUND))


def to_animal(p):
    return Vector((p[0], p[2], -p[1]))
