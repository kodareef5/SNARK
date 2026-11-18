"""Build the craft from their measured game contract. Coordinates here are X port, Y up, Z forward."""
import json
import math
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import bmesh
import bpy
from mathutils import Vector

from finishes import TILES

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "compact"))
from parts import E2B, Part, cylinder, rbox, tags_of


def mix(a, b, t):
    return a + (b - a) * t


def samples(a, b, n):
    return [mix(a, b, i / n) for i in range(n + 1)]


def section(stations, z):
    for first, second in zip(stations, stations[1:]):
        if z <= second[0]:
            t = max(0, (z-first[0]) / (second[0]-first[0]))
            return [mix(a, b, t) for a, b in zip(first[1:], second[1:])]
    return stations[-1][1:]


class Yard:
    def __init__(self, kind, dims):
        self.kind, self.d = kind, dims
        self.bone = "chassis"
        self.objects = []
        self.joints = {"chassis": ((0, 0, 0), None), "steering": (dims.helm, "chassis"), "outboard": (dims.outboard, "chassis")}
        if dims.family != "pwc":
            self.joints["propeller"] = (dims.propeller, "outboard")
        if hasattr(dims, "secondOutboard"):
            self.joints["outboard_starboard"] = (dims.secondOutboard, "chassis")
            self.joints["propeller_starboard"] = (dims.secondPropeller, "outboard_starboard")

    def add(self, obj):
        self.objects.append((self.bone, obj))

    def loft(self, name, rings, tag, cap=None):
        p = Part()
        caps = cap or tag
        p.loft(rings, tag, caps=(caps, caps))
        self.add(p.obj(name))

    def box(self, name, at, size, tag, r=.016, seg=2):
        low = [c - v / 2 for c, v in zip(at, size)]
        high = [c + v / 2 for c, v in zip(at, size)]
        self.add(rbox(name, low, high, r, tag, seg))

    def rod(self, name, a, b, r, tag, sides=12, r2=None):
        self.add(cylinder(name, a, b, r, tag, sides, r2))

    def tube(self, name, points, radius, tag, sides=8):
        pts = [Vector(v) for v in points]
        direction = (pts[-1] - pts[0]).normalized()
        ref = min([Vector((1,0,0)), Vector((0,1,0)), Vector((0,0,1))], key=lambda v: abs(direction.dot(v)))
        rings = []
        for i, point in enumerate(pts):
            axis = (pts[min(i+1, len(pts)-1)] - pts[max(0, i-1)]).normalized()
            u = axis.cross(ref).normalized()
            if u.length < .5:
                u = axis.cross(Vector((0, 0, 1))).normalized()
            v = axis.cross(u).normalized()
            rings.append([point + radius * (u*math.cos(a*math.tau/sides) + v*math.sin(a*math.tau/sides)) for a in range(sides)])
        self.loft(name, rings, tag)

    def wheel(self, dashboard_z):
        d = self.d
        x, y, z = d.helm
        self.rod("tapered helm column", (x,y,z+.005), (x,y+.045,dashboard_z), .046, "steel", 16, .069)
        self.bone = "steering"
        p, rings = Part(), []
        for i in range(40):
            c, s = math.cos(i*math.tau/40), math.sin(i*math.tau/40)
            rings.append([p.v((x + c*(d.grip+.020*math.cos(a*math.tau/8)), y+s*(d.grip+.020*math.cos(a*math.tau/8)), z+.020*math.sin(a*math.tau/8))) for a in range(8)])
        for i in range(40):
            for a in range(8):
                p.face((rings[i][a],rings[(i+1)%40][a],rings[(i+1)%40][(a+1)%8],rings[i][(a+1)%8]),"grip")
        self.add(p.obj("wrapped three-spoke rim"))
        for i in range(3):
            a = i*math.tau/3 - math.pi/2
            c, s = math.cos(a), math.sin(a)
            rows = []
            for r, dw, dz in ((.027,.021,.027), (.071,.023,.020),(d.grip-.009,.014,.002)):
                rows.append([(x+r*c-w*s,y+r*s+w*c,z+dz+depth) for w,depth in ((-dw,-.008),(dw,-.008),(dw,.008),(-dw,.008))])
            self.loft("brushed spoke",rows,"chrome")
        self.rod("horn hub", (x,y,z-.019),(x,y,z+.055),.051,"engine",20)
        self.bone = "chassis"

    def gauge(self, x, y, z, r):
        self.rod("bezel", (x,y,z-.006),(x,y,z+.020),r,"chrome",24)
        self.rod("instrument dial", (x,y,z-.010),(x,y,z-.004),r*.875,"gauge",24)

    def hatch(self, name, x, z, y, width, length, face, gasket="rubber"):
        self.box(name+" seal",(x,y,z),(width,.034,length),gasket,.016)
        self.box(name+" lid",(x,y+.025,z),(width-.038,.042,length-.045),face,.019)
        self.box(name+" pull",(x,y+.053,z-length*.33),(.105,.015,.048),"chrome",.006)

    def cleat(self,x,y,z):
        self.box("cleat foot",(x,y+.014,z),(.08,.030,.16),"steel",.011)
        for dz in (-.045,.045):
            self.rod("cleat post",(x,y+.021,z+dz),(x,y+.065,z+dz),.014,"chrome",8)
        self.rod("cleat horn",(x,y+.069,z-.125),(x,y+.069,z+.125),.017,"chrome",10)

    def finish(self):
        arm = bpy.data.armatures.new(self.kind)
        rig = bpy.data.objects.new(self.kind, arm)
        bpy.context.scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        for name, ((x,y,z), parent) in self.joints.items():
            bone = arm.edit_bones.new(name)
            bone.head, bone.tail = (x,-z,y), (x,-z,y+.10)
            if parent:
                bone.parent = arm.edit_bones[parent]
        bpy.ops.object.mode_set(mode="OBJECT")
        mats = {name:bpy.data.materials.new(name) for name in ("laminate","hardware")}
        for bone, obj in self.objects:
            mesh = obj.data
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.triangulate(bm, faces=list(bm.faces))
            bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
            bm.to_mesh(mesh)
            bm.free()
            tags = tags_of(obj)
            mesh.materials.clear()
            for mat in mats.values():
                mesh.materials.append(mat)
            uv = mesh.uv_layers.new(name="marine swatches")
            pts = [v.co.copy() for v in mesh.vertices]
            low = [min(p[k] for p in pts) for k in range(3)]
            span = [max(p[k] for p in pts)-low[k] for k in range(3)]
            for face, tag in zip(mesh.polygons,tags):
                mat, tile = TILES[tag]
                face.material_index = list(mats).index(mat)
                face.use_smooth = True
                axis = max(range(3),key=lambda k:abs(face.normal[k]))
                a, b = ((2,1),(0,2),(0,1))[axis]
                for loop in face.loop_indices:
                    p = pts[mesh.loops[loop].vertex_index]
                    u, v = (p[a]-low[a])/max(span[a],.00001), (p[b]-low[b])/max(span[b],.00001)
                    if (axis==2 and face.normal.z<0) or (axis==0 and face.normal.x>0):
                        u = 1-u
                    uv.data[loop].uv = ((tile%4+.04+.92*u)/4,1-(tile//4+.96-.92*v)/4)
            mesh.set_sharp_from_angle(angle=math.radians(39))
            mesh.transform(E2B)
            obj.vertex_groups.new(name=bone).add(list(range(len(pts))),1,"REPLACE")
            obj.parent = rig
            obj.modifiers.new("Armature","ARMATURE").object = rig
        bpy.ops.object.select_all(action="DESELECT")
        for bone, obj in self.objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = self.objects[0][1]
        bpy.ops.object.join()
        bpy.context.object.name = self.kind+"_skin"


def build(kind):
    contract = HERE.parents[4] / "content/vehicles/small-craft.ts"
    query = f"import {{ SMALL_CRAFT }} from '{contract.as_posix()}'; console.log(JSON.stringify(SMALL_CRAFT.find(d=>d.id==='core:{kind}')))"
    d = SimpleNamespace(**json.loads(subprocess.check_output(["bun", "-e", query],text=True)))
    yard = Yard(kind, d)
    if d.family == "offshore":
        from offshore import offshore
        offshore(yard)
    elif d.family == "jon":
        from skiff import skiff
        skiff(yard)
    else:
        from personal import personal
        personal(yard)
    yard.finish()
