#!/usr/bin/env python3
"""Offline, deterministic 2K thatch-tier wood trim-sheet builder.

Original generated images are retained, never overwritten. Shared geometry fields
travel through each native-resolution quilt cut. Only the colour map is sRGB.
Dependencies: numpy, scipy, Pillow. Run from any directory.
"""
from pathlib import Path
import hashlib, json, time
import numpy as np
from PIL import Image, ImageCms
from scipy import ndimage as ndi

ROOT=Path(__file__).resolve().parent
N=2048
MM_PER_PIXEL=1500/N
HEIGHT_RANGE_MM=10.0
BANDS=[(0,614,'bark'),(614,1126,'peeled'),(1126,1434,'sticks'),(1434,1782,'cord')]
SEED=20261114
KNOTS={'bark_a':[(956,135,42,28),(433,497,45,32),(1066,880,45,27)],
       'bark_b':[(850,324,62,37),(180,864,50,34)],
       'peeled':[(208,238,63,38),(927,315,27,19),(943,734,57,35),(104,1081,30,23)],
       'sticks':[(266,187,30,22),(971,501,31,23),(430,822,31,22)],
       'hewn':[(229,167,56,31),(1028,509,44,27),(272,742,48,28),(983,999,46,26)]}


def gf(a,sigma): return ndi.gaussian_filter(a,sigma,mode='wrap')
def smoothstep(x):
    x=np.clip(x,0,1); return x*x*(3-2*x)
def u8(a): return np.rint(np.clip(a,0,255)).astype(np.uint8)
def save_rgb(path,a,srgb=False):
    kw={'icc_profile':ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()} if srgb else {}
    Image.fromarray(u8(a)).save(path,**kw)
def luma(a): return a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722

def noise(rng,shape,sigma):
    v=gf(rng.standard_normal(shape).astype(np.float32),sigma)
    return v/max(float(v.std()),1.e-8)

def cut(cost,closed=False):
    """Minimum-error path. Closed paths keep the perpendicular seam periodic."""
    h,w=cost.shape; cost=cost.astype(np.float64).copy()
    cost[:,:8]+=1e7; cost[:,-8:]+=1e7
    back=np.zeros((h,w),np.int8); v=cost[0].copy(); anchor=w//2
    if closed: v[:]=1e16; v[anchor]=cost[0,anchor]
    for y in range(1,h):
        choices=np.stack([np.r_[1e20,v[:-1]],v,np.r_[v[1:],1e20]])
        choices[[0,2]]+=.2
        k=choices.argmin(0); back[y]=k-1
        v=choices[k,np.arange(w)]+cost[y]
    x=anchor if closed else int(v.argmin()); result=np.empty(h,np.int32)
    for y in range(h-1,-1,-1): result[y]=x; x+=int(back[y,x])
    return result

def seam(a,b,closed=False):
    cost=((a[...,:3]-b[...,:3])**2).mean(2)+1400*(a[...,3]-b[...,3])**2
    p=cut(ndi.gaussian_filter(cost,1),closed)
    t=smoothstep((np.arange(a.shape[1])[None,:]-p[:,None]+2)/4)[...,None]
    return a*(1-t)+b*t

def prepare(name):
    a=np.array(Image.open(ROOT/'source'/f'generated_{name}.png').convert('RGB'),np.float32)
    h,w=a.shape[:2]; yy,xx=np.mgrid[:h,:w].astype(np.float32)
    sx=xx.copy(); sy=yy.copy(); scar=np.zeros((h,w),np.float32)
    for cx,cy,rx,ry in KNOTS[name]:
        dx,dy=xx-cx,yy-cy
        f=np.exp(-.5*((dx/(rx*1.25))**2+(dy/(ry*1.5))**2))
        sx+=dx*.65*f; sy+=dy*.65*f
        r=np.sqrt((dx/(rx*.55))**2+(dy/(ry*.55))**2)
        scar+=-.35*np.exp(-r*r*1.8)+.20*np.exp(-((r-1)/.23)**2)
    a=np.stack([ndi.map_coordinates(a[...,i],[sy,sx],order=1,mode='reflect') for i in range(3)],axis=2)
    lum=luma(a); s=ndi.gaussian_filter(a,(1.,2.,0))
    score=(s[...,0]-s[...,2])*.7+luma(s)*.4
    if name=='hewn': bark=np.zeros((h,w),np.float32)
    else:
        threshold=104 if name!='sticks' else 101
        mask=score<threshold
        mask=ndi.binary_closing(mask,structure=np.ones((3,3)))
        mask=ndi.binary_opening(mask,structure=np.ones((2,3)))
        labels,count=ndi.label(~mask)
        sizes=np.bincount(labels.ravel())
        small=sizes<45; small[0]=False
        mask|=small[labels]
        # reflect padding avoids injecting a false bare wood frame.
        mask[:6]=mask[6]; mask[-6:]=mask[-7]
        mask[:,:10]=mask[:,10:11]; mask[:,-10:]=mask[:,-11:-10]
        bark=ndi.gaussian_filter(mask.astype(np.float32),.7)
    local=ndi.gaussian_filter(lum,(2.,5.))
    valleys=np.clip((local-lum-15)/32,0,1)
    # Incisions are isolated from large colour patches and bark boundaries.
    edge=ndi.maximum_filter(bark,size=9)-ndi.minimum_filter(bark,size=9)
    inc=ndi.gaussian_filter(valleys,(.4,1.5))*(1-.8*edge)
    return np.concatenate([a,bark[...,None],inc[...,None],scar[...,None]],axis=2)

def fractures(rng,h,count):
    depth=np.zeros((h,N),np.float32); records=[]
    for _ in range(count):
        length=int(rng.uniform(35,370)); cx=int(rng.integers(N)); cy=int(rng.integers(h))
        xs=np.arange(-length//2-3,length//2+4); t=(xs+length/2)/length
        taper=np.sin(np.clip(t,0,1)*np.pi)**.7
        curve=rng.uniform(-3,3)*np.sin(t*np.pi)+rng.uniform(-1.2,1.2)*np.sin(t*5*np.pi)
        width=rng.uniform(.35,.9); d=rng.uniform(.35,1.5)
        rows=np.arange(-8,9)[:,None]
        field=np.exp(-.5*((rows-curve)/(width*taper+.12))**2)*taper*d
        iy=(cy+rows)%h; ix=(cx+xs[None,:])%N
        depth[iy,ix]=np.maximum(depth[iy,ix],field)
        records.append({'center':[cx,cy],'length_pixels':length,'depth_mm':d})
    return depth,records

def build_band(master,kind,index):
    raw=master[...,:3]; bark=master[...,3]; inc=master[...,4]; scar=master[...,5]
    h=raw.shape[0]; shape=(h,N); rng=np.random.default_rng(SEED+index)
    lum=luma(raw); fine=noise(rng,shape,(.45,5.5)); pores=noise(rng,shape,(.4,.75))
    weather=noise(rng,shape,(12,145))
    # Separate material reflectance from photographic ridge shading. Bark/wood
    # have distinct baselines; remove only very broad illumination within each.
    edge=ndi.maximum_filter(bark,size=7,mode='wrap')-ndi.minimum_filter(bark,size=7,mode='wrap')
    local=gf(lum,1); micro=lum-local
    broad=gf(lum,(18,60))
    residual=local-broad
    wood=np.array([201.,184.,157.],np.float32)
    brown=np.array([139.,124.,105.],np.float32)
    if kind=='bark': wood=np.array([185.,171.,148.],np.float32)
    if kind=='sticks': brown=np.array([142.,123.,101.],np.float32)
    base=wood[None,None,:]*(1-bark[...,None])+brown[None,None,:]*bark[...,None]
    # Within-material broad pigment/weather, without a large brightness ramp.
    expected=gf(bark,(18,60)); class_lum=194*(1-expected)+119*expected
    broad_pig=np.clip(broad-class_lum,-28,28)
    broad_pig-=float(np.median(broad_pig))
    pigment=residual*.55+np.clip(micro,-28,28)*(.40-.22*edge)+broad_pig*.65
    # The sharp class step is physical pigment. Remove the residual source step
    # near it to prevent doubled light/dark bark rims.
    pigment*=1-.65*edge
    chroma=gf(raw-lum[...,None],(2,6,0)); chroma-=chroma.mean((0,1))
    base+=(pigment+weather*1.4+fine*.85+pores*.35)[...,None]+np.clip(chroma,-8,8)*.65
    # Existing dark crevices become nearly unlit substrate in base colour;
    # their shading belongs to height/normal/AO.
    base+=inc[...,None]*12
    # Pale wood darkens toward its feathered cambium margin, a pigment transition
    # only. The geometric boundary remains narrower in the shared height mask.
    near_bark=gf(bark,(6,14))*(1-bark)
    base-=near_bark[...,None]*np.array([28.,25.,20.])
    if kind=='sticks':
        # Tiny scuffs age toward tan rather than forming repeating white dashes.
        base-=((1-bark)*.65)[...,None]*(wood-brown)
    grain=np.clip((gf(lum,.65)-gf(lum,(3,12)))/25,-1.5,1.5)
    grain*=.12+.12*bark
    if kind=='sticks': grain*=.6
    grain+=fine*.025+pores*.010
    bark_relief=gf(bark,.65)*(1.55+.2*np.tanh(residual/15))
    depth,records=fractures(rng,h,[22,30,13,23][index])
    depth*=1-.80*bark
    incisions=inc*(.55+.35*bark)+depth
    height=4.0+bark_relief+grain+scar-incisions
    base-=np.minimum(depth,1)[...,None]*np.array([6.,5.,4.])
    # Shallow trimmed facets: nearly flat interiors and uneven scalloped edges.
    yy,xx=np.mgrid[:h,:N].astype(np.float32); facets=np.zeros(shape,np.float32)
    facet_records=[]
    for j in range([5,13,4,32][index]):
        cx=float(rng.uniform(0,N)); cy=float(rng.uniform(0,h)); rx=rng.uniform(25,85); ry=rng.uniform(6,20)
        dx=(xx-cx+N/2)%N-N/2; dy=(yy-cy+h/2)%h-h/2
        r=np.sqrt((dx/rx)**2+(dy/ry)**2)
        f=smoothstep((1-r)*5)*(1-bark)
        v=f*(.12+.14*dy/ry)
        facets-=v; facet_records.append([cx,cy,float(rx),float(ry)])
    height+=facets
    base+=facets[...,None]*3.5
    # Multiscale cavity AO; never multiply this into base colour.
    cavity=np.maximum(0,gf(height,1.2)-height)*.40+np.maximum(0,gf(height,5)-height)*.24
    ao=np.clip(np.exp(-cavity*.8-incisions*.55),.24,1)
    rough=np.clip(.745+.145*bark+.018*np.tanh(weather)+.018*np.tanh(fine)+.028*np.minimum(incisions,1),.68,.95)
    return base,height,np.stack([ao*255,rough*255,np.zeros(shape)],axis=2),bark,incisions,{'fractures':records,'facets':facet_records}

def colour_wood(base,master,incisions,kind,index):
    """Round 3 reflectance palette; no changes to geometry, quilts or RNG state.

    Recover the accepted within-material pigment, then recolour bark and bare
    wood separately. All spatial filters wrap within this band's own rectangle.
    Fissure pigment is directional-light independent; AO is never baked in.
    """
    raw=master[...,:3]; bark=master[...,3]; lum=luma(raw)
    old_wood=np.array([185.,171.,148.] if kind=='bark' else [201.,184.,157.])
    old_bark=np.array([142.,123.,101.] if kind=='sticks' else [139.,124.,105.])
    residual=base-(old_wood*(1-bark[...,None])+old_bark*bark[...,None])
    pigment=luma(residual)
    core=bark>.95
    tone=1.65*(pigment-float(pigment[core].mean()))-32*incisions
    # Soft shoulders keep dark fissures richly brown without clipped channels.
    tone=42*np.tanh(tone/42)
    tone-=float(tone[core].mean())
    brown=np.array([124.,87.,55.] if kind=='sticks' else [105.,71.,46.])
    bark_colour=brown+tone[...,None]*np.array([1.,.86,.67])

    # Select rare, locally pale and neutral source flecks. Round 2's broad
    # neutral mask covered ordinary bark ridges and made the poles look grey.
    chroma=gf(raw[...,0]-raw[...,2],(2,4))
    q02,q08=np.quantile(chroma[core],[.02,.08])
    neutral=smoothstep((q08-chroma)/max(q08-q02,1))
    pale=smoothstep((lum-gf(lum,(4,10))-4)/14)
    lichen=neutral*pale*smoothstep((bark-.8)/.15)
    fleck=np.array([151.,147.,132.])+tone[...,None]*.25
    bark_colour=bark_colour*(1-lichen[...,None])+fleck*lichen[...,None]

    rng=np.random.default_rng(SEED+500+index)
    weather=smoothstep((noise(rng,bark.shape,(9,90))-.45)/1.7)*.40
    fresh=(bark<.05)&(weather<.02)
    wood_tone=pigment-float(pigment[fresh].mean())
    honey=np.array([185.,145.,95.]); grey=np.array([166.,153.,129.])
    wood_colour=honey+(grey-honey)*weather[...,None]+wood_tone[...,None]
    colour=bark_colour*bark[...,None]+wood_colour*(1-bark[...,None])
    return colour,lichen,weather


def build_cord():
    """Touching upright turns with two helical plies, periodic on both axes.

    The generated photograph contributes only fine pigment. Geometry is analytic,
    so every turn closes, and photographic shadows cannot dictate its relief.
    """
    h=348; rng=np.random.default_rng(SEED+304)
    raw=np.array(Image.open(ROOT/'source/generated_cord.png').convert('RGB'),np.float32)
    # Native-size quilt for pigment: the same closed cuts as the wood sources.
    src=np.concatenate([raw,np.zeros((*raw.shape[:2],3),np.float32)],axis=2)
    windows=[(0,35),(614,460),(0,780),(614,30)]
    patches=[src[y:y+h+100,x:x+640] for x,y in windows]
    z=np.empty((h+100,N,6),np.float32)
    for j,a in enumerate(patches):
        z[:,j*512:j*512+128]=seam(patches[(j-1)%4][:,512:],a[:,:128])
        z[:,j*512+128:j*512+512]=a[:,128:512]
    top=seam(z[h:].transpose(1,0,2),z[:100].transpose(1,0,2),True).transpose(1,0,2)
    master=np.concatenate([top,z[100:h]],axis=0)[...,:3]
    lum=luma(master)
    pigment=np.clip(lum-gf(lum,1.3),-12,12)*.22
    # Integer widths sum to 2048; x=-.5 and x=2047.5 are gap centres.
    widths=rng.integers(11,15,164)
    while widths.sum()!=N:
        direction=1 if widths.sum()<N else -1
        choices=np.flatnonzero(widths<(14) if direction>0 else widths>11)
        widths[rng.choice(choices)]+=direction
    boundaries=np.r_[0,np.cumsum(widths)]
    base=np.zeros((h,N,3),np.float32); height=np.zeros((h,N),np.float32)
    grooves=np.zeros_like(height); gaps=np.zeros_like(height); plies=np.zeros_like(height)
    records=[]; y=np.arange(h,dtype=np.float32)[:,None]; t=y/h
    for i,(x0,x1) in enumerate(zip(boundaries[:-1],boundaries[1:])):
        w=x1-x0; q=2*(np.arange(w,dtype=np.float32)[None,:]+.5)/w-1
        envelope=np.sqrt(np.clip(1-q*q,0,1))
        rotations=int(rng.integers(8,12)); phase0=float(rng.uniform(0,2*np.pi))
        # Integer helix rotations + periodic phase modulation close at y=h.
        phi=2*np.pi*rotations*t+phase0+.10*np.sin(2*np.pi*t+phase0)
        # Raycast two helically swept circular bundles. Sampling neighbouring
        # Y centres accounts for the strands' tilt, producing broad rounded
        # diagonal lobes instead of a groove scratched onto a straight tube.
        px=q*w/2; helix_radius=w*.23; strand_radius=w*.29
        surfaces=[]; fibre_fields=[]
        for strand in (0,1):
            top=np.full((h,w),-100.,np.float32); tex=np.zeros_like(top)
            for dy in np.arange(-strand_radius,strand_radius+.01,.4):
                st=(y+dy)/h
                angle=2*np.pi*rotations*st+phase0+.10*np.sin(2*np.pi*st+phase0)+strand*np.pi
                cx=helix_radius*np.cos(angle); cz=helix_radius*np.sin(angle)
                dx=px-cx; disk=strand_radius**2-dx*dx-dy*dy
                dz=np.sqrt(np.maximum(disk,0))
                surface=np.where(disk>=0,cz+dz,-100.)
                take=surface>top
                # Fine fibres follow the curved surface of the winning ply.
                strand_angle=np.arctan2(dx,np.maximum(dz,.01))
                f=np.sin(9*strand_angle+.35*np.sin(angle))+.35*np.sin(17*strand_angle-.2*np.cos(angle))
                tex=np.where(take,f,tex);top=np.maximum(top,surface)
            surfaces.append(top);fibre_fields.append(tex)
        ply=(surfaces[1]>surfaces[0]).astype(np.float32)
        visible=np.maximum(surfaces[0],surfaces[1])
        fibre=np.where(ply>0,fibre_fields[1],fibre_fields[0])
        gap=smoothstep((-.8-visible)/1.4)
        groove=np.exp(-np.abs(surfaces[0]-surfaces[1])/1.0)*(1-gap)
        ht=np.maximum(1.15,4.2+visible*MM_PER_PIXEL)-.24*groove
        ht+=fibre*.055*(1-gap)+pigment[:,x0:x1]*.012
        # Tangled/darker inner fibres are pigment only; lighting comes from maps.
        tone=float(rng.uniform(-7,7)); honey=float(rng.uniform(-3.5,3.5))
        col=np.array([205.,179.,131.])+tone+np.array([.4,.1,-1.])*honey
        variation=.65*np.sin(2*np.pi*t+phase0)+fibre*.65+pigment[:,x0:x1]
        variation+=(ply-.5)*3.0
        base[:,x0:x1]=col+variation[...,None]-groove[...,None]*np.array([7.,6.,4.])
        base[:,x0:x1]-=gap[...,None]*np.array([4.,3.,2.])
        height[:,x0:x1]=ht; grooves[:,x0:x1]=groove; gaps[:,x0:x1]=gap
        plies[:,x0:x1]=ply
        records.append({'x_edges':[int(x0),int(x1)],'width_pixels':int(w),
                        'diameter_mm':float(w*MM_PER_PIXEL),'full_twists':rotations,'phase_radians':phase0})
    # Sparse curved fibres and five short loose ends, wrapped in both dimensions.
    # Local Gaussian strokes at native resolution; all four maps share the mask.
    fray=np.zeros((h,N),np.float32); loose=np.zeros_like(fray); ends=[]
    for i in range(34):
        turn=int(rng.integers(len(widths))); x=float(boundaries[turn]+rng.uniform(1,widths[turn]-1))
        cy=float(rng.uniform(0,h)); length=float(rng.uniform(8,23) if i<5 else rng.uniform(4,11))
        drift=float(rng.uniform(-5,5)); thickness=.65 if i<5 else .30
        for v in np.linspace(0,1,max(24,int(length*4))):
            fx=x+drift*v+np.sin(np.pi*v)*1.2; fy=cy+length*v
            ix=np.arange(int(fx)-2,int(fx)+4); iy=np.arange(int(fy)-2,int(fy)+4)
            d2=(ix[None,:]-fx)**2+(iy[:,None]-fy)**2
            a=np.exp(-d2/(2*thickness**2))*(.25+.75*np.sin(np.pi*v)**.3)
            dest=loose if i<5 else fray
            dest[np.ix_(iy%h,ix%N)]=np.maximum(dest[np.ix_(iy%h,ix%N)],a)
        if i<5:ends.append({'root':[x,cy],'length_pixels':length,'drift_pixels':drift})
    fibre_mask=np.maximum(fray,loose)
    base=base*(1-fibre_mask[...,None]*.65)+np.array([224.,202.,160.])*fibre_mask[...,None]*.65
    height+=fray*.15+loose*.45
    cavity=np.maximum(0,gf(height,1.1)-height)*.35+np.maximum(0,gf(height,4)-height)*.20
    ao=np.clip(np.exp(-cavity-.50*grooves-.7*gaps),.18,1)
    rough=np.clip(.88+.025*np.tanh(pigment)+.035*grooves+.015*fibre_mask,.83,.96)
    orm=np.stack([ao*255,rough*255,np.zeros_like(height)],axis=2)
    fields={'cord_grooves':grooves,'cord_gaps':gaps,'cord_plies':plies,'cord_fray':fibre_mask}
    rec={'name':'cord','rows_half_open':[1434,1782],'bark_fraction':0.,'turn_count':len(widths),
         'turns':records,'loose_ends':ends,'frayed_fibre_count':29,'source_windows':windows,
         'full_twists_range':[8,11],'height_model':'round envelope with two helical plies and recessed ply grooves',
         'seam':'whole turns between integer texel edges; whole twist cycles around circumference'}
    return base,height,orm,np.maximum(grooves*.55,gaps),fields,rec,master


def build_ends():
    raw=np.array(Image.open(ROOT/'source/generated_ends.png').convert('RGB'),np.float32)
    out=np.empty((266,N,3),np.float32); out[:]=[98,65,41]
    height=np.full((266,N),4.,np.float32)
    orm=np.empty_like(out); orm[:]=[255,222,0]
    disc_mask=np.zeros((266,N),np.float32); crack_all=np.zeros_like(disc_mask)
    cells=[]
    centers=[(214,378),(626,378),(1041,378),(214,879),(626,880),(1041,875)]
    yy,xx=np.mgrid[:256,:256].astype(np.float32)
    dx,dy=xx-127.5,yy-127.5; rad=np.hypot(dx,dy); theta=np.arctan2(dy,dx)
    rng=np.random.default_rng(SEED+80)
    for i,(cx,cy) in enumerate(centers):
        # Find the generated cut outline along radial rays and register it to
        # an exact centred circular UV disc. All channels share this transform.
        angles=np.linspace(-np.pi,np.pi,2048,endpoint=False)
        rr=np.arange(140,215,dtype=np.float32)
        sx=cx+np.cos(angles[:,None])*rr; sy=cy+np.sin(angles[:,None])*rr
        vals=ndi.map_coordinates(luma(raw),[sy,sx],order=1,mode='nearest')
        # Background is dark taupe; bark rim remains attached to the bright face.
        alive=vals>96
        bounds=140+np.max(np.where(alive,np.arange(len(rr))[None,:],0),axis=1)
        bounds=ndi.gaussian_filter1d(bounds.astype(np.float32),2,mode='wrap')
        br=np.interp((theta+np.pi)/(2*np.pi)*2048,np.arange(2049),np.r_[bounds,bounds[0]])
        sample_r=np.minimum(rad/125.,1.015)*br
        sx=cx+np.cos(theta)*sample_r; sy=cy+np.sin(theta)*sample_r
        a=np.stack([ndi.map_coordinates(raw[...,c],[sy,sx],order=1,mode='nearest') for c in range(3)],axis=2)
        lum=luma(a); interior=rad<119
        local=ndi.gaussian_filter(lum,1,mode='reflect')
        broad=ndi.gaussian_filter(lum,9,mode='reflect')
        inc=np.clip((broad-lum-20)/46,0,1)*interior
        # Thin shell is distinct from the irregular rings; rim is in-plane.
        rim=smoothstep((rad-120)/4)
        pigment=(local-broad)*.70+(lum-local)*.40+(broad-float(np.median(broad[interior])))*.18
        pigment-=inc*6
        pigment-=float(pigment[interior].mean())
        a=np.array([190.,150.,100.])[None,None,:]+pigment[...,None]
        a=a*(1-rim[...,None])+np.array([98.,65.,41.])[None,None,:]*rim[...,None]
        pore=noise(rng,(256,256),(.35,.4))
        a+=pore[...,None]*.6
        micro=np.clip((ndi.gaussian_filter(lum,.5)-ndi.gaussian_filter(lum,2))/25,-1.5,1.5)*.12
        h=4.+micro+pore*.012-inc*1.65
        # Source facets drive shallow cut-face relief. No radial dome or disc
        # extrusion is encoded: the mesh already owns the cut-end geometry.
        facet=(ndi.gaussian_filter(lum,4)-ndi.gaussian_filter(lum,18))*.009
        h+=np.clip(facet,-.18,.18)*(1-rim)
        h=h*(1-rim)+4.*rim
        cavity=np.maximum(0,ndi.gaussian_filter(h,2)-h)*.5
        ao=np.clip(np.exp(-cavity-inc*.8),.23,1)
        rough=np.clip(.78+.09*rim+.02*np.tanh(pore)+.025*inc,.72,.94)
        x0=56+i*336; y0=5
        out[y0:y0+256,x0:x0+256]=a
        height[y0:y0+256,x0:x0+256]=h
        orm[y0:y0+256,x0:x0+256]=np.stack([ao*255,rough*255,np.zeros_like(ao)],axis=2)
        disc_mask[y0:y0+256,x0:x0+256]=(rad<=125)
        crack_all[y0:y0+256,x0:x0+256]=inc
        cells.append({'index':i+1,'bounds_half_open':[x0,1787,x0+256,2043],
                      'center_pixel_coordinates':[x0+127.5,1914.5],'radius_pixels':125,
                      'uv_bounds_edges':[x0/N,1787/N,(x0+256)/N,2043/N],
                      'source_center':[cx,cy]})
    return out,height,orm,disc_mask,crack_all,cells

def normals_from_saved_height(h):
    n=np.empty((N,N,3),np.float32)
    for y0,y1,name in BANDS:
        z=h[y0:y1]*HEIGHT_RANGE_MM
        dx=(np.roll(z,-1,1)-np.roll(z,1,1))/(2*MM_PER_PIXEL)
        dy=(np.roll(z,-1,0)-np.roll(z,1,0))/(2*MM_PER_PIXEL)
        v=np.stack([-dx,dy,np.ones_like(dx)],axis=2)
        n[y0:y1]=v/np.linalg.norm(v,axis=2,keepdims=True)
    z=h[1782:]*HEIGHT_RANGE_MM
    dy,dx=np.gradient(z,MM_PER_PIXEL)
    v=np.stack([-dx,dy,np.ones_like(dx)],axis=2)
    n[1782:]=v/np.linalg.norm(v,axis=2,keepdims=True)
    return n

def main():
    start=time.monotonic(); (ROOT/'checks').mkdir(exist_ok=True)
    base=np.zeros((N,N,3),np.float32); height=np.zeros((N,N),np.float32); orm=np.zeros_like(base)
    bark_full=np.zeros((N,N),np.float32); crack_full=np.zeros((N,N),np.float32)
    master_full=np.zeros_like(base); records=[]
    lichen_full=np.zeros_like(height); weather_full=np.zeros_like(height)
    # Four native 640px source windows per strip, spaced 512px apart.
    # A 128px minimum-error overlap joins every window, including the wrap.
    specs=[ [('bark_a',0,0),('bark_b',614,0),('bark_a',614,480),('bark_b',0,480)],
            [('peeled',0,0),('peeled',614,625),('peeled',0,625),('peeled',614,0)],
            [('sticks',0,40),('sticks',614,430),('sticks',0,820),('sticks',614,40)] ]
    cache={name:prepare(name) for name in KNOTS if name!='hewn'}
    for i,((y0,y1,kind),windows) in enumerate(zip(BANDS[:3],specs)):
        print('Building',kind,flush=True); h=y1-y0; ov=100
        patches=[cache[name][sy:sy+h+ov,sx:sx+640] for name,sx,sy in windows]
        z=np.empty((h+ov,N,6),np.float32)
        for j,a in enumerate(patches):
            x=j*512; previous=patches[(j-1)%4]
            z[:,x:x+128]=seam(previous[:,512:],a[:,:128])
            z[:,x+128:x+512]=a[:,128:512]
        top=seam(z[h:].transpose(1,0,2),z[:ov].transpose(1,0,2),True).transpose(1,0,2)
        master=np.roll(np.concatenate([top,z[ov:h]],axis=0),(h//3,377),(0,1))
        bcol,bheight,borm,bmask,inc,rec=build_band(master,kind,i)
        bcol,lichen_full[y0:y1],weather_full[y0:y1]=colour_wood(bcol,master,inc,kind,i)
        base[y0:y1]=bcol; height[y0:y1]=bheight; orm[y0:y1]=borm
        bark_full[y0:y1]=bmask; crack_full[y0:y1]=inc; master_full[y0:y1]=master[...,:3]
        rec.update({'name':kind,'rows_half_open':[y0,y1],'bark_fraction':float((bmask>.5).mean()),'source_windows':windows,'overlap_y':ov,'overlap_x':128})
        records.append(rec)
    print('Building cord',flush=True)
    cc,ch,co,ci,cord_fields,cord_record,cord_master=build_cord()
    base[1434:1782]=cc; height[1434:1782]=ch; orm[1434:1782]=co
    crack_full[1434:1782]=ci; master_full[1434:1782]=cord_master; records.append(cord_record)
    print('Registering cut ends',flush=True)
    ec,eh,eo,mask,cracks,cells=build_ends()
    base[1782:]=ec; height[1782:]=eh; orm[1782:]=eo; crack_full[1782:]=cracks
    master_full[1782:]=ec
    save_rgb(ROOT/'source/quilted_master_round3.png',master_full,True)
    Image.fromarray(u8(lichen_full*255)).save(ROOT/'source/lichen_mask_round3.png')
    Image.fromarray(u8(weather_full*255)).save(ROOT/'source/weather_mask_round3.png')
    save_rgb(ROOT/'wood_base.png',base,True)
    quant=np.rint(np.clip(height/HEIGHT_RANGE_MM,0,1)*65535).astype(np.uint16)
    Image.fromarray(quant).save(ROOT/'wood_height.png')
    delivered=np.array(Image.open(ROOT/'wood_height.png'),np.float32)/65535
    normal=normals_from_saved_height(delivered)
    save_rgb(ROOT/'wood_normal.png',(normal*.5+.5)*255)
    save_rgb(ROOT/'wood_orm.png',orm)
    np.savez_compressed(ROOT/'checks/feature_fields.npz',bark=bark_full,incisions=crack_full,disc_mask=mask,
                        lichen=lichen_full,weather=weather_full,**cord_fields)
    metadata={'seed':SEED,'size':[N,N],'tile_metres':[1.5,1.5],'mm_per_pixel':MM_PER_PIXEL,
              'height_range_mm':HEIGHT_RANGE_MM,'reference_height_mm':4.0,'normal_convention':'OpenGL: +X right, +Y image-up, +Z outward',
              'band_intervals':'half-open, top-origin pixel coordinates','bands':records,'end_cells':cells,
              'colour_revision':3,'bark_palette_rgb':{'bark_and_peeled':[105,71,46],'sticks':[124,87,55]},
              'fresh_wood_rgb':[185,145,95],'weathered_wood_rgb':[166,153,129],
              'end_face_rgb':[190,150,100],'end_rim_rgb':[98,65,41],
              'generated_sources':{},'build_seconds':time.monotonic()-start}
    for p in sorted((ROOT/'source').glob('generated_*.png')):
        metadata['generated_sources'][p.name]={'size':list(Image.open(p).size),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    (ROOT/'checks/construction.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print('Complete in %.2f seconds'%metadata['build_seconds'],flush=True)

if __name__=='__main__': main()
