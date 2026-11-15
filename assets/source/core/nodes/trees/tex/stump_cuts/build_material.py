#!/usr/bin/env python3
"""Rebuild the four stump material maps from frozen original imagegen plates.

Only reads/writes this directory. Python + numpy + scipy + Pillow.
Height is authored geometry, not a whole-image luminance conversion. All masks,
source detail and geometry use one shared registration. Normals are derived last
from the actual 16-bit PNG, at each disc's physical scale.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw, ImageCms
from scipy.ndimage import gaussian_filter as gf, map_coordinates, median_filter, binary_fill_holes
from round2_geometry import native_fields, chipped_rim

ROOT = Path(__file__).resolve().parent
N = 1024
R = 409.6
HEIGHT_MM = 48.0
SEED = 601114
SPECIES = {
    'fig': dict(x=0,y=0,diameter_mm=1500,rim_mm=30,wood='#D9C392',inner='#B69A68',torn='#E7D5AE',bark='#A6A79C'),
    'oak': dict(x=1024,y=0,diameter_mm=2000,rim_mm=35,wood='#DCC296',inner='#AE855B',torn='#EAD6B1',bark='#493F34'),
    'mangrove': dict(x=0,y=1024,diameter_mm=500,rim_mm=25,wood='#D2AA7F',inner='#A87853',torn='#E3C49A',bark='#8A8371'),
    'banyan': dict(x=1024,y=1024,diameter_mm=2200,rim_mm=30,wood='#D9C392',inner='#B69A68',torn='#E7D5AE',bark='#A6A79C'),
}

def rgb(s):
    return np.array([int(s[i:i+2],16) for i in (1,3,5)],dtype=np.float32)

def softstep(a,b,v):
    t=np.clip((v-a)/(b-a),0,1)
    return t*t*(3-2*t)

def polygon(points,size=1254):
    im=Image.new('L',(size,size)); ImageDraw.Draw(im).polygon([tuple(p) for p in points],fill=255)
    return np.asarray(im,dtype=np.float32)/255

def line(points,width,size=1254):
    im=Image.new('L',(size,size)); ImageDraw.Draw(im).line([tuple(p) for p in points],fill=255,width=width,joint='curve')
    return np.asarray(im,dtype=np.float32)/255

def normalized_noise(rng,shape,sigma):
    a=gf(rng.standard_normal(shape).astype(np.float32),sigma,mode='reflect')
    return a/(np.std(a)+1e-8)

def source_boundary(a,name):
    """Detect outer wood/bark transition along rays; restrict to known perimeter.
    The concrete inclusion is well inside this search, so cannot dent the circle.
    """
    angles=np.arange(2048,dtype=np.float32)*2*np.pi/2048
    radii=np.arange(515,620,dtype=np.float32)
    yy=626.5+np.sin(angles[:,None])*radii
    xx=626.5+np.cos(angles[:,None])*radii
    smooth=gf(a,(3,3,0))
    c=np.stack([map_coordinates(smooth[:,:,i],[yy,xx],order=1,mode='nearest') for i in range(3)],axis=-1)
    threshold={'fig':47,'oak':46,'mangrove':66,'banyan':49}[name]
    score=c[:,:,0]-c[:,:,2]-threshold
    if name=='oak': score=np.minimum(score,(c[:,:,0]-144)*0.65)
    transitions=(score[:,:-1]>0)&(score[:,1:]<=0)
    cost=np.where(transitions,abs(radii[:-1][None,:]-588),1e4)
    ix=np.argmin(cost,axis=1)
    bound=radii[ix]
    bound[np.min(cost,axis=1)>100]=588
    bound=gf(median_filter(bound,size=13,mode='wrap'),2,mode='wrap')
    return angles,bound

def bark_quilt(a,rng):
    """Overlapped original corner patches; no external bark photographs."""
    s=168; stride=104
    patches=[a[:180,:180],a[:180,-180:],a[-180:,:180],a[-180:,-180:]]
    out=np.zeros((N+s*2,N+s*2,3),np.float32); weight=np.zeros(out.shape[:2],np.float32)
    w=np.maximum(np.sin(np.linspace(0,np.pi,s))**2,0.0001)
    w=w[:,None]*w[None,:]
    for y in range(0,N+s,stride):
        for x in range(0,N+s,stride):
            p=patches[int(rng.integers(4))]
            p=np.rot90(p,int(rng.integers(4)))
            p=np.asarray(Image.fromarray(np.uint8(p)).resize((s,s),Image.Resampling.LANCZOS),dtype=np.float32)
            out[y:y+s,x:x+s]+=p*w[:,:,None]; weight[y:y+s,x:x+s]+=w
    return (out/weight[:,:,None].clip(1e-6))[s//2:s//2+N,s//2:s//2+N]

def source_geometry(a,structure,name):
    n=a.shape[0]; sy,sx=np.mgrid[:n,:n].astype(np.float32)
    rr=np.hypot(sx-626.5,sy-626.5)
    lum=np.sum(a*np.array([.2126,.7152,.0722],np.float32),axis=-1)
    broad=gf(lum,18); fine=lum-gf(lum,2); meso=gf(lum,2)-broad
    # All macro relief is authored in mm. Facet planes follow the traced lips.
    h=21.5+7.0*(rr/590)**2
    facet_mask=np.zeros_like(h)
    for i,points in enumerate(structure['facets']):
        p=np.array(points,np.float32)
        r=np.linalg.norm(p-626.5,axis=1)
        entry=p[np.argsort(r)[-2:]].mean(axis=0)
        tip=p[np.argmin(r)]
        v=entry-tip; length=np.dot(v,v)
        t=np.clip(((sx-tip[0])*v[0]+(sy-tip[1])*v[1])/length,0,1)
        plane=16.8+12.8*t+1.35*np.sin(i*4.13)
        # The trace controls the broad plane only. Blend its approximation over
        # a small shoulder; the real broken fibres below carry the sharp lip.
        m=gf(polygon(points),7.0)
        h=h*(1-m)+plane*m
        facet_mask=np.maximum(facet_mask,m)
    ridge=gf(line(structure['ridge'],22),12)
    ridge/=max(ridge.max(),1e-6)
    ridge_fine=gf(line(structure['ridge'],68),9)
    torn=softstep(3,24,lum-gf(lum,10))
    # Irregular severed hinge, plus isolated high fibre tips, not a smooth cord.
    h+=ridge*(10.3+4.8*softstep(-7,13,meso))
    h+=ridge_fine*torn*3.7
    detail_scale=.42 if name=='mangrove' else 1.0
    # Dense pigment rings have submillimetre relief; they are not stacked wood
    # terraces. The smaller mangrove needs shallower grain at 0.61 mm/texel.
    h+=(np.clip(fine,-25,25)*0.018+np.clip(meso,-27,27)*0.065)*detail_scale
    seams=np.zeros_like(h)
    for points in structure.get('seams',[]):
        support=gf(line(points,11),3)
        pigment=softstep(0,18,broad-lum)
        seam=support*(.2+.8*pigment)
        seams=np.maximum(seams,seam)
    h-=seams*3.8
    concrete=np.zeros_like(h)
    if name=='fig':
        roi=polygon([[128,241],[280,227],[345,269],[337,364],[292,428],[213,494],[107,451],[88,374],[107,299]])
        mineral=binary_fill_holes((gf(a[:,:,0]-a[:,:,2],1.4)<60)&(roi>.5))
        concrete=gf(mineral.astype(np.float32),0.8)
        h=h*(1-concrete)+(30.5+np.clip(fine,-30,30)*.038)*concrete
    heart=gf(polygon(structure['heartwood']),2) if 'heartwood' in structure else np.zeros_like(h)
    if name=='oak':
        hy,hx=np.gradient(heart)
        pigment_edge=gf(np.hypot(hx,hy),5)
        guard=np.clip(pigment_edge*24,0,1)
        # Do not emboss the pigment boundary between sapwood and heartwood.
        h-=(np.clip(fine,-25,25)*0.018+np.clip(meso,-27,27)*0.065)*guard*.85
    return dict(height=h,lum=lum,fine=fine,meso=meso,torn=torn,ridge=ridge,ridge_fine=ridge_fine,
                seams=seams,concrete=concrete,heart=heart,facets=facet_mask)

def warp(f,coords):
    if f.ndim==3:
        return np.stack([map_coordinates(f[:,:,k],coords,order=1,mode='reflect') for k in range(f.shape[2])],axis=-1)
    return map_coordinates(f,coords,order=1,mode='reflect')

def make_patch(name,settings,structure,index):
    rng=np.random.default_rng(SEED+index)
    a=np.asarray(Image.open(ROOT/'source'/f'generated_{name}.png').convert('RGB'),dtype=np.float32)
    edited=np.asarray(Image.open(ROOT/'source'/f'round2_{name}.png').convert('RGB'),dtype=np.float32)
    revision=json.loads((ROOT/'source/round2_structure.json').read_text())[name]
    angles,edge=source_boundary(a,name)
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    xx-=511.5; yy-=511.5
    radius=np.hypot(xx,yy); theta=np.mod(np.arctan2(yy,xx),2*np.pi)
    pitch=settings['diameter_mm']/(2*R)
    # Preserve the original registration and intact 20..40 mm bark band.
    rim=settings['rim_mm']+3.0*np.sin(13*theta+index)+1.8*np.sin(31*theta-2*index)+1*np.sin(67*theta)
    rim=np.clip(rim,20.2,39.8)
    wood_radius=R-rim/pitch
    outer=softstep(R+.5,R-.5,radius)
    original_wood=softstep(wood_radius+.7,wood_radius-.7,radius)
    wood,chip,lift,effective_rim=chipped_rim(theta,radius,rim,pitch,revision,R)
    re=np.interp(theta,angles,edge,period=2*np.pi)
    sr=radius/wood_radius*re
    coords=[626.5+np.sin(theta)*sr,626.5+np.cos(theta)*sr]
    fields=source_geometry(a,structure,name)
    revised=native_fields(edited,revision,fields,structure,name)
    fields={k:warp(v,coords) for k,v in fields.items()}
    # Newly exposed bark notches continue the nearest wood, never source bark.
    # Rings must not inherit the old edge detector's angular ripples. Use an
    # isotropic interior registration; keep the original warp for the approved
    # hinge, concrete and exterior bark. Extend wood locally into broken rims.
    new_sr=radius*588/(R-settings['rim_mm']/pitch)
    cut_sr=np.minimum(new_sr,576)
    cut_coords=[626.5+np.sin(theta)*cut_sr,626.5+np.cos(theta)*cut_sr]
    geometry_coords=[626.5+np.sin(theta)*new_sr,626.5+np.cos(theta)*new_sr]
    revised={k:warp(v,geometry_coords if k in ('height','facet_id','facet_tone','facet_rough') else cut_coords) for k,v in revised.items()}
    revised['preserve_hinge']=softstep(.15,.55,fields['ridge_fine'])
    preserve=revised['preserve_hinge']
    revised['height']=revised['height']*(1-preserve)+fields['height']*preserve
    revised['height']=revised['height']*(1-fields['concrete'])+fields['height']*fields['concrete']
    registered=warp(a,coords)
    # Reconstruct wood reflectance from the design palette; discard broad source
    # intensity. Only compressed grain and ring pigment remains in colour.
    col=np.broadcast_to(rgb(settings['wood']),(N,N,3)).copy()
    pigment=np.clip(fields['fine']*.48+fields['meso']*.18,-12,12)
    col+=pigment[:,:,None]
    inner=np.clip(-fields['meso']/70,0,.18)
    if name=='oak':
        inner=fields['heart']*.96
    elif name=='mangrove':
        # A redder heart follows source colour at broad scales, not dark cavities.
        native=gf(registered[:,:,0]-registered[:,:,1],24)
        inner=softstep(60,80,native)*.74
    col=col*(1-inner[:,:,None])+rgb(settings['inner'])*inner[:,:,None]
    col+=pigment[:,:,None]*inner[:,:,None]*.65
    fibres=np.clip(fields['torn']*(.3+.35*fields['ridge_fine']),0,.8)
    col=col*(1-fibres[:,:,None])+rgb(settings['torn'])*fibres[:,:,None]
    col-=fields['seams'][:,:,None]*np.array([21,24,24],np.float32)
    # Concrete aggregate has its own neutral mineral pigment and relief.
    con=fields['concrete']*wood
    stone=rgb('#A49E8C')+(fields['fine']*.65+fields['meso']*.32)[:,:,None]
    col=col*(1-con[:,:,None])+stone*con[:,:,None]
    old_col=col.copy()
    # Rebuild reflectance from the same design swatches. The new plate supplies
    # only high-frequency material detail, not broad illumination or shadows.
    col=np.broadcast_to(rgb(settings['wood']),(N,N,3)).copy()
    new_inner=np.zeros((N,N),np.float32)
    if name=='oak':
        new_inner=revised['heart']*.96
    elif name=='mangrove':
        new_inner=inner  # Preserve the accepted warm/red species balance.
    col=col*(1-new_inner[:,:,None])+rgb(settings['inner'])*new_inner[:,:,None]
    tone=revised['facet_tone']
    tone=1+(tone-1)*(1-revised['preserve_hinge'])
    col*=tone[:,:,None]
    ring_value=revised['rings']*revision['ring_contrast']
    col*=1+ring_value[:,:,None]
    col+=np.clip(revised['fine'],-20,20)[:,:,None]*.14
    col-=revised['cracks'][:,:,None]*np.array([27,24,20],np.float32)
    col-=revised['seams'][:,:,None]*np.array([23,25,23],np.float32)
    protect=revised['preserve_hinge']
    col=col*(1-protect[:,:,None])+old_col*protect[:,:,None]
    col=col*(1-con[:,:,None])+stone*con[:,:,None]

    bark=bark_quilt(a,rng)
    # Registered native lip carries chips into the surrounding bark; the quilt
    # supplies full square padding beyond the small useful exterior annulus.
    safe=(coords[0]>3)&(coords[0]<1250)&(coords[1]>3)&(coords[1]<1250)
    edge_blend=softstep(R+16,R-4,radius)*safe
    bark=bark*(1-edge_blend[:,:,None])+registered*edge_blend[:,:,None]
    bl=np.sum(bark*np.array([.2126,.7152,.0722],np.float32),axis=-1)
    bd=bl-gf(bl,15)
    bark_col=rgb(settings['bark'])+np.clip(bd*.48,-24,24)[:,:,None]
    bark_col+=(gf(bl,9)-gf(bl,35))[:,:,None]*.12

    # Deterministic master-resolution fibres follow measured local grain axes
    # (structure tensor), with pores at a different scale. New detail is shared.
    l=fields['lum']; gy,gx=np.gradient(gf(l,1))
    jxx=gf(gx*gx,8); jyy=gf(gy*gy,8); jxy=gf(gx*gy,8)
    axis=.5*np.arctan2(2*jxy,jxx-jyy)+np.pi/2
    noise=rng.standard_normal((N,N)).astype(np.float32)
    elongated=np.zeros((N,N),np.float32)
    for shift in (-5,-3,-1,0,1,3,5):
        elongated+=map_coordinates(noise,[yy+511.5+np.sin(axis)*shift,xx+511.5+np.cos(axis)*shift],order=1,mode='reflect')
    elongated/=7
    micro=elongated-gf(elongated,1.1)
    micro/=max(np.std(micro),1e-8)
    pores=softstep(1.5,3.0,normalized_noise(rng,(N,N),.55))
    col+=micro[:,:,None]*.78-pores[:,:,None]*1.5
    bark_col+=micro[:,:,None]*.55
    base=np.clip(col*wood[:,:,None]+bark_col*(1-wood[:,:,None]),0,255)

    wood_h=revised['height']+micro*.085-pores*.12-chip*2.8
    # Native source lip profile preserves chips; bark supports raised flanges.
    bark_h=27.2+np.clip(bd,-45,45)*(.105 if name=='oak' else .065)+micro*.075
    lip=np.exp(-((radius-(R-rim/pitch*.48))/(rim/pitch*.30))**2)
    bark_h+=lip*(2.5+1.4*np.sin(23*theta+index))
    bark_h+=lift*5.5
    h=wood_h*wood+bark_h*(1-wood)
    h=gf(h,.40)
    # Cavity AO is computed in physical mm, independently of pigment.
    cavity=np.zeros_like(h)
    for scale,gain in [(1.5,.070),(5,.045),(16,.025)]:
        cavity+=np.maximum(gf(h,scale/pitch)-h,0)*gain
    ao=np.clip(np.exp(-cavity),.38,1)
    # Quantized fresh-wood values must themselves remain within .75.. .90.
    rough=np.clip(revised['facet_rough']+.012*micro,192/255,229/255)
    hinge_rough=np.clip(.805+.030*fields['torn']+.025*fields['ridge_fine']+.008*micro,.75,.90)
    rough=rough*(1-protect)+hinge_rough*protect
    rough=rough*wood+np.clip(.92+.015*micro,.88,.97)*(1-wood)
    rough=rough*(1-con)+np.clip(.92+.012*micro,.88,.96)*con
    orm=np.stack([ao,rough,np.zeros_like(ao)],axis=-1)
    masks=dict(disc=outer,wood=wood,concrete=con,heart=revised['heart']*wood,ridge=fields['ridge']*wood,
               seams=revised['seams']*wood,facets=revised['facet_id']*wood,micro=micro*wood,
               rings=revised['rings']*wood,ring_height=revised['ring_height']*wood,
               cracks=revised['cracks']*wood,chip=chip,lift=lift,original_wood=original_wood,
               preserve_hinge=protect*wood,facet_tone=tone*wood,facet_rough=revised['facet_rough']*wood)
    metadata=dict(settings,mm_per_pixel=pitch,square_coverage_mm=settings['diameter_mm']/.8,
                  source_boundary_px=[float(edge.min()),float(edge.max())],
                  rim_mm_measured=[float(rim.min()),float(rim.mean()),float(rim.max())],
                  facet_count=len(revision['spokes']),ring_relief_amplitude_mm=revision['ring_relief_mm'],
                  ring_value_contrast=revision['ring_contrast'],
                  bark_chip_count=len(revision['chip_angles_degrees']))
    return base,h,orm,masks,metadata

def normal_from_saved_height(h_mm,pitch_mm):
    dy,dx=np.gradient(h_mm,pitch_mm,edge_order=1)
    n=np.stack([-dx,dy,np.ones_like(dx)],axis=-1)
    n/=np.linalg.norm(n,axis=-1,keepdims=True)
    return np.uint8(np.round(np.clip(n*.5+.5,0,1)*255))

def save_rgb(path,a,icc=None):
    im=Image.fromarray(np.uint8(np.round(np.clip(a,0,255))))
    im.save(path,**({'icc_profile':icc} if icc else {}))

def main():
    structure=json.loads((ROOT/'source/structure.json').read_text())
    base=np.zeros((2048,2048,3),np.float32)
    height=np.zeros((2048,2048),np.float32)
    orm=np.zeros_like(base)
    masks={}; patches={}
    for i,(name,s) in enumerate(SPECIES.items()):
        print(f'Building {name}',flush=True)
        b,h,o,m,meta=make_patch(name,s,structure[name],i)
        sl=np.s_[s['y']:s['y']+N,s['x']:s['x']+N]
        base[sl]=b; height[sl]=h; orm[sl]=o
        for key,v in m.items(): masks[f'{name}_{key}']=v.astype(np.float32)
        patches[name]=meta
    # Freeze ICC bytes once: profile timestamps cannot change rebuild hashes.
    icc_path=ROOT/'source/sRGB.icc'
    if not icc_path.exists():
        icc_path.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
    save_rgb(ROOT/'stump_cuts_base.png',base,icc_path.read_bytes())
    code=np.round(np.clip(height/HEIGHT_MM,0,1)*65535).astype(np.uint16)
    Image.fromarray(code).save(ROOT/'stump_cuts_height.png')
    saved=np.asarray(Image.open(ROOT/'stump_cuts_height.png'),dtype=np.float64)/65535*HEIGHT_MM
    normal=np.zeros((2048,2048,3),np.uint8)
    for name,s in patches.items():
        sl=np.s_[s['y']:s['y']+N,s['x']:s['x']+N]
        normal[sl]=normal_from_saved_height(saved[sl],s['mm_per_pixel'])
    save_rgb(ROOT/'stump_cuts_normal.png',normal)
    save_rgb(ROOT/'stump_cuts_orm.png',orm*255)
    np.savez_compressed(ROOT/'derivation.npz',**masks)
    meta=dict(size=[2048,2048],height_range_mm=HEIGHT_MM,height_datum_mm=24,
              normal_convention='OpenGL: +X right, +Y image-up, +Z outward',
              normal_formula='normalize(-dH/dx, +dH/dy_down, 1)',
              disc_diameter_px=819.2,disc_centres_px=[[511.5,511.5],[1535.5,511.5],[511.5,1535.5],[1535.5,1535.5]],
              seed=SEED,patches=patches,
              provenance='Four original and four edited built-in image_gen sources; source/generation_prompts.json and source/round2_prompts.json; no downloaded imagery.')
    (ROOT/'material.json').write_text(json.dumps(meta,indent=2)+'\n')
    manifest={}
    for name in SPECIES:
        for prefix in ('generated','round2'):
            p=ROOT/'source'/f'{prefix}_{name}.png'
            manifest[p.name]=dict(size=list(Image.open(p).size),sha256=hashlib.sha256(p.read_bytes()).hexdigest())
    (ROOT/'source/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Built all four 2048px maps. Encoded height range: 48 mm.',flush=True)

if __name__=='__main__':
    main()
