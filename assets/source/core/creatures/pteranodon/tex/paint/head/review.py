#!/usr/bin/env python3
"""Same-size original/study/paint/relief comparisons; review files only."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.spatial import cKDTree
import paint
H=Path(__file__).resolve().parent;P=H.parent;S=paint.STUDIES;C=H/'checks';C.mkdir(exist_ok=True)
r=paint.read;m=json.loads((P/'pteranodon_pieces.json').read_text());ids={e['name']:e['number'] for e in m['pieces']}
pc=r(P/'pteranodon_pieces.png')[...,0]
pos=np.stack([r(P/f'pteranodon_position_{k}.png').astype(np.float32)/65535*(m['position_box']['max'][i]-m['position_box']['min'][i])+m['position_box']['min'][i] for i,k in enumerate('xyz')],-1);pos[...,0]=abs(pos[...,0])
b=r(H/'layers/pteranodon_base.png')[...,:3];h=r(H/'layers/pteranodon_height.png').astype(np.float32)/65535*paint.RECIPE['height_range_mm'];ao=r(H/'layers/pteranodon_occlusion.png').astype(np.float32)/255
cfg=json.loads((S/'fuzz/study.json').read_text());fuzzsrc=S/'fuzz'/cfg['source'];scale=cfg.get('source_scale_before_quilting',.78)
try:font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
except OSError:font=ImageFont.load_default()
for name,mm in [('horn',80),('fuzz_face',60)]:
    mask=pc==ids['crest' if name=='horn' else 'head'];pp=pos[mask]
    if name=='horn':
        origin=np.array(paint.RECIPE['crest_origin_yz']);tip=np.array(paint.RECIPE['crest_tip_yz']);axis=tip-origin;axis/=np.linalg.norm(axis)
        along=(pp[:,1]-origin[0])*axis[0]+(pp[:,2]-origin[1])*axis[1]
        across=-(pp[:,1]-origin[0])*axis[1]+(pp[:,2]-origin[1])*axis[0]
        coords=np.stack([along,across],-1);centre=np.array([.36,.0]);folder='horn';source=S/'horn/source/horn_generated.png';srcppm=Image.open(source).width*.82/.4;span=.4
    else:
        u,v=paint.flow_chart(mask,pos,r(paint.BAKES/'pteranodon_flow.png'));coords=np.stack([u,v],-1)
        centre=coords[np.linalg.norm(pp-np.array([.062,1.287,.60]),axis=-1).argmin()]
        folder='fuzz';source=fuzzsrc;srcppm=2048/.25*scale;span=.25
    side=round(mm*2);t=(np.arange(side)+.5-side/2)/2000
    xx,yy=np.meshgrid(t,t);query=np.stack([xx+centre[0],yy+centre[1]],-1)
    dist,near=cKDTree(coords).query(query)
    actual=b[mask][near];hh=h[mask][near];occ=ao[mask][near]
    dy,dx=np.gradient(hh,.5);n=np.stack([-dx,dy,np.ones_like(dx)],-1);n/=np.linalg.norm(n,axis=-1,keepdims=True)
    light=np.array([-.4,-.45,.8]);light/=np.linalg.norm(light)
    lum=.35+.65*np.maximum(0,(n*light).sum(-1))
    relit=np.uint8(np.clip(paint.srgb(paint.linear(actual.astype(np.float32)/255)*lum[...,None]*occ[...,None])*255,0,255))
    def crop_physical(path,ppm):
        im=Image.open(path).convert('RGB');size=round(mm/1000*ppm);cx,cy=im.width//2,im.height//2
        return im.crop((cx-size//2,cy-size//2,cx+(size+1)//2,cy+(size+1)//2)).resize((side,side),Image.Resampling.LANCZOS)
    imgs=[crop_physical(source,srcppm),crop_physical(S/folder/f'{name}_base.png',2048/span),Image.fromarray(actual),Image.fromarray(relit)]
    labels=['Generated original','Accepted study base','Painted base on model','Painted height relit']
    # All first resampled at 2000 pixels/m, then equally enlarged 3x for inspection.
    box=side*3;sheet=Image.new('RGB',(box*4+100,box+96),(225,223,218));draw=ImageDraw.Draw(sheet)
    draw.text((20,10),f'{name}: each square {mm} mm; 2000 px/m, equally enlarged 3x; original crops are not registered',font=font,fill=(24,24,24))
    for i,(im,label) in enumerate(zip(imgs,labels)):
        x=20+i*(box+20);draw.text((x,43),label,font=font,fill=(24,24,24));sheet.paste(im.resize((box,box),Image.Resampling.NEAREST),(x,74))
    sheet.save(C/f'{name}_source_base_relief.png')
    print(C/f'{name}_source_base_relief.png')
# Final reference panels, refreshed after the current game render.
for shot,reference in [('side','head_side'),('front','head_front')]:
    fn=C/'details'/f'{shot}_1000ppm_design.png'
    if not fn.exists():continue
    a=Image.open(paint.ASSET/'ref/concept'/f'{reference}.png').convert('RGB');b=Image.open(fn).convert('RGB')
    sheet=Image.new('RGB',(max(a.width,b.width),a.height+b.height+76),(225,223,218));d=ImageDraw.Draw(sheet)
    d.text((18,10),'CONCEPT | 1000 px / m',fill=(30,30,30));sheet.paste(a,(0,34))
    d.text((18,a.height+44),'PAINTED MODEL | GAME RGBA | 1000 px / m at centre plane',fill=(30,30,30));sheet.paste(b,(0,a.height+76))
    sheet.save(C/f'{shot}_concept_comparison.png')
# The shared cut is a separate geometric check, not a UV-adjacency assumption.
body=P/'body/layers'
if (body/'layers.json').exists():
    mh=pc==ids['head'];mn=pc==ids['neck'];dist,near=cKDTree(pos[mn]).query(pos[mh]);close=dist<.0015
    facts={'pairs_within_1_5_mm':int(close.sum())}
    for name in ['base','height','rough','occlusion','regions']:
        a=r(H/'layers'/f'pteranodon_{name}.png')[mh][close];b=r(body/f'pteranodon_{name}.png')[mn][near[close]]
        if name=='base':facts['base_linear_mean_difference']=float(np.abs(paint.linear(a[:,:3].astype(np.float32)/255)-paint.linear(b[:,:3].astype(np.float32)/255)).mean())
        elif name=='height':
            bh=json.loads((body/'layers.json').read_text())['pteranodon_height_mm']
            facts['height_mean_difference_mm']=float(np.abs(a.astype(float)/65535*paint.RECIPE['height_range_mm']-b.astype(float)/65535*bh).mean())
        elif name=='regions':facts['region_agreement']=float(np.all(a==b,axis=-1).mean())
        else:facts[f'{name}_mean_difference']=float(np.abs(a.astype(float)-b.astype(float)).mean()/255)
    (C/'join_measurements.json').write_text(json.dumps(facts,indent=2)+'\n')
    print(json.dumps(facts,indent=2))

# Round-two review keeps the actual renderer pixels: no contrast edits. The
# standard views have different perspective from the orthographic concepts;
# the side/front_1000ppm sheets above are the physical-scale comparisons.
before=C/'round1_before/checks/look'
for shot,reference in [('head','head_side'),('head_front','head_front'),('rider','head_side')]:
    current=C/'look'/f'{shot}_design.png'
    if not current.exists() or not (before/current.name).exists():continue
    a=Image.open(before/current.name).convert('RGB')
    b=Image.open(current).convert('RGB')
    # Concept head details are at 1000 px/m. Standard game head is ~603 px/m;
    # front is ~822 px/m at the target plane. Rider is a perspective context.
    ref=Image.open(paint.ASSET/'ref/concept'/f'{reference}.png').convert('RGB')
    factor=900/(2*(.55 if shot=='head_front' else .75)*np.cos(.1))/1000
    if shot=='rider':ref=ref.crop((1000,700,1500,1250));factor=1
    ref=ref.resize((round(ref.width*factor),round(ref.height*factor)),Image.Resampling.LANCZOS)
    if shot=='head_front':
        # Show head and upper neck at matched density, without squeezing it.
        ref=ref.crop((0,100,ref.width,1000))
    row=Image.new('RGB',(3600,966),(225,223,218));d=ImageDraw.Draw(row)
    titles=[f'CONCEPT | {"nape detail, native scale" if shot=="rider" else "matched centre-plane density"}',
            'SENT BACK | game renderer', 'REVISED | game renderer']
    for i,(im,title) in enumerate(zip([ref,a,b],titles)):
        d.text((i*1200+18,15),title,font=font,fill=(24,24,24))
        row.paste(im,(i*1200+(1200-im.width)//2,50))
    row.save(C/f'{shot}_round2_comparison.png')

# Keep a focused rider comparison legible without rescaling whole-animal views.
if (before/'rider_design.png').exists():
    refs=[Image.open(paint.ASSET/'ref/concept/head_side.png').crop((1020,720,1490,1200)),
          Image.open(before/'rider_design.png').crop((470,180,735,660)).resize((530,960),Image.Resampling.NEAREST),
          Image.open(C/'look/rider_design.png').crop((470,180,735,660)).resize((530,960),Image.Resampling.NEAREST)]
    row=Image.new('RGB',(1590,1020),(225,223,218));d=ImageDraw.Draw(row)
    for i,(im,title) in enumerate(zip(refs,['CONCEPT | 1000 px/m','SENT BACK | rider 2x','REVISED | rider 2x'])):
        d.text((i*530+10,14),title,font=font,fill=(24,24,24));row.paste(im,(i*530,50))
    row.save(C/'rider_round2_detail.png')
