"""Audit the saddle delivery and make native-scale material review sheets.

python3 tex/paint/saddle/check.py [--rebuild]
--rebuild checks all six delivery files reproduce byte for byte.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, map_coordinates
import paint

HERE=Path(__file__).resolve().parent
LAYERS=HERE/'layers'
CHECKS=HERE/'checks'
MAT=paint.MAT


def main():
    CHECKS.mkdir(exist_ok=True)
    meta=json.loads((paint.PAINT/f'{MAT}_pieces.json').read_text())
    pieces=np.asarray(Image.open(paint.PAINT/f'{MAT}_pieces.png'))[...,0]
    own=pieces>0
    mm=np.asarray(Image.open(paint.PAINT/f'{MAT}_texel_mm.png'),dtype=np.float32)/1000
    maps={name:np.asarray(Image.open(LAYERS/f'{MAT}_{name}.png')) for name in ['base','height','rough','occlusion','regions']}
    for name,a in maps.items():assert a.shape[:2]==(1024,1024),(name,a.shape)
    assert maps['base'].shape==(1024,1024,4)
    assert np.all(maps['base'][...,3][own]==255)
    assert np.all(maps['base'][...,3][~own]==0)
    assert not maps['regions'].any()
    assert maps['height'].dtype==np.uint16
    assert maps['rough'].ndim==maps['occlusion'].ndim==2
    full=json.loads((LAYERS/'layers.json').read_text())[f'{MAT}_height_mm']
    height=(maps['height'].astype(np.float32)/65535-.5)*full
    assert np.all(np.isfinite(height))
    assert height[own].min()>-full/2 and height[own].max()<full/2
    report=dict(size=1024,pieces=len(meta['pieces']),covered_texels=int(own.sum()),alpha_exact=True,
                black_regions=True,height_encoding_mm=full,used_height_mm=float(np.ptp(height[own])))

    # Verify model-space coordinates against the independently baked 16-bit
    # positions. This catches wrong face winding or a wrong quad diagonal.
    lo=np.array(meta['position_box']['min']);hi=np.array(meta['position_box']['max'])
    p=np.stack([np.asarray(Image.open(paint.PAINT/f'{MAT}_position_{a}.png'))/65535 for a in 'xyz'],-1)*(hi-lo)+lo
    p[...,0]=abs(p[...,0])
    parts,_=paint.geometry();errors={}
    for name,part in parts.items():
        val={i:np.array(part.points)[list(part.faces[i])] for i in part.pinned}
        got,mask=paint.raster(part,val,1024);got[...,0]=abs(got[...,0])
        error=np.linalg.norm(got[mask]-p[mask],axis=1)*1000
        errors[name]=round(float(error.max()),5)
        assert error.max()<.025,(name,float(error.max()))
    report['max_position_error_mm']=errors

    # Seams in the delivered atlas, sampled after the same nearest-texel dilation
    # used by compose.py. Different materials meeting at a physical seam are
    # excluded; compare only each continuous tube's own UV cut.
    _,ind=distance_transform_edt(~own,return_indices=True)
    colour=maps['base'][...,:3].astype(np.float32)[ind[0],ind[1]]
    hf=height[ind[0],ind[1]]
    def sample(a,uv):
        c=[(1-uv[:,1])*1024-.5,uv[:,0]*1024-.5]
        if a.ndim==2:return map_coordinates(a,c,order=1,mode='nearest')
        return np.stack([map_coordinates(a[...,k],c,order=1,mode='nearest') for k in range(a.shape[-1])],-1)
    seams={}
    for name in ['cantle','grip_l','rest_l','rein_l','halter_beak','halter_head','peg_l']:
        part=parts[name];edges={}
        for fi,(_,uv) in part.pinned.items():
            face=part.faces[fi]
            for k in range(len(face)):
                a,b=face[k],face[(k+1)%len(face)];ua,ub=uv[k],uv[(k+1)%len(face)]
                if a>b:a,b,ua,ub=b,a,ub,ua
                edges.setdefault((a,b),[]).append(np.array([ua,ub]))
        cd=[];hd=[]
        for pair in edges.values():
            if len(pair)!=2 or np.max(abs(pair[0]-pair[1]))<1e-6:continue
            t=np.linspace(.1,.9,9)[:,None]
            uv=[a[0]*(1-t)+a[1]*t for a in pair]
            cd.extend(np.max(abs(sample(colour,uv[0])-sample(colour,uv[1])),axis=1).tolist())
            hd.extend(abs(sample(hf,uv[0])-sample(hf,uv[1])).tolist())
        if cd:seams[name]=dict(samples=len(cd),colour_mean=round(float(np.mean(cd)),3),colour_p95=round(float(np.quantile(cd,.95)),3),height_mean_mm=round(float(np.mean(hd)),4))
    report['raster_uv_cuts']=seams
    # Underlying periodic fields close exactly, before pixel sampling.
    study=paint.Study();u=np.linspace(0,600,600,dtype=np.float32)
    closure={}
    for name,v in [('rope_plait',37.7),('rope_twist',18.85),('rope_wrap',100)]:
        a=study.sample(name,u,np.zeros_like(u),1)
        b=study.sample(name,u,np.full_like(u,v),1)
        closure[name]=float(abs(a-b).max())
        assert closure[name]<.001,(name,closure[name])
    report['study_girth_closure_max']=closure
    closure_wood={}
    for radius in (.016,.020):
        a=study.wood_cylinder(u,np.zeros_like(u),radius,1)
        b=study.wood_cylinder(u,np.ones_like(u),radius,1)
        closure_wood[str(radius)]=float(abs(a-b).max())
        assert closure_wood[str(radius)]<.001
    report['wood_girth_closure_max']=closure_wood
    a=study.wood_cylinder(u,np.zeros_like(u),.020,1,local_wrap=True)
    b=study.wood_cylinder(u,np.ones_like(u),.020,1,local_wrap=True)
    report['cantle_local_wrap_closure_max']=float(abs(a-b).max())
    assert report['cantle_local_wrap_closure_max']<.001

    # Audit the actual sampled field on the forward face, in physical axial /
    # circumferential coordinates, not atlas row/column directions. Endpoint
    # correction used to drag transverse stripes over this whole face.
    along,across=np.meshgrid(np.arange(5,245,dtype=np.float32),np.arange(-12,13,dtype=np.float32))
    wood=study.wood_cylinder(along.ravel(),across.ravel()/(40*np.pi),.020,1,local_wrap=True)
    wood=wood[:,:3].mean(-1).reshape(along.shape)
    axial=float(np.mean(abs(np.diff(wood,axis=1))))
    girth=float(np.mean(abs(np.diff(wood,axis=0))))
    report['cantle_forward_grain']={'axial_colour_change_per_mm':axial,'across_colour_change_per_mm':girth}
    assert girth>2*axial,'cantle fibres no longer follow the bow'

    # The director accepted every other piece. When the incoming delivery is
    # available locally, require exact preservation in every channel.
    before=CHECKS/'round1_before'
    if before.exists():
        allowed=np.isin(pieces,[p['number'] for p in meta['pieces'] if p['name'] in
            ('cantle','cantle_plate_out','cantle_plate_in','boss')])
        preserved={}
        for name,a in maps.items():
            b=np.asarray(Image.open(before/f'{MAT}_{name}.png'))
            diff=a!=b
            if diff.ndim==3:diff=diff.any(-1)
            assert not np.any(diff&~allowed),(name,'changed an accepted piece')
            preserved[name]=int(diff.sum())
        report['round1_changed_texels_only_in_four_pieces']=preserved

    spec=importlib.util.spec_from_file_location('compose',paint.PAINT/'compose.py')
    compose=importlib.util.module_from_spec(spec);spec.loader.exec_module(compose)
    n=compose.normal_from_height(height,mm,pieces)
    assert np.max(abs(np.linalg.norm(n[own],axis=-1)-1))<1e-5
    report['derived_normal_max_unit_error']=float(np.max(abs(np.linalg.norm(n[own],axis=-1)-1)))
    lin=compose.lin(maps['base'][...,:3]/255.)
    # Flat swatch previews: neutral and opposite raking light, using real mm
    # and exactly the height that compose will see. No normals are delivered.
    relief=[]
    for light in ([.45,-.30,.84],[-.45,.30,.84]):
        light=np.array(light);light/=np.linalg.norm(light)
        shade=.30+.70*np.maximum(0,np.sum(n*light,axis=-1))
        rel=compose.srgb(lin*shade[...,None]*(maps['occlusion'][...,None]/255.))
        relief.append(np.uint8(np.clip(np.rint(rel*255),0,255)))
    images=[maps['base'][...,:3],*relief]
    overview=Image.new('RGB',(1536,555),(35,35,35));draw=ImageDraw.Draw(overview)
    for i,(a,label) in enumerate(zip(images,['Delivered albedo, 50%','Relit from left, 50%','Relit from right, 50%'])):
        a=np.where(own[...,None],a,35).astype(np.uint8)
        im=Image.fromarray(a).resize((512,512),Image.Resampling.LANCZOS)
        overview.paste(im,(i*512,25));draw.text((i*512+8,8),label,fill='white')
    overview.save(CHECKS/'atlas_three_lights.png')
    # Pieces shown individually; nothing from another painter enters this sheet.
    sheet=Image.new('RGB',(1200,220*6),(32,32,32));draw=ImageDraw.Draw(sheet)
    for i,piece in enumerate(meta['pieces']):
        mask=pieces==piece['number'];x0,y0,x1,y1=piece['box']
        a=np.where(mask[...,None],relief[0],32).astype(np.uint8)
        im=Image.fromarray(a).crop((x0,y0,x1,y1));im.thumbnail((288,192),Image.Resampling.LANCZOS)
        xx=(i%4)*300;yy=(i//4)*220
        sheet.paste(im,(xx+(300-im.width)//2,yy+24+(192-im.height)//2))
        draw.text((xx+8,yy+6),f'{piece["name"]}  {piece["median_mm_a_texel"]:.2f} mm/px',fill='white')
    sheet.save(CHECKS/'all_pieces_relit.png')

    # Source, accepted study, and actual mapped pieces at 900 pixels/metre.
    # A piece uses its measured median density; no arbitrary feature enlargement.
    comparison=Image.new('RGB',(2400,1500),(35,35,35));draw=ImageDraw.Draw(comparison)
    for row,(original,material,piece_name) in enumerate([
        ('hide_supple','hide','seat_top'),('wood','wood','cantle'),('chitin_layers','chitin','cantle_plate_out')]):
        piece=next(a for a in meta['pieces'] if a['name']==piece_name)
        span=study.meta[material]['span_m'];side=round(span*900)
        original_im=Image.open(paint.STUDY/f'source/{original}_original.png').convert('RGB').resize((side,side),Image.Resampling.LANCZOS)
        accepted=Image.open(paint.STUDY/f'{material}_base.png').convert('RGB').resize((side,side),Image.Resampling.LANCZOS)
        mask=pieces==piece['number'];scale=piece['median_mm_a_texel']*.9
        local=[]
        for a in [maps['base'][...,:3],relief[0]]:
            a=np.where(mask[...,None],a,35).astype(np.uint8)
            im=Image.fromarray(a).crop(piece['box'])
            im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
            local.append(im)
        for col,(im,label) in enumerate(zip([original_im,accepted,*local],['Generated original','Accepted study','Painted albedo','Painted relief + AO'])):
            xx=col*600;yy=row*500
            comparison.paste(im,(xx+(600-im.width)//2,yy+35+(460-im.height)//2))
            draw.text((xx+10,yy+10),f'{material}: {label} / 900 px per metre',fill='white')
    comparison.save(CHECKS/'source_study_painted_900ppm.png')
    shots=['saddled_seat','saddled_rider','saddled_side','saddled_front']
    if all((CHECKS/f'look/{s}_design.png').exists() for s in shots):
        review=Image.new('RGB',(1200,940),(35,35,35));draw=ImageDraw.Draw(review)
        for i,s in enumerate(shots):
            im=Image.open(CHECKS/f'look/{s}_design.png').resize((600,450),Image.Resampling.LANCZOS)
            x=(i%2)*600;y=(i//2)*470
            review.paste(im,(x,y+20));draw.text((x+10,y+4),s.replace('_',' '),fill='white')
        review.save(CHECKS/'game_review.png')

    files=sorted(LAYERS.glob('*'))
    hashes={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
    if '--rebuild' in sys.argv:
        subprocess.run([sys.executable,str(HERE/'paint.py')],check=True)
        after={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
        assert hashes==after,'non-deterministic delivery'
        report['byte_identical_rebuild']=len(files)
    report['delivery_sha256']=hashes
    (CHECKS/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
