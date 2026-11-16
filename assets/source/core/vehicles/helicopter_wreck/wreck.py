"""A broken, burnt version of the same authored helicopter. The UVs, bone ownership and sockets remain unchanged."""
import math
import os
import runpy
import sys
import bpy
folder=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","helicopter")
sys.path.insert(0,folder)
for source in ("rig.py","model.py"):
    runpy.run_path(os.path.join(folder,source),run_name="__main__")

for o in bpy.data.objects:
    if o.type != "MESH": continue
    for v in o.data.vertices:
        # Blender x, -engine-z, engine-y. Damage displaces closed surfaces; it never opens the topology.
        x,y,z=v.co
        if o.name=="rotor_main":
            r=math.hypot(x,y-.30)
            bend=max(0,r-1.10)
            z-=bend*.19
            y+=max(0,x-1.8)*.22
        elif o.name=="rotor_tail":
            z-=max(0,z-2)*.35
        elif o.name=="chassis":
            if y>2.0:
                t=min(1,(y-2.0)/3.6)
                x+=math.sin(t*math.pi/2)*.46
                z-=t*.35
            elif y< -1.2 and z<1.55:
                y+=(-y-1.2)*.14
                z-=.07
            if z>2.40 and y<1.8: z=2.40+(z-2.40)*.68
        elif o.name.startswith("door_"):
            x+=math.copysign(.04*math.sin(z*7+y*3),x)
        v.co=(x,y,z)
