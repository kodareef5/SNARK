"""Bent and corroded original boat; same closed surfaces, UVs and rigid hardware ownership as the intact craft."""
import math
import os
import runpy
import sys
import bpy
folder=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","boat")
sys.path.insert(0,folder)
for source in ("rig.py","model.py"):runpy.run_path(os.path.join(folder,source),run_name="__main__")
for obj in bpy.data.objects:
    if obj.type!="MESH":continue
    for vertex in obj.data.vertices:
        # Blender x, -engine-z, engine-y. Smooth deformation keeps the hull watertight at every level.
        x,y,z=vertex.co
        if obj.name=="chassis":
            bow=max(0,min(1,(-y-1.75)/1.65));x*=1-.16*bow;y+=bow*.30;z-=bow*.22
            if z>1.80 and y<-.9:
                t=(z-1.80)/.65;y+=t*.24;z-=t*.14
            if abs(x)>1.0:z-=.07*math.sin(y*2.3)**2
        elif obj.name in ("outboard","propeller"):
            t=max(0,min(1,(z+.28)/2.06));x+=t*.10;z-=t*.08
        vertex.co=(x,y,z)
