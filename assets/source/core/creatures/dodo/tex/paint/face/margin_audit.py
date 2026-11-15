"""Measure the margin against adjoining body-red neck texels after composition."""
import site
site.addsitedir(site.getusersitepackages())
import argparse,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
from PIL import Image
from scipy.ndimage import label,uniform_filter
from scipy.spatial import cKDTree
import paint

ROOT=Path(__file__).resolve().parent

def main():
    p=argparse.ArgumentParser();p.add_argument('--composed',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    _,pieces,pos,ids,regions,mm=paint.load_geometry()
    g=paint.margin.geometry(paint,pieces,pos,ids,regions,mm);own=g['own']
    reg=np.asarray(Image.open(a.composed/'dodo_regions.png').convert('RGB'))
    red=(reg==[255,0,0]).all(-1)
    base=paint.lin(np.asarray(Image.open(a.composed/'dodo_base.png'))[...,:3]/255).mean(-1)
    packed=np.asarray(Image.open(a.composed/'dodo_packed.png'))/255
    fields={'base_linear':base,'occlusion':packed[...,0],'roughness':packed[...,1]}
    ref=g['body']&red
    distance_to_face=cKDTree(g['P'][g['face']]).query(pos[ref])[0]
    strip=[]
    for lo,hi in [(0,3),(3,8),(8,15),(15,25)]:
        m=(distance_to_face>=lo)&(distance_to_face<hi)
        strip.append(dict(distance_to_face_mm=[lo,hi],texels=int(m.sum()),
            **{key:float(f[ref][m].mean()) for key,f in fields.items()}))
    tree=cKDTree(pos[ref]);_,nearest=tree.query(g['P'])
    reductions=[]
    for size in [1,2,4,8]:
        reduced=uniform_filter(base,size)
        for part in ['face','pouch']:
            m=red[own]&g[part]
            current=float(reduced[own][m].mean());neck=float(reduced[ref][nearest[m]].mean())
            reductions.append(dict(part=part,filter_texels=size,margin_linear=current,neck_linear=neck,ratio=current/neck))
    rows=[]
    for part in ['face','pouch']:
        for lo,hi in [(0,3),(3,8),(8,15),(15,25)]:
            m=red[own]&g[part]&(g['distance']>=lo)&(g['distance']<hi)
            if not m.any():continue
            row=dict(part=part,edge_distance_mm=[lo,hi],texels=int(m.sum()))
            for key,f in fields.items():
                current=float(f[own][m].mean());near=float(f[ref][nearest[m]].mean())
                row[key]=dict(margin=current,adjoining_neck=near,ratio=current/near)
            rows.append(row)
    # Each face component must either meet the neck or stay within 10 mm.
    masks=(pieces==ids['shell_face'])&red
    labels,n=label(masks);components=[]
    for k in range(1,n+1):
        m=(labels==k)[own];d=g['distance'][m]
        if not len(d):continue
        components.append(dict(texels=int(m.sum()),min_edge_mm=float(d.min()),
            max_edge_mm=float(d.max()),centre_mm=g['P'][m].mean(0).tolist(),
            attached=bool(d.min()<1.1)))
    result=dict(composed=str(a.composed),neck_strip=strip,reductions=reductions,measurements=rows,face_components=components)
    a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':main()
