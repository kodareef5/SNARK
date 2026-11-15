#!/usr/bin/env python3
"""Independent file checks and CPU material diagnostics, not game captures.

Closed ellipsoid, two polar charts meeting below the equator, tangent-space
normal mapping, linear-light mip filtering, Lambert diffuse + small roughness
dependent specular. No silhouette foliage, shadows from other heads, or bloom.
"""
from pathlib import Path
import hashlib
import json
import math
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parent
CHECKS=ROOT/'checks'
REF=ROOT/'../../ref/concept/broadleaf'
RADIUS=240.64
LUMA=np.array([.2126,.7152,.0722])
HEIGHT_MM=240.


def font(n=16):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(path).exists():return ImageFont.truetype(path,n)
    return ImageFont.load_default()


def normalize(a):
    return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-9)


def linear(a):
    a=a/255.
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.clip(a,0,1)
    return np.rint(255*np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)).astype(np.uint8)


def resize(a,size):
    if a.ndim==2:return np.asarray(Image.fromarray(a.astype(np.float32)).resize(size,Image.Resampling.BOX))
    return np.stack([resize(a[...,k],size) for k in range(a.shape[-1])],-1)


def png_chunks(path):
    data=path.read_bytes();pos=8;out={}
    while pos<len(data):
        n=struct.unpack('>I',data[pos:pos+4])[0]
        kind=data[pos+4:pos+8].decode('ascii')
        out[kind]=data[pos+8:pos+8+n];pos+=n+12
    return out


def blade_core_scale(green, radius=200):
    """Scale audit of isolated bright cores; merged sprays remain outliers.

    This is explicitly NOT a semantic segmentation of every complete blade.
    No length threshold selects for the requested 11–17px result. Complete
    overlapping leaves may merge; bright face cores may be shorter than blades.
    """
    yy,xx=np.mgrid[:green.shape[0],:green.shape[1]]
    mask=(green-ndi.gaussian_filter(green,4)>12)
    if radius:
        mask &= np.hypot(xx-(green.shape[1]-1)/2,yy-(green.shape[0]-1)/2)<radius
    labels,_=ndi.label(mask);observations=[]
    for label,box in enumerate(ndi.find_objects(labels),1):
        if box is None:continue
        y,x=np.nonzero(labels[box]==label)
        if 12<=len(x)<=400:
            ev=np.linalg.eigvalsh(np.cov(np.stack([x,y])))
            if ev[0]<=0:continue
            length,width=4*np.sqrt(ev[::-1])
            if 1.35<length/width<4.5:observations.append([length,width])
    return dict(count=len(observations),length_width_p10_p50_p90_pixels=np.percentile(observations,[10,50,90],axis=0).tolist())


def feedback_sheet(renderer):
    """Declared manual registration of an opaque core, not a camera match."""
    path=ROOT/'feedback/round1_game_20m_detail.jpg'
    source=Image.open(path).convert('RGB')
    # The upper-left opaque head, from its leftmost to rightmost core edges.
    box=(72,80,356,290);core_span=(104,340);scale=50/(core_span[1]-core_span[0])
    crop=source.crop(box)
    game=crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.LANCZOS)
    sheet=Image.new('RGB',(1320,890),(25,31,32));d=ImageDraw.Draw(sheet)
    d.text((24,18),'GROUND VIEW  |  game feedback beside revised head material',font=font(25),fill=(229,233,213))
    d.text((24,56),'Opaque cores registered to 50 pixels wide; originals and identical 6× nearest-neighbour enlargements.',font=font(18),fill=(179,190,184))
    items=[('Round 1 / supplied game capture',game),
           ('Round 2 / underside 12',renderer.render(12,50,(.1,-.15,1),-70)),
           ('Round 2 / underside 13',renderer.render(13,50,(.1,-.15,1),-70))]
    for i,(label,im) in enumerate(items):
        x=24+i*432
        d.text((x,108),label,font=font(18),fill=(229,233,213))
        sheet.paste(im,(x,145))
        sheet.paste(im.resize((im.width*6,im.height*6),Image.Resampling.NEAREST),(x,225))
    marked=crop.copy();md=ImageDraw.Draw(marked)
    md.line((core_span[0]-box[0],185-box[1],core_span[1]-box[0],185-box[1]),fill=(255,220,100),width=2)
    sheet.paste(marked,(24,645))
    d.text((332,650),'Source crop: (72,80)–(356,290). Core span: x=104–340 (236px).',font=font(17),fill=(229,233,213))
    d.text((332,685),'The supplied capture is only cropped and resized; its lighting is unchanged.',font=font(17),fill=(179,190,184))
    d.text((332,720),'Revised heads use the existing -70° material test, ambient and overhead sun.',font=font(17),fill=(179,190,184))
    d.text((332,755),'No camera or light match is claimed. These are not new engine captures.',font=font(17),fill=(179,190,184))
    d.text((332,790),'Test shells omit cutout sprays to expose the painted underside.',font=font(17),fill=(179,190,184))
    sheet.save(CHECKS/'feedback_comparison.png')
    return dict(source=str(path.relative_to(ROOT)),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                crop_xyxy=box,opaque_core_span_x=core_span,scale=scale,core_width_pixels=50,
                note='Manual core-width registration only; not a camera/lighting match.')


def scale_sheet(base):
    """All populations and all four cards at one physical scale."""
    sheet=Image.new('RGB',(1480,1000),(25,31,32));d=ImageDraw.Draw(sheet)
    d.text((20,15),'SAME LEAVES, SAME SCALE  |  137.51 pixels/metre, enlarged 2.81×',font=font(25),fill=(229,233,213))
    d.text((20,53),'124px of head texture and one 0.9m spray card cover the same surface length. No sharpening.',font=font(18),fill=(179,190,184))
    for j,(idx,label) in enumerate([(0,'Sun head'),(5,'Middle head'),(10,'Shade head'),(12,'Underside')]):
        row,col=divmod(idx,4)
        crop=Image.fromarray(base[row*512+150:row*512+274,col*512+150:col*512+274])
        x=20+j*365
        sheet.paste(crop.resize((348,348),Image.Resampling.NEAREST),(x,100))
        d.text((x,465),f'{label} / cell {idx}',font=font(20),fill=(229,233,213))
    atlas=Image.open(ROOT/'../oak_leaves/oak_leaves_base.png').convert('RGBA')
    for i in range(4):
        # Sibling cells 0–3 occupy the top-left 2×2 quarter of its atlas.
        col=i%2;row=i//2
        card=atlas.crop((col*512,row*512,(col+1)*512,(row+1)*512))
        card=card.resize((124,124),Image.Resampling.LANCZOS)
        bg=Image.new('RGBA',card.size,(25,31,25,255));bg.alpha_composite(card)
        x=20+i*365
        sheet.paste(bg.convert('RGB').resize((348,348),Image.Resampling.NEAREST),(x,525))
        d.text((x,886),f'Existing spray {i} / 0.9m',font=font(20),fill=(229,233,213))
    # Both rows use exactly the same zoom (348 / 124).
    for j,mm in enumerate([80,100,120]):
        x=20+j*240;length=mm/(1750/RADIUS)*(348/124)
        d.line((x,945,x+length,945),fill=(225,220,140),width=3)
        d.text((x+60,934),f'{mm}mm',font=font(18),fill=(179,190,184))
    d.text((770,938),'Target: 80–120mm / 11.0–16.5 native texels.',font=font(19),fill=(229,233,213))
    sheet.save(CHECKS/'leaf_scale_and_card.png')


def edge_sheet(base):
    sheet=Image.new('RGB',(1260,1390),(25,31,32));d=ImageDraw.Draw(sheet)
    d.text((20,15),'CRISP THROUGH THE TURN  |  64px patches at 5×; no sharpening',font=font(25),fill=(229,233,213))
    for col,label in enumerate(['Interior (224,224)','Rim crossing (448,224)','Dark corner (8,8)']):
        d.text((100+col*390,57),label,font=font(20),fill=(229,233,213))
    for row,idx in enumerate([0,10,12,13]):
        y0=95+row*320
        d.text((15,y0+20),f'Cell {idx}',font=font(18),fill=(229,233,213))
        for col,(x,y) in enumerate([(224,224),(448,224),(8,8)]):
            patch=base[idx//4*512+y:idx//4*512+y+64,idx%4*512+x:idx%4*512+x+64]
            sheet.paste(Image.fromarray(patch).resize((320,320),Image.Resampling.NEAREST),(100+col*390,y0))
    sheet.save(CHECKS/'edge_detail.png')


class Renderer:
    def __init__(self,base,normal,orm,phone=False,tint=(1.,1.,1.)):
        self.charts={}
        for idx in range(14):
            row,col=divmod(idx,4);y=row*512;x=col*512
            b=linear(base[y:y+512,x:x+512].astype(float))*np.array(tint)
            n=normal[y:y+512,x:x+512].astype(float)/127.5-1
            o=orm[y//2:y//2+256,x//2:x//2+256].astype(float)/255
            o=resize(o,(512,512))
            material=np.concatenate([b,n,o[...,:2]],axis=-1)
            if phone:material=resize(material,(256,256))
            levels=[material]
            while levels[-1].shape[0]>1:
                a=levels[-1];h,w=a.shape[:2]
                levels.append(a.reshape(h//2,2,w//2,2,8).mean((1,3)))
            self.charts[idx]=levels

    def sample(self,idx,u,v,lod):
        levels=self.charts[idx];s=levels[0].shape[0]
        lod=np.clip(lod+math.log2(s/512),0,len(levels)-1)
        lo=np.floor(lod).astype(int);frac=lod-lo
        out=np.zeros((*u.shape,8))
        for delta in [0,1]:
            k=np.minimum(lo+delta,len(levels)-1)
            for level in np.unique(k):
                mask=k==level;a=levels[level];scale=a.shape[0]/512
                coords=[(v[mask]+.5)*scale-.5,(u[mask]+.5)*scale-.5]
                vals=np.stack([ndi.map_coordinates(a[...,c],coords,order=1,mode='nearest') for c in range(8)],-1)
                weight=frac[mask] if delta else 1-frac[mask]
                out[mask]+=vals*weight[:,None]
        return out

    def render(self,index,diameter=50,light=(.1,-.1,1),elevation=35,rotation=0,ss=4):
        size=diameter+12;count=size*ss
        yy,xx=np.mgrid[:count,:count].astype(float)
        x=(xx+.5-count/2)*2.2/(diameter*ss)
        y=-(yy+.5-count/2)*2.2/(diameter*ss)
        el=np.deg2rad(elevation)
        view=np.array([0,-np.cos(el),np.sin(el)])
        right=np.array([1,0,0]);up=np.cross(view,right)
        axes=np.array([1.1,1.1,.76])
        origin=x[...,None]*right+y[...,None]*up
        aa=np.sum((view/axes)**2)
        bb=np.sum(origin*view/axes**2,axis=-1)
        cc=np.sum((origin/axes)**2,axis=-1)-1
        disc=bb*bb-aa*cc;valid=disc>=0
        t=(-bb+np.sqrt(np.maximum(0,disc)))/aa
        p=origin+t[...,None]*view
        nmesh=normalize(p/axes**2)
        param=p/axes
        theta=np.arccos(np.clip(param[...,2],-1,1))
        top=theta<=1.75
        sign=np.where(top,1.,-1.)
        beta=np.where(top,theta,np.pi-theta)
        phi=np.arctan2(sign*param[...,1],param[...,0])-np.deg2rad(rotation)
        cap=np.where(top,1.75,np.pi-1.75)
        rr=beta/cap*RADIUS
        u=255.5+rr*np.cos(phi);v=255.5-rr*np.sin(phi)
        # Per-pixel UV footprint; average materials in linear light first.
        uy,ux=np.gradient(u);vy,vx=np.gradient(v)
        # Each supersample integrates its OWN footprint. Multiplying by ss
        # here would apply the full-pixel box once per subsample and blur twice.
        footprint=np.maximum(np.hypot(ux,vx),np.hypot(uy,vy))
        lod=np.log2(np.maximum(footprint,1))
        upper=min(index,11);lower=12+(index%2)
        if index>=12:lower=index;upper=8+(index-12)
        mat=self.sample(upper,u,v,lod)
        bot=self.sample(lower,u,v,lod)
        mat=np.where(top[...,None],mat,bot)
        # Derivative of the two polar chart surfaces, then rotate back into
        # world space. B = N cross T implements image row-down / tangent Y-up.
        phi_world=phi+np.deg2rad(rotation)
        dtheta=np.stack([np.cos(beta)*np.cos(phi_world),
                        sign*np.cos(beta)*np.sin(phi_world),-sign*np.sin(beta)],-1)*axes
        dphi=np.stack([-np.sin(beta)*np.sin(phi_world),
                      sign*np.sin(beta)*np.cos(phi_world),np.zeros_like(beta)],-1)*axes
        tangent=dtheta*np.cos(phi)[...,None]-dphi*(np.sin(phi)/np.maximum(beta,.00001))[...,None]
        tangent=normalize(tangent-nmesh*np.sum(tangent*nmesh,axis=-1,keepdims=True))
        bitangent=np.cross(nmesh,tangent)
        tn=normalize(mat[...,3:6])
        normal=normalize(tangent*tn[...,0,None]+bitangent*tn[...,1,None]+nmesh*tn[...,2,None])
        sun=normalize(np.array(light,float));ndotl=np.maximum(0,np.sum(normal*sun,axis=-1))
        # Prevent detail normals shining through the reverse of the shell.
        direct_gate=np.clip(np.sum(nmesh*sun,axis=-1)*6,0,1)
        ao=mat[...,6];rough=mat[...,7]
        ambient=.30+.10*np.maximum(nmesh[...,2],0)
        diffuse=ambient*ao+.86*ndotl*direct_gate
        half=normalize(sun+view)
        ndoth=np.maximum(0,np.sum(normal*half,axis=-1))
        spec=.018*(1-rough)*ndoth**(2+25*(1-rough))*direct_gate
        lit=mat[...,:3]*diffuse[...,None]+spec[...,None]
        background=linear(np.array([178,197,211],float))
        lit=np.where(valid[...,None],lit,background)
        lit=lit.reshape(size,ss,size,ss,3).mean((1,3))
        return Image.fromarray(srgb(lit))


def purpose_sheet(renderer,phone=False):
    sheet=Image.new('RGB',(1580,1020),(25,31,32));d=ImageDraw.Draw(sheet)
    title='HALF-SIZE PHONE ATLAS' if phone else 'FULL-SIZE ATLAS'
    d.text((24,17),'LIVE OAK HEADS  |  '+title,font=font(24),fill=(229,233,213))
    d.text((24,52),'Closed 2.2 m head • 35° view • actual pixel sizes and nearest-neighbour enlargements',font=font(16),fill=(179,190,184))
    concept=Image.open(REF/'oak_lineup.png').convert('RGB')
    # Whole middle elder, unchanged apart from this declared crop/resize.
    crop=concept.crop((int(concept.width*.25),0,int(concept.width*.68),int(concept.height*.90)))
    crop.thumbnail((480,390),Image.Resampling.LANCZOS);sheet.paste(crop,(1068,100))
    d.text((1068,505),'Project concept: middle elder oak',font=font(18),fill=(229,233,213))
    d.text((1068,535),'Art reference; no camera/scale registration.',font=font(15),fill=(179,190,184))
    for r,(label,idx) in enumerate([('Sun / cell 0',0),('Middle / cell 5',5),('Shade / cell 10',10)]):
        y0=90+r*300
        d.text((24,y0),label,font=font(21),fill=(229,233,213))
        for j,(lightname,light) in enumerate([('Above',(.1,-.15,1)),('Side',(-1,-.15,.2))]):
            x0=24+j*510
            d.text((x0,y0+32),lightname,font=font(17),fill=(179,190,184))
            for k,size in enumerate([50,25,12]):
                x=x0+k*165
                im=renderer.render(idx,size,light)
                im.save(CHECKS/f'{"phone_" if phone else ""}head_{idx}_{size}_{lightname.lower()}.png')
                sheet.paste(im,(x,y0+62))
                zoom=im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST)
                if k==0:zoom=im.resize((im.width*2,im.height*2),Image.Resampling.NEAREST)
                sheet.paste(zoom,(x,y0+132))
                d.text((x,y0+272),f'{size}px  /  {2 if k==0 else 3}×',font=font(15),fill=(179,190,184))
    d.text((1068,610),'Material diagnostic, not an engine capture.',font=font(16),fill=(229,233,213))
    d.text((1068,640),'Linear mip filtering; geometric + detail normals.',font=font(15),fill=(179,190,184))
    d.text((1068,670),'Same exposure and background for both lights.',font=font(15),fill=(179,190,184))
    d.text((1068,700),'Rim cards are omitted to expose the material.',font=font(15),fill=(179,190,184))
    sheet.save(CHECKS/('purpose_phone.png' if phone else 'purpose_distance.png'))


def round3_checks(paths,base,layout,require):
    """Reconstruct accepted art, verify its frozen hash, then audit the grade."""
    from build_material import source_regions, material
    baseline=json.loads((ROOT/'source/round3_baseline.json').read_text())
    sha=lambda value:hashlib.sha256(value).hexdigest()
    for key in ['height','normal','orm']:
        require('round 3 '+key+' file byte-identical to round 2',
                sha(paths[key].read_bytes())==baseline['maps'][key]['file_sha256'])
    require('round 3 shade, undersides and interior pixels unchanged',
            sha(base[1024:].tobytes())==baseline['maps']['base']['protected_rows_pixel_sha256'])
    for name in ['top_heads_generated.png','undersides_generated.png','interior_generated.png',
                 'spray_reference.png','interior_quilt.json','originals.json']:
        key='source/'+name
        require('round 3 unchanged '+key,sha((ROOT/key).read_bytes())==baseline['files'][key])
    require('round 3 chart geometry and relief metadata unchanged',
            len(layout['regions'])==len(baseline['layout']['regions']) and
            all(all(reg[k]==old[k] for k in old if k!='mean_rgb')
                for reg,old in zip(layout['regions'],baseline['layout']['regions'])) and
            all(layout[k]==baseline['layout'][k] for k in
                ['radius_pixels','disc_surface_radius_mm','height_range_mm']))
    accepted=np.zeros_like(base)
    raw_regions,_=source_regions()
    for x,y,w,h,raw,group,periodic in raw_regions:
        accepted[y:y+h,x:x+w]=np.rint(material(raw,group,periodic)['rgb']).astype(np.uint8)
    require('round 3 reconstructed round-2 artwork matches frozen pixel hash',
            sha(accepted.tobytes())==baseline['maps']['base']['pixel_sha256'])
    yy,xx=np.mgrid[:512,:512];radial=np.hypot(xx-255.5,yy-255.5)/RADIUS
    mask=radial<=1;core=radial<.65
    bands=np.minimum((radial*16).astype(int),24)
    def measure(a):
        lum=np.sum(a*LUMA,axis=-1)
        bright=mask & (lum>=np.percentile(lum[mask],90))
        profile=np.array([lum[bands==i].mean() if np.any(bands==i) else 0 for i in range(25)])
        residual=lum-profile[bands];contrast={}
        for size in [50,25,12]:
            mm=resize((radial<.85).astype(float),(size,size))>.99
            contrast[str(size)]=float(np.std(resize(residual,(size,size))[mm]))
        return dict(mean_rgb=a[mask].mean(0).tolist(),brightest_tenth_mean_rgb=a[bright].mean(0).tolist(),
                    dark_gap_p05_srgb=float(np.percentile(lum[mask],5)),
                    face_gap_p90_p10_srgb=float(np.diff(np.percentile(lum[core],[10,90]))[0]),
                    fold_residual_std_srgb=contrast)
    comparisons=[]
    for idx in range(8):
        row,col=divmod(idx,4);sl=np.s_[row*512:(row+1)*512,col*512:(col+1)*512]
        old=accepted[sl];new=base[sl];deep=np.sum(old*LUMA,axis=-1)<=45
        frozen=baseline['regions'][idx]
        require(f'round 3 cell {idx} deep folds byte-identical',
                sha(deep.tobytes())==frozen['deep_fold_mask_sha256'] and
                sha(new[deep].tobytes())==frozen['deep_fold_rgb_sha256'])
        require(f'round 3 cell {idx} only brightens pigment',np.all(new>=old))
        # Equal source channel values must stay equal, with monotonic ordering:
        # a spatial edit, blur, new leaf, or changed silhouette fails this test.
        monotonic=True
        for c in range(3):
            pairs=np.unique(np.stack([old[...,c].ravel(),new[...,c].ravel()],axis=1),axis=0)
            monotonic &= len(pairs)==len(np.unique(old[...,c])) and np.all(np.diff(pairs[:,1].astype(int))>=0)
        require(f'round 3 cell {idx} leaf drawing preserved by monotonic colour-only mapping',monotonic)
        before=measure(old);after=measure(new)
        ratios={size:after['fold_residual_std_srgb'][size]/before['fold_residual_std_srgb'][size]
                for size in ['50','25','12']}
        require(f'round 3 cell {idx} retains at least 90 percent of distant fold contrast',min(ratios.values())>=.90)
        require(f'round 3 cell {idx} face/gap separation retained',
                after['face_gap_p90_p10_srgb']>=before['face_gap_p90_p10_srgb']*.95)
        if row==0:
            require(f'round 3 cell {idx} bright leaf faces near 180 178 90',
                    np.max(np.abs(np.array(after['brightest_tenth_mean_rgb'])-[180,178,90]))<2)
        comparisons.append(dict(cell=idx,before=before,after=after,fold_contrast_ratio=ratios,
                                protected_deep_fold_pixels=int(deep.sum())))
    return accepted,dict(baseline='source/round3_baseline.json',cells=comparisons,
                         engine_tint_linear=[.96,1.,.72],engine_tint_baked_in=False)


def round3_sheet(before,after,normal,orm):
    """Identical patches and fixed-exposure renders, with engine tint once."""
    tint=(.96,1.,.72)
    renderers=[Renderer(b,normal,orm,tint=tint) for b in [before,after]]
    sheet=Image.new('RGB',(1440,1280),(25,31,32));d=ImageDraw.Draw(sheet)
    fg=(229,233,213);muted=(179,190,184)
    d.text((24,16),'ROUND 3  |  brighter sun faces, the same leaves and dark folds',font=font(26),fill=fg)
    d.text((24,56),'Top: unlit texture patches, 128px enlarged 2×. Bottom: material renders with the game tint applied once.',font=font(18),fill=muted)
    for group,(idx,label) in enumerate([(0,'Sun / cell 0'),(5,'Middle / cell 5')]):
        x0=24+group*710;row,col=divmod(idx,4)
        for version,a in enumerate([before,after]):
            x=x0+version*340
            d.text((x,100),f'{label} / round {2+version}',font=font(19),fill=fg)
            patch=a[row*512+150:row*512+278,col*512+150:col*512+278]
            sheet.paste(Image.fromarray(patch).resize((256,256),Image.Resampling.NEAREST),(x,138))
        d.text((x0,416),'50px (2×)                 25px (3×)             12px (4×)',font=font(18),fill=fg)
        for light_idx,(name,light) in enumerate([('Above',(.1,-.15,1)),('Side',(-1,-.15,.2))]):
            for version,renderer in enumerate(renderers):
                y=465+(light_idx*2+version)*175
                d.text((x0,y),f'{name} / round {2+version}',font=font(18),fill=muted)
                for xoff,size,zoom in [(0,50,2),(235,25,3),(440,12,4)]:
                    im=renderer.render(idx,size,light)
                    sheet.paste(im.resize((im.width*zoom,im.height*zoom),Image.Resampling.NEAREST),(x0+xoff,y+30))
    d.text((24,1188),'Tint = linear RGB (0.96, 1.00, 0.72), before lighting; it is not baked into the delivered sRGB atlas.',font=font(19),fill=fg)
    d.text((24,1225),'Same geometry, normals, AO, roughness, light and exposure. CPU diagnostics, not new game captures.',font=font(18),fill=muted)
    sheet.save(CHECKS/'round3_colour_comparison.png')


def main():
    CHECKS.mkdir(exist_ok=True)
    paths={k:ROOT/f'oak_crown_{k}.png' for k in ['base','height','normal','orm']}
    images={k:Image.open(p) for k,p in paths.items()}
    a={k:np.asarray(im) for k,im in images.items()}
    tests=[]
    def require(name,value):
        tests.append(dict(name=name,pass_=bool(value)))
        if not value:print('FAIL:',name)
    for k in paths:
        require(k+' size',images[k].size==((1024,1024) if k=='orm' else (2048,2048)))
        ihdr=png_chunks(paths[k])['IHDR']
        require(k+' bit depth',ihdr[8]==(16 if k=='height' else 8))
        require(k+' colour type',ihdr[9]==(0 if k=='height' else 2))
    require('base sRGB tag', 'sRGB' in png_chunks(paths['base']))
    for k in ['height','normal','orm']:require(k+' linear interpretation','sRGB' not in png_chunks(paths[k]))
    require('metalness zero',np.count_nonzero(a['orm'][...,2])==0)
    require('sun bright pigment ceiling',np.all(a['base'][:512]<=np.array([180,178,90])))
    require('other rows retain accepted pigment ceiling',np.all(a['base'][512:]<=np.array([165,160,85])))
    h=a['height'].astype(float)*HEIGHT_MM/65535
    n=normalize(a['normal'].astype(float)/127.5-1)
    layout=json.loads((ROOT/'source/layout.json').read_text())
    baseline=json.loads((ROOT/'source/round2_baseline.json').read_text())
    for key in a:
        tile=a[key][768:1024,512:1024] if key=='orm' else a[key][1536:2048,1024:2048]
        require(key+' accepted interior pixels unchanged',hashlib.sha256(tile.tobytes()).hexdigest()==
                baseline['maps'][key]['interior_pixel_sha256'])
    require('accepted layout and physical pitches unchanged',
        all(all(reg[k]==old[k] for k in ['index','group','xywh','periodic','pitch_mm'])
            for reg,old in zip(layout['regions'],baseline['layout']['regions'])))
    require('round 3 sun and middle population targets',layout['targets'][:2]==[[140,146,72],[108,120,64]])
    require('protected population targets unchanged',layout['targets'][2:]==baseline['layout']['targets'][2:])
    require('no blue shadow population',np.all(a['base'][...,2]<=a['base'][...,1]))
    accepted,round3=round3_checks(paths,a['base'],layout,require)
    round3_sheet(accepted,a['base'],a['normal'],a['orm'])
    regions=[]
    yy,xx=np.mgrid[:512,:512]
    radial=np.hypot(xx-255.5,yy-255.5)/RADIUS
    for reg in layout['regions']:
        x,y,w,hh=reg['xywh'];sl=np.s_[y:y+hh,x:x+w]
        mask=np.ones((hh,w),bool) if reg['periodic'] else radial<=1
        z=h[sl];pitch=reg['pitch_mm']
        if reg['periodic']:
            dx=(np.roll(z,-1,1)-np.roll(z,1,1))/(2*pitch)
            dy=(np.roll(z,-1,0)-np.roll(z,1,0))/(2*pitch)
        else:
            dx=np.empty_like(z);dy=np.empty_like(z)
            dx[:,1:-1]=(z[:,2:]-z[:,:-2])/(2*pitch)
            dx[:,0]=(z[:,1]-z[:,0])/pitch;dx[:,-1]=(z[:,-1]-z[:,-2])/pitch
            dy[1:-1]=(z[2:]-z[:-2])/(2*pitch)
            dy[0]=(z[1]-z[0])/pitch;dy[-1]=(z[-1]-z[-2])/pitch
        expect=normalize(np.stack([-dx,dy,np.ones_like(z)],-1))
        error=np.degrees(np.arccos(np.clip(np.sum(expect*n[sl],axis=-1),-1,1)))
        require(f'cell {reg["index"]} normal/height agreement',np.max(error)<.40)
        mean=a['base'][sl][mask].mean(0)
        target=layout['targets'][reg['group']]
        require(f'cell {reg["index"]} mean pigment',np.max(np.abs(mean-target))<.05)
        orm=a['orm'][y//2:(y+hh)//2,x//2:(x+w)//2]/255.
        record=dict(index=reg['index'],mean_rgb=mean.tolist(),normal_error_max_deg=float(error.max()),
            normal_error_p99_deg=float(np.percentile(error,99)),height_mm=[float(z.min()),float(z.max())],
            ao_percentiles=np.percentile(orm[...,0],[0,10,50,90,100]).tolist(),
            roughness_percentiles=np.percentile(orm[...,1],[0,50,100]).tolist())
        if not reg['periodic']:
            col=a['base'][sl].astype(float);lum=np.sum(col*LUMA,axis=-1)
            core=radial<.65;ring=(radial>.96)&(radial<1);outside=radial>1.05
            require(f'cell {reg["index"]} edge darkens',lum[ring].mean()<lum[core].mean())
            require(f'cell {reg["index"]} dark filled gutter',lum[outside].mean()<lum[core].mean())
            # Residual coarse contrast after subtracting the circular profile.
            bands=np.minimum((radial*16).astype(int),24)
            profile=np.array([lum[bands==i].mean() if np.any(bands==i) else 0 for i in range(25)])
            residual=lum-profile[bands]
            contrast={}
            for size in [50,25,12]:
                small=resize(residual,(size,size));mm=resize((radial<.85).astype(float),(size,size))>.99
                contrast[str(size)]=float(np.std(small[mm]))
            record['fold_residual_std_srgb']=contrast
            require(f'cell {reg["index"]} nonradial folds survive 12px',contrast['12']>1.5)
            record['blade_core_scale_proxy']=blade_core_scale(col[...,1])
            proxy=record['blade_core_scale_proxy']
            require(f'cell {reg["index"]} larger blade cores',
                    proxy['count']>=40 and 8<proxy['length_width_p10_p50_p90_pixels'][1][0]<22)
            facegap=float(np.percentile(lum[core],90)-np.percentile(lum[core],10))
            record['face_gap_p90_p10_srgb']=facegap
            require(f'cell {reg["index"]} face/gap separation',facegap>35)
            record['dark_gap_p05_srgb']=float(np.percentile(lum[mask],5))
            require(f'cell {reg["index"]} dark green gaps',record['dark_gap_p05_srgb']<55)
            highpass=lum-ndi.gaussian_filter(lum,2)
            sharp={name:float(np.std(highpass[m])) for name,m in
                   [('core',core),('ring',ring),('outside',outside)]}
            record['leaf_detail_std_srgb']=sharp
            require(f'cell {reg["index"]} crisp rim and corner detail',
                    min(sharp['ring'],sharp['outside'])>2 and
                    min(sharp['ring'],sharp['outside'])/max(sharp['core'],.01)>.20)
        regions.append(record)
    # Four independently composed neighbours per row, after removing the ring.
    correlations=[]
    for row in range(3):
        cuts=[]
        for col in range(4):
            lum=np.sum(a['base'][row*512:(row+1)*512,col*512:(col+1)*512]*LUMA,axis=-1)
            lum=ndi.gaussian_filter(lum,3)
            cuts.append(lum[radial<.80])
        corr=np.corrcoef(cuts)
        maximum=float(np.max(corr[np.triu_indices(4,1)]))
        correlations.append(maximum)
        require(f'row {row+1} distinct neighbouring heads',maximum<.85)
    require('undersides rougher than sun tops',min(r['roughness_percentiles'][1] for r in regions[12:14])>
            max(r['roughness_percentiles'][1] for r in regions[:4])+.25)
    # Periodic tile boundaries, compared with ordinary adjacent-pixel changes.
    seams={}
    for key in a:
        tile=a[key][768:1024,512:1024] if key=='orm' else a[key][1536:2048,1024:2048]
        tile=tile.astype(float)
        if key=='height':tile=tile[...,None]
        pairs=[]
        for axis in [1,0]:
            edge=np.mean(np.abs(np.take(tile,0,axis)-np.take(tile,-1,axis)))
            typical=np.mean(np.abs(np.diff(tile,axis=axis)))
            pairs.append(float(edge/max(typical,1e-5)))
        seams[key]=dict(horizontal_ratio=pairs[0],vertical_ratio=pairs[1])
        require(key+' periodic seam energy',max(pairs)<2.0)
    renderer=Renderer(a['base'],a['normal'],a['orm'])
    feedback=feedback_sheet(renderer)
    scale_sheet(a['base'])
    edge_sheet(a['base'])
    purpose_sheet(renderer)
    phone=Renderer(a['base'],a['normal'],a['orm'],True)
    purpose_sheet(phone,True)
    phone_errors=[]
    for idx in [0,5,10]:
        for size in [50,25,12]:
            for lightname in ['above','side']:
                name=f'head_{idx}_{size}_{lightname}.png'
                full=np.asarray(Image.open(CHECKS/name),float)
                mobile=np.asarray(Image.open(CHECKS/('phone_'+name)),float)
                delta=np.abs(full-mobile)
                phone_errors.append(dict(cell=idx,diameter=size,light=lightname,mean_abs_code_error=float(delta.mean()),max_code_error=float(delta.max())))
                require(f'phone cell {idx} {size}px {lightname} retention',delta.mean()<1.0)
    for idx in [12,13]:
        for size in [50,25,12]:
            for lightname,light in [('above',(.1,-.15,1)),('side',(-1,-.15,.2))]:
                full=np.asarray(renderer.render(idx,size,light,-70),float)
                mobile=np.asarray(phone.render(idx,size,light,-70),float)
                delta=np.abs(full-mobile)
                phone_errors.append(dict(cell=idx,diameter=size,light=lightname,elevation=-70,
                    mean_abs_code_error=float(delta.mean()),max_code_error=float(delta.max())))
                require(f'phone underside {idx} {size}px {lightname} retention',delta.mean()<1.0)
    under=Image.new('RGB',(1300,750),(25,31,32));d=ImageDraw.Draw(under)
    d.text((20,16),'UNDERSIDES  |  70° upward view, same ambient and overhead sun',font=font(24),fill=(229,233,213))
    for i in range(2):
        x0=20+i*640
        im=renderer.render(12+i,256,(.1,-.15,1),-70,ss=2)
        under.paste(im,(x0,62))
        raw=Image.fromarray(a['base'][1536:2048,i*512:(i+1)*512]).resize((300,300))
        under.paste(raw,(x0+300,62))
        d.text((x0,370),'Lit closed head',font=font(17),fill=(179,190,184))
        d.text((x0+300,370),'Unlit underside chart',font=font(17),fill=(179,190,184))
        for j,size in enumerate([50,25,12]):
            im=renderer.render(12+i,size,(.1,-.15,1),-70)
            under.paste(im,(x0+j*195,420))
            under.paste(im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST),(x0+j*195,495))
            d.text((x0+j*195,700),f'{size}px / 3×',font=font(16),fill=(179,190,184))
    under.save(CHECKS/'undersides.png')
    # Rotation and all-variant review. Camera/sun fixed while chart rotates.
    sheet=Image.new('RGB',(1250,1110),(25,31,32));d=ImageDraw.Draw(sheet)
    d.text((20,12),'ALL HEADS  |  upper view, side light, 96px diameter',font=font(24),fill=(229,233,213))
    for i in range(14):
        row,col=divmod(i,4);x0=20+col*308;y0=60+row*260
        for rot in [0,90]:
            im=renderer.render(i,96,(-1,-.15,.3),60 if i<12 else -65,rot,ss=2)
            sheet.paste(im,(x0+(0 if rot==0 else 140),y0))
        d.text((x0,y0+120),f'Cell {i}  /  0° and 90°',font=font(16),fill=(179,190,184))
        raw=Image.fromarray(a['base'][(i//4)*512:(i//4+1)*512,(i%4)*512:(i%4+1)*512])
        raw=raw.resize((112,112),Image.Resampling.LANCZOS);sheet.paste(raw,(x0,y0+145))
    sheet.save(CHECKS/'all_heads.png')
    tile=a['base'][1536:2048,1024:2048]
    Image.fromarray(np.tile(tile,(2,2,1))).save(CHECKS/'interior_tiled_2x2.png')
    Image.fromarray(np.roll(tile,(256,512),(0,1))).save(CHECKS/'interior_offset.png')
    Image.fromarray(a['base']).resize((1024,1024),Image.Resampling.LANCZOS).save(CHECKS/'atlas_preview.png')
    layers=Image.new('RGB',(1200,1270),(25,31,32));d=ImageDraw.Draw(layers)
    for i,key in enumerate(['base','normal','height','orm']):
        col=i%2;row=i//2;im=images[key]
        if key=='height':im=Image.fromarray((a[key]/257).astype(np.uint8)).convert('RGB')
        im=im.resize((580,580),Image.Resampling.LANCZOS)
        layers.paste(im,(10+col*600,40+row*630));d.text((10+col*600,10+row*630),key,font=font(20),fill=(229,233,213))
    layers.save(CHECKS/'layers.jpg',quality=94)
    # Enlarged, unsharpened native-pixel patches with rulers for visual audit.
    detail=Image.new('RGB',(1420,1030),(25,31,32));d=ImageDraw.Draw(detail)
    d.text((20,12),'NATIVE LEAF DETAIL  |  64px patches enlarged 6×, no sharpening',font=font(24),fill=(229,233,213))
    for i,idx in enumerate([0,5,10,12,13,14]):
        if idx<14:
            row,col=divmod(idx,4);x=col*512+150;y=row*512+150;pitch=1750/RADIUS
        else:x=1300;y=1700;pitch=4800/1024
        crop=a['base'][y:y+64,x:x+64]
        x0=20+(i%3)*470;y0=60+(i//3)*470
        detail.paste(Image.fromarray(crop).resize((384,384),Image.Resampling.NEAREST),(x0,y0))
        d.text((x0,y0+395),f'Cell {idx} / {pitch:.3f} mm per texel',font=font(17),fill=(229,233,213))
        for j,mm in enumerate([80,120] if idx<14 else [30,50]):
            xx=x0+j*190;yy=y0+435
            d.line((xx,yy,xx+mm/pitch*6,yy),fill=(225,220,140),width=3)
            d.text((xx+110,yy-10),f'{mm}mm',font=font(15),fill=(179,190,184))
    detail.save(CHECKS/'leaf_detail.png')
    stats=dict(tests=tests,passed=sum(t['pass_'] for t in tests),total=len(tests),regions=regions,seams=seams,
        neighbour_max_correlations=correlations,phone_comparison=phone_errors,feedback_registration=feedback,round3=round3,
        leaf_scale=dict(target_mm=[80,120],target_native_pixels=[80/(1750/RADIUS),120/(1750/RADIUS)],
            method='Visual same-physical-scale card comparison and native rulers; bright-core proxy is not full-blade segmentation.'),
        height_range_mm=[0,240],observed_height_mm=[float(h.min()),float(h.max())],
        brown_pixel_fraction=float(np.mean((a['base'][...,0]>a['base'][...,1]*1.10)&(a['base'][...,0]>75))),
        render=dict(kind='CPU material diagnostic; not game capture',geometry='closed 2.2m x 2.2m x 1.52m ellipsoid',
        seam_polar_angle_radians=1.75,top_camera_elevation_degrees=35,underside_elevation_degrees=-70,
        lighting=['overhead (0.1,-0.15,1)','side (-1,-0.15,0.2)'],
        filtering='linear-light colour box mips; linear normal/ORM mips; trilinear sample; 4x pixel supersampling'),
        hashes={k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in paths.items()})
    (CHECKS/'metrics.json').write_text(json.dumps(stats,indent=2)+'\n')
    print(f'{stats["passed"]}/{stats["total"]} checks passed')
    print('Normal maximum error:',max(r['normal_error_max_deg'] for r in regions))
    print('Seams:',seams)
    if stats['passed']!=stats['total']:raise SystemExit(1)


if __name__=='__main__':main()
