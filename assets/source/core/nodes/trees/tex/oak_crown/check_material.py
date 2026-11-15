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
    No length threshold selects for the requested 4–7px result.
    """
    yy,xx=np.mgrid[:green.shape[0],:green.shape[1]]
    mask=(green-ndi.gaussian_filter(green,2.3)>10)
    if radius:
        mask &= np.hypot(xx-(green.shape[1]-1)/2,yy-(green.shape[0]-1)/2)<radius
    labels,_=ndi.label(mask);observations=[]
    for label,box in enumerate(ndi.find_objects(labels),1):
        if box is None:continue
        y,x=np.nonzero(labels[box]==label)
        if 4<=len(x)<=60:
            ev=np.linalg.eigvalsh(np.cov(np.stack([x,y])))
            if ev[0]<=0:continue
            length,width=4*np.sqrt(ev[::-1])
            if 1.35<length/width<4.5:observations.append([length,width])
    return dict(count=len(observations),length_width_p10_p50_p90_pixels=np.percentile(observations,[10,50,90],axis=0).tolist())


class Renderer:
    def __init__(self,base,normal,orm,phone=False):
        self.charts={}
        for idx in range(14):
            row,col=divmod(idx,4);y=row*512;x=col*512
            b=linear(base[y:y+512,x:x+512].astype(float))
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
    require('bright pigment ceiling',np.all(a['base']<=np.array([165,160,85])))
    h=a['height'].astype(float)*HEIGHT_MM/65535
    n=normalize(a['normal'].astype(float)/127.5-1)
    layout=json.loads((ROOT/'source/layout.json').read_text())
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
    # Calibrated comparison with the existing card's actual authored dimensions.
    comparison=Image.new('RGB',(1300,700),(25,31,32));d=ImageDraw.Draw(comparison)
    d.text((20,15),'BOTANICAL SCALE  |  138 pixels / metre',font=font(24),fill=(229,233,213))
    card=Image.open(ROOT/'../oak_leaves/oak_leaves_base.png').convert('RGBA').crop((0,0,512,512))
    card=card.resize((124,124),Image.Resampling.LANCZOS)
    for i,idx in enumerate([0,5]):
        row,col=divmod(idx,4);crop=a['base'][row*512+156:row*512+356,col*512+156:col*512+356]
        comparison.paste(Image.fromarray(crop).resize((400,400),Image.Resampling.NEAREST),(20+i*440,60))
    bg=Image.new('RGBA',card.size,(90,100,83,255));bg.alpha_composite(card)
    comparison.paste(bg.convert('RGB').resize((248,248),Image.Resampling.NEAREST),(960,80))
    d.text((20,480),'Sun head / 200px crop at 2×',font=font(18),fill=(229,233,213))
    d.text((460,480),'Middle head / same scale',font=font(18),fill=(229,233,213))
    d.text((920,355),'Existing 0.9m card / 2×',font=font(17),fill=(229,233,213))
    d.text((20,540),'The existing card builder records 80–120mm blades. This crown brief requests 30–50mm blades.',font=font(18),fill=(229,233,213))
    d.text((20,580),'Both are shown at the SAME physical scale; the crown follows the brief. The sibling card is unchanged.',font=font(17),fill=(179,190,184))
    # Reference ruler: upper/middle discs are 240.64px / 1.75m.
    for j,mm in enumerate([30,40,50,100]):
        x=20+j*210;length=mm/(1750/RADIUS)*2
        d.line((x,635,x+length,635),fill=(225,220,140),width=3)
        d.text((x,650),f'{mm}mm',font=font(16),fill=(179,190,184))
    comparison.save(CHECKS/'leaf_scale_and_card.png')
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
        for j,mm in enumerate([30,50]):
            xx=x0+j*190;yy=y0+435
            d.line((xx,yy,xx+mm/pitch*6,yy),fill=(225,220,140),width=3)
            d.text((xx+50,yy-10),f'{mm}mm',font=font(15),fill=(179,190,184))
    detail.save(CHECKS/'leaf_detail.png')
    stats=dict(tests=tests,passed=sum(t['pass_'] for t in tests),total=len(tests),regions=regions,seams=seams,
        neighbour_max_correlations=correlations,phone_comparison=phone_errors,
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
