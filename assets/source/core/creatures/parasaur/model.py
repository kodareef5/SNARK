"""Restore the approved rest surface exactly, including its UV seams and binding."""
from pathlib import Path
import bpy
import numpy as np

def build():
    src=np.load(Path(__file__).with_name('skin.npz'))
    xyz=src['points'][:,[0,2,1]].copy()
    xyz[:,1]*=-1
    mesh=bpy.data.meshes.new('Parasaur rest surface')
    mesh.from_pydata(xyz.tolist(),[],src['tri'].tolist())
    obj=bpy.data.objects.new('parasaur_model',mesh)
    bpy.context.collection.objects.link(obj)
    for name in src['materials']:
        mesh.materials.append(bpy.data.materials.new(str(name)))
    mat=src['slots'].astype(np.int32)
    mesh.polygons.foreach_set('material_index',mat)
    mesh.polygons.foreach_set('use_smooth',np.ones(len(mat),bool))
    uv=mesh.uv_layers.new(name='Skin')
    uv.data.foreach_set('uv',src['uv'].ravel())
    groups=[obj.vertex_groups.new(name=str(n)) for n in src['bones']]
    for i,(joints,weights) in enumerate(zip(src['joints'],src['weights'])):
        for j,w in zip(joints,weights):
            if w:groups[j].add([i],w,'REPLACE')
    rig=bpy.data.objects['parasaur']
    obj.parent=rig
    mod=obj.modifiers.new('Parasaur skin','ARMATURE');mod.object=rig
    mesh.update()
if __name__=='__main__':
    build()
