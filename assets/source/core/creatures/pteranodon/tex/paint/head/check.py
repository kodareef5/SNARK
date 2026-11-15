#!/usr/bin/env python3
"""Independent ownership, dye, relief, flow and rebuild checks for the head."""
from pathlib import Path
import json, hashlib, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
import paint

H=Path(__file__).resolve().parent;P=H.parent;L=H/'layers';C=H/'checks';A=P.parent.parent
# Bring outputs up to date before comparing two runs: accepted studies and
# neighbouring painter layers may have changed since the last paint invocation.
subprocess.run([sys.executable,str(H/'paint.py')],check=True)
r=lambda p:np.asarray(Image.open(p))
meta=json.loads((P/'pteranodon_pieces.json').read_text());nums={p['name']:p['number'] for p in meta['pieces']}
pieces=r(P/'pteranodon_pieces.png')[...,0];own=np.isin(pieces,[nums[n] for n in paint.OWN])
b=r(L/'pteranodon_base.png');h=r(L/'pteranodon_height.png');reg=r(L/'pteranodon_regions.png')
assert b.shape==(2048,2048,4) and b.dtype==np.uint8
assert h.shape==(2048,2048) and h.dtype==np.uint16
assert np.all(b[own,3]==255) and np.all(b[~own,3]==0)
valid=np.zeros(own.shape,bool)
for c in paint.COLORS:valid|=(reg==c).all(-1)
assert valid.all()
dyed=own&np.any(reg,axis=-1)
assert np.max(np.ptp(b[dyed,:3].astype(int),axis=-1))==0
for name in ['height','rough','occlusion','regions']:
    assert np.all(r(L/f'pteranodon_{name}.png')[~own]==0)
facts={'coverage_texels':int(own.sum()),'unpainted_owned':0,'painted_unowned':0,'invalid_regions':0,'dyed_rgb_spread':0,'height_bits':16}
lin=paint.linear(b[...,:3].astype(np.float32)/255)
facts['means_linear']={str(i):float(lin[own&(reg==c).all(-1)].mean()) for i,c in enumerate(paint.COLORS[:6]) if np.any(own&(reg==c).all(-1))}
assert all(abs(v-.5)<.02 for v in facts['means_linear'].values())
# Check the physical chart direction against the independent baked flow.
pos=np.stack([r(P/f'pteranodon_position_{k}.png').astype(np.float32)/65535*(meta['position_box']['max'][i]-meta['position_box']['min'][i])+meta['position_box']['min'][i] for i,k in enumerate('xyz')],-1);pos[...,0]=abs(pos[...,0])
m=pieces==nums['head'];flow=r(A/'ref/bakes/pteranodon_flow.png')
u,v=paint.flow_chart(m,pos,flow)
cu=np.zeros(m.shape,np.float32);cu[m]=u
cv=np.zeros(m.shape,np.float32);cv[m]=v
dy,dx=np.gradient(cu)
fd=flow[...,:2].astype(np.float32)/127.5-1;fd[...,1]*=-1
n=np.hypot(dx,dy);fn=np.linalg.norm(fd,axis=-1)
cos=(-dy*fd[...,0]+dx*fd[...,1])/np.maximum(n*fn,1e-12)
valid=m&((reg==paint.COLORS[0]).all(-1)|(reg==paint.COLORS[5]).all(-1))&(distance_transform_edt(m)>6)&(fn>.2)
angles=np.degrees(np.arccos(np.clip(abs(cos[valid]),0,1)))
facts['fuzz_flow_angle_degrees']={str(p):float(np.percentile(angles,p)) for p in [50,90,95]}
# Measured throat/face drawing has no deliberate light or alternate pale base.
facts['fuzz_base_linear_std']=float(lin[m&(reg==paint.COLORS[5]).all(-1)].std())
# Measure real nasal floor extent independently of UV pixels.
hmm=h.astype(np.float32)/65535*json.loads((L/'layers.json').read_text())['pteranodon_height_mm']
x,y,z=pos.transpose(2,0,1)
ns=own&(z>.80)&(z<.88)&(y>1.31)&(y<1.34)&(hmm<.20)&(reg==paint.COLORS[2]).all(-1)
facts['nasal_floor_extent_z_mm']=float(np.ptp(z[ns])*1000)
assert 55<facts['nasal_floor_extent_z_mm']<65
# The plane crossing the crest produces the band independent of mesh faces.
crest=pieces==nums['crest'];o=np.array(paint.RECIPE['crest_origin_yz']);tip=np.array(paint.RECIPE['crest_tip_yz']);axis=tip-o;length=np.linalg.norm(axis);axis/=length
fromtip=length-((y-o[0])*axis[0]+(z-o[1])*axis[1]);expected=crest&(fromtip>.099)&(fromtip<.185)
assert np.array_equal(expected,own&(reg==paint.COLORS[3]).all(-1))
facts['band_limits_mm']=[float(fromtip[expected].min()*1000),float(fromtip[expected].max()*1000)]
# Measure delivered drawing in animal space, including filtering/fringe variation.
charcoal=(reg==paint.COLORS[0]).all(-1)
facts['eye_streak_depth_mm']={}
for name,zz,limits in [('at_eye',.694,(25,38)),('rear_cheek',.55,(43,57))]:
    cross=m&charcoal&(np.abs(z-zz)<.001)&(y>1.33)&(y<1.42)
    bounds=np.percentile(y[cross],[5,95])*1000
    depth=float(bounds[1]-bounds[0])
    facts['eye_streak_depth_mm'][name]={'central_90_percent':depth,'y_bounds_mm':bounds.tolist()}
    assert limits[0]<depth<limits[1], (name,depth)
# A rear-head patch continues below the cheek band; a thin ring would fail.
back=m&(x<.018)&(y>1.355)&(y<1.375)&(z<.43)
facts['rear_head_below_band_charcoal_fraction']=float(charcoal[back].mean())
assert facts['rear_head_below_band_charcoal_fraction']>.98
# Compare natural iris pigment with the black pupil, independent of lighting.
centre=np.array(paint.RECIPE['eye_centre']);look=np.array(paint.RECIPE['eye_look']);look/=np.linalg.norm(look)
dp=pos-centre;ef=(dp*look).sum(-1);er=np.sqrt(np.maximum((dp*dp).sum(-1)-ef*ef,0))
wet=(pieces==nums['eye_l'])&(reg==0).all(-1)&(ef>.002)
iris=wet&(er>.004)&(er<.007);pupil=wet&(er<.0023)
irisrgb=lin[iris].mean(0);pupilrgb=lin[pupil].mean(0)
facts['eye_iris_mean_srgb']=(paint.srgb(irisrgb)*255).tolist()
facts['eye_pupil_mean_srgb']=(paint.srgb(pupilrgb)*255).tolist()
weights=np.array([.2126,.7152,.0722])
facts['iris_to_pupil_linear_luminance']=float((irisrgb@weights)/max(pupilrgb@weights,1e-6))
assert facts['iris_to_pupil_linear_luminance']>8
assert irisrgb[1]/irisrgb[0]>.30
# Byte reproducibility checks all six delivered files. Body/study changes are
# detected separately, because those live inputs intentionally change the paint.
files=sorted(L.glob('*'))
hashfile=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before={p.name:hashfile(p) for p in files}
inputs=sorted((P/'body/layers').glob('*'))+sorted((A/'tex/studies/fuzz').glob('*.png'))
in_before={str(p):hashfile(p) for p in inputs}
subprocess.run([sys.executable,str(H/'paint.py')],check=True)
in_after={str(p):hashfile(p) for p in inputs}
after={p.name:hashfile(p) for p in files}
facts['inputs_stable_during_rebuild']=in_before==in_after
facts['byte_identical_rebuild']=before==after
if facts['inputs_stable_during_rebuild']:assert facts['byte_identical_rebuild']
facts['sha256']=after
(C/'validation.json').write_text(json.dumps(facts,indent=2)+'\n')
print(json.dumps(facts,indent=2))
# Requested matched-density reference sheets. Game views are 1000 px/m at their
# central plane, same as the supplied head concepts; small perspective remains.
for shot,reference in [('side','head_side'),('front','head_front')]:
    fn=C/'details'/f'{shot}_1000ppm_design.png'
    if not fn.exists():continue
    a=Image.open(A/'ref/concept'/f'{reference}.png').convert('RGB');b=Image.open(fn).convert('RGB')
    sheet=Image.new('RGB',(max(a.width,b.width),a.height+b.height+76),(225,223,218));d=ImageDraw.Draw(sheet)
    d.text((18,10),'CONCEPT | 1000 px / m',fill=(30,30,30));sheet.paste(a,(0,34))
    d.text((18,a.height+44),'PAINTED MODEL | GAME RGBA | 1000 px / m at centre plane',fill=(30,30,30));sheet.paste(b,(0,a.height+76))
    sheet.save(C/f'{shot}_concept_comparison.png')
