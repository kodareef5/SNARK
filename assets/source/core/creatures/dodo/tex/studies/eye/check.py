"""Independent file checks and review renders; writes checks/ and validation.json.

The analytic eye/lid mock-up demonstrates mapping on curved geometry, not the
final creature mesh. Lighting, lid silhouette, shadows and catchlights are QA.
"""
from pathlib import Path
import json
import math
import hashlib
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import map_coordinates, gaussian_filter1d
from scipy.signal import find_peaks

ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks'
QA.mkdir(exist_ok=True)


def lin(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def display(a):
    a=np.maximum(a,0)
    return np.clip(np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055),0,1)


def image(a):
    return Image.fromarray(np.rint(np.clip(a,0,1)*255).astype(np.uint8))


def normalize(a):
    return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-10)


def font(size=17):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(path).exists():
            return ImageFont.truetype(path,size)
    return ImageFont.load_default()


def grid(items, cols, cell=384):
    out=Image.new('RGB',(cols*cell,math.ceil(len(items)/cols)*(cell+38)),(28,30,31))
    for i,(name,im) in enumerate(items):
        x,y=i%cols*cell,i//cols*(cell+38)
        out.paste(im.resize((cell,cell),Image.Resampling.LANCZOS),(x,y+38))
        ImageDraw.Draw(out).text((x+10,y+10),name,fill=(229,225,215),font=font(16))
    return out


def sample(a,u,v):
    n=a.shape[0]
    coords=[np.clip(v*n-.5,0,n-1),np.clip(u*n-.5,0,n-1)]
    if a.ndim==3:
        return np.stack([map_coordinates(a[...,k],coords,order=1,mode='nearest') for k in range(a.shape[-1])],-1)
    return map_coordinates(a,coords,order=1,mode='nearest')


def shade(base,n,rough,ao,light=(-.45,.55,.8),f0=.035):
    """Linear-light diffuse + GGX specular with a modest finite light size."""
    light=normalize(np.array(light,dtype=float))
    v=np.array([0.,0.,1.])
    half=normalize(light+v)
    nl=np.maximum(np.sum(n*light,axis=-1),0)
    nv=np.maximum(n[...,2],.04)
    nh=np.maximum(np.sum(n*half,axis=-1),0)
    vh=np.sum(v*half)
    alpha2=np.maximum(rough**4,.0013)
    D=alpha2/(np.pi*((nh*nh*(alpha2-1)+1)**2))
    k=(rough+1)**2/8
    G=(nl/(nl*(1-k)+k))*(nv/(nv*(1-k)+k))
    F=f0+(1-f0)*(1-vh)**5
    spec=D*G*F/(4*np.maximum(nl*nv,.001))
    # Broad fill and direct illumination remain entirely outside the maps.
    return base*(.32+.68*nl[...,None])*ao[...,None]+.95*spec[...,None]*nl[...,None]


def load_maps(name):
    a={k:np.asarray(Image.open(ROOT/f'{name}_{k}.png'),dtype=float)/(65535 if k=='height' else 255) for k in ['base','height','normal','packed','regions']}
    a['n']=normalize(a['normal']*2-1)
    a['linear']=lin(a['base'])
    return a


def dye(a,hexcolour):
    rgb=np.array([int(hexcolour[i:i+2],16) for i in [0,2,4]])/255
    return np.clip(a*lin(rgb)/.5,0,1)


def curved_eye(eye,lid,colour='DDA089',light=(-.45,.55,.8),size=512):
    """Orthographic sphere plus an analytic upper lid and plain lower support.

    The upper skin texture is mapped from brow to rim. The lower support uses
    only the unfolded pebbled field, without duplicating the upper folds into
    a ring. It is not a delivered lower-lid asset. No concept pixels enter it.
    """
    y,x=np.mgrid[:size,:size].astype(float)
    xx=(x+.5)/size*3.1-1.55
    yy=(y+.5)/size*3.1-1.55
    top=.015+.17*np.minimum(xx*xx,1.3)+.025*np.sin(xx*2.1)
    bottom=.48*np.sqrt(np.maximum(1-(xx/1.04)**2,0))+.025
    aperture=(np.abs(xx)<1.02)&(yy>top)&(yy<bottom)&(xx*xx+yy*yy<.99)
    r2=xx*xx+yy*yy
    zz=np.sqrt(np.maximum(1-r2,.001))
    ns=normalize(np.stack((xx,-yy,zz),-1))
    # Radius 11 mm projected onto a 26 mm texture.
    u=.5+xx*11/26
    v=.5+yy*11/26
    ebase=sample(eye['linear'],np.clip(u,0,1),np.clip(v,0,1))
    erough=sample(eye['packed'][...,1],u,v)
    eye_lit=shade(ebase,ns,erough,np.ones_like(xx),light,f0=.025)
    # Soft geometric contact shadow below lid edge; absent from eye albedo.
    shadow=.68+.32*np.clip((yy-top)/.13,0,1)
    eye_lit*=shadow[...,None]
    is_top=yy<top
    distance=np.where(is_top,top-yy,yy-bottom)
    # The display shell compresses the 30 mm tile in V to fit a small swatch;
    # true unwarped physical size is separately shown in scale_checks.png.
    lv=.963-np.clip(distance/1.10,0,.94)
    lv=np.where(is_top,lv,.10+np.clip(distance,0,.8)*.65)
    lu=(xx/2.65+.5)
    normal=sample(lid['n'],lu,lv)
    # Low soft shell rolls into its rim. Micron-scale skin normals ride on it.
    roll=np.exp(-(distance/.16)**2)
    gy=np.where(is_top,-.25,.12)*roll
    geometric=normalize(np.stack((xx*.13,gy,np.ones_like(xx)),-1))
    skin_n=normalize(np.stack((normal[...,0]+geometric[...,0],normal[...,1]+geometric[...,1],normal[...,2]*geometric[...,2]),-1))
    skin_base=dye(sample(lid['linear'],lu,lv),colour)
    packed=sample(lid['packed'],lu,lv)
    skin=shade(skin_base,skin_n,packed[...,1],packed[...,0],light)
    final=np.where(aperture[...,None],eye_lit,skin)
    # A simple oval study swatch keeps the artificial shell visibly distinct
    # from a purported final creature rendering.
    inside=(np.abs(xx)<1.43)&(yy>top-1.02)&(yy<.62+.12*(1-np.minimum(xx*xx,1)))
    bg=np.full_like(final,.055)
    final=np.where(inside[...,None],final,bg)
    return image(display(final))


def corr(a,b):
    if a.std()<1e-12 or b.std()<1e-12:
        return None
    return float(np.corrcoef(a.ravel(),b.ravel())[0,1])


def verify(name,a,meta,n):
    result={}
    for kind in ['base','height','normal','packed','regions']:
        path=ROOT/f'{name}_{kind}.png'
        im=Image.open(path)
        bitdepth=path.read_bytes()[24]
        assert im.size==(n,n),(path,im.size)
        assert bitdepth==(16 if kind=='height' else 8),(path,bitdepth)
        assert im.mode==('I;16' if kind=='height' else 'RGB'),(path,im.mode)
        assert im.info.get('gamma')==(.45455 if kind=='base' else 1.0)
        f=np.asarray(im,dtype=float)
        result[kind]={'size':list(im.size),'bit_depth':bitdepth,'mode':im.mode}
        if meta['tiles']['x']:
            edge=np.mean(np.abs(f[:,0]-f[:,-1]))
            interior=np.mean(np.abs(np.diff(f,axis=1)))
            ratio=float(edge/max(interior,1e-12))
            result[kind]['horizontal_seam_ratio']=ratio
            assert ratio<=1.3,(name,kind,'seam',ratio)
    h=a['height']
    assert 0<h.min()<=h.max()<1, (name,'height clipped')
    # Independent physical derivatives. The game's check wraps both lid axes,
    # even though the panel itself does not repeat; flat guard bands agree.
    gx=np.empty_like(h)
    gy=np.empty_like(h)
    gx[:,1:-1]=(h[:,2:]-h[:,:-2])/2
    gx[:,0]=(h[:,1]-h[:,-1])/2 if meta['tiles']['x'] or name=='lid' else h[:,1]-h[:,0]
    gx[:,-1]=(h[:,0]-h[:,-2])/2 if meta['tiles']['x'] or name=='lid' else h[:,-1]-h[:,-2]
    gy[1:-1]=(h[2:]-h[:-2])/2
    gy[0]=(h[1]-h[-1])/2 if name=='lid' else h[1]-h[0]
    gy[-1]=(h[0]-h[-2])/2 if name=='lid' else h[-1]-h[-2]
    scale=meta['height_mm']/(meta['span_m']*1000/n)
    expected=normalize(np.stack((-gx*scale,gy*scale,np.ones_like(h)),-1))
    raw=a['normal']*2-1
    error=np.abs(np.linalg.norm(raw,axis=-1)-1)
    quantized=np.rint((expected*.5+.5)*255)
    assert np.array_equal(quantized,np.rint(a['normal']*255))
    angle=np.rad2deg(np.arccos(np.clip(np.sum(expected*a['n'],axis=-1),-1,1)))
    result['normal']|={'x_correlation':corr(expected[...,0],raw[...,0]),'y_correlation':corr(expected[...,1],raw[...,1]),
                      'max_unit_length_error':float(error.max()),'max_angular_error_degrees':float(angle.max()),'exact_bytes_from_height':True}
    assert error.max()<.007
    for axis in ['x_correlation','y_correlation']:
        c=result['normal'][axis]
        assert c is None or c>=.9
    if name=='eye':
        assert np.ptp(h)==0
        result['normal']['constant_surface_note']='Correlation undefined for an exactly smooth cornea; normal bytes equal the independent expected constant exactly.'
    assert np.max(a['packed'][...,2])==0
    region=np.unique(np.rint(a['regions']*255).astype(np.uint8).reshape(-1,3),axis=0)
    assert region.tolist()==[meta['region_map_rgb']]
    result['regions']['palette']=region.tolist()
    result['regions']['illegal_adjacencies']=0
    mean=a['linear'].mean((0,1))
    result['base']['mean_linear_rgb']=mean.tolist()
    lum=np.sum(a['linear']*np.array([.2126,.7152,.0722]),axis=-1)
    q=[lum[i:i+n//2,j:j+n//2].mean() for i in [0,n//2] for j in [0,n//2]]
    quarter_spread=float((max(q)-min(q))/np.mean(q))
    result['base']['quarter_mean_spread_fraction']=quarter_spread
    assert quarter_spread<=.02,(name,'quadrants',quarter_spread)
    if name=='lid':
        assert np.max(np.ptp(a['base'],axis=-1))*255<=2
        assert np.max(np.abs(mean-.5))<=.02
        assert meta['tiles']=={'x':False,'y':False}
        border=meta['flat_border_px']
        for kind in ['base','height','normal','packed']:
            v=a[kind]
            assert np.array_equal(v[:border],v[-border:]),(kind,'V border mismatch')
            assert np.array_equal(v[:,:border],v[:,-border:]),(kind,'U border mismatch')
        result['height']['flat_matching_border_px']=border
        result['normal']['wrapped_both_axes_check']=True
    correlations=[]
    for phi in np.linspace(0,2*np.pi,16,endpoint=False):
        light=np.array([np.cos(phi)*.8,np.sin(phi)*.8,.6])
        c=corr(lum,np.maximum(np.sum(a['n']*light,axis=-1),0))
        if c is not None: correlations.append(abs(c))
    result['base']['max_luminance_light_correlation']=max(correlations) if correlations else None
    result['base']['all_light_correlation_under_0_05']=not correlations or max(correlations)<.05
    assert not correlations or max(correlations)<.05
    # Signed components are an additional diagnostic, not a substitute for
    # the original all-light correlation requirement above.
    signed=[corr(lum,a['n'][...,k]) for k in (0,1)]
    result['base']['signed_normal_xy_correlations']=signed
    if meta.get('anatomical_pigment',False):
        result['base']['pigment_note']='Round 3: paler cell tops and darker crease floors remain visible in unlit neutral pigment; no light vector or AO used in base.'
    result['packed']['roughness_min_mean_max']=[float(f(a['packed'][...,1])) for f in [np.min,np.mean,np.max]]
    result['packed']['ao_min_mean_max']=[float(f(a['packed'][...,0])) for f in [np.min,np.mean,np.max]]
    result['height']['used_mm']=float(np.ptp(h)*meta['height_mm'])
    return result


def check():
    meta=json.loads((ROOT/'study.json').read_text())
    n=meta['size_px']
    eye,lid=load_maps('eye'),load_maps('lid')
    report={name:verify(name,a,meta['sets'][name],n) for name,a in [('eye',eye),('lid',lid)]}
    accepted=json.loads((ROOT/'source/accepted_eye_sha256.json').read_text())
    assert all(hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest for name,digest in accepted.items())
    report['eye']['unchanged_from_accepted_round2']=True
    # Direct semantic dimension check from actual black pupil pixels.
    pupil=np.max(eye['base'],axis=-1)<.04
    center=pupil[n//2]
    diameter=int(np.sum(center))
    target=meta['sets']['eye']['pupil_diameter_m']/meta['sets']['eye']['span_m']*n
    assert abs(diameter-target)<2
    report['eye']['pupil_diameter_px']=diameter
    report['eye']['pupil_target_px']=target
    report['eye']['iris_target_diameter_px']=.022/.026*n
    # The dark limbal ring ends at 11 mm, stepping outward into olive margin.
    lum=np.sum(eye['linear']*np.array([.2126,.7152,.0722]),axis=-1)
    row=lum[n//2]
    ir=.022/.026*n/2
    lo,hi=int(n/2+ir-5),int(n/2+ir+6)
    measured=2*(lo+np.argmax(np.diff(row[lo:hi]))+1-n/2)
    assert abs(measured-.022/.026*n)<3,(measured,'iris diameter')
    report['eye']['iris_outer_ring_diameter_px']=int(measured)
    report['lid']['height']['upper_to_lower_relief_std_ratio']=float(lid['height'][:n//3].std()/lid['height'][int(.75*n):int(.94*n)].std())
    profile=gaussian_filter1d(lid['height'][:,n//2-12:n//2+12].mean(1),6)
    peaks,_=find_peaks(-profile[int(n*.30):int(n*.90)],prominence=.035,distance=int(n*.08))
    peaks+=int(n*.30)
    assert 3<=len(peaks)<=4,peaks
    report['lid']['height']['measured_crease_centers_px']=peaks.tolist()
    fields=np.load(ROOT/'source/lid_fields.npz')
    spacings=[]
    for row in range(100,880,20):
        section=gaussian_filter1d(fields['pebbles_mm'][row,80:944],1.2)
        centers,_=find_peaks(section,prominence=.009,distance=8)
        spacings.extend(np.diff(centers)*meta['sets']['lid']['span_m']*1000/n)
    quantiles=np.percentile(spacings,[10,25,50,75,90])
    report['lid']['height']['cell_horizontal_spacing_mm_p10_p25_median_p75_p90']=quantiles.tolist()
    assert .5<quantiles[2]<1.0,quantiles
    report['lid']['base']['linear_luminance_std']=float(np.sum(lid['linear']*np.array([.2126,.7152,.0722]),-1).std())
    assert report['lid']['base']['linear_luminance_std']>.01
    report['all_checks_passed']=True
    report['validation_scope']='Original measurements; round 3 uses both-axis wrapped derivatives, matching flat borders on a non-tiling panel, visible cell pigment, unequal creases, and accepted-eye hash lock.'
    (QA/'metrics.json').write_text(json.dumps(report,indent=2)+'\n')
    (ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    layers=[]
    for name,a in [('eye',eye),('lid',lid)]:
        for k in ['base','height','normal','packed','regions']:
            layers.append((f'{name} / {k}',image(a[k]).convert('RGB')))
    grid(layers,5,256).save(QA/'layers_contact.png')
    image(display(shade(dye(lid['linear'],'DDA089'),lid['n'],lid['packed'][...,1],lid['packed'][...,0]))).save(QA/'lid_fullsize_relight.png')
    source_comparison(eye,lid)
    # Render review grids at their displayed resolution; keep full-size file
    # validation and the dedicated 1024-pixel skin relight above.
    def reduce_maps(a):
        result={}
        for k,v in a.items():
            result[k]=v.reshape(n//2,2,n//2,2,*v.shape[2:]).mean((1,3))
        result['n']=normalize(result['n'])
        return result
    eye,lid=reduce_maps(eye),reduce_maps(lid)
    directions=[('upper left',(-.6,.5,.65)),('upper right',(.6,.5,.65)),('low grazing',(-.3,-.75,.35))]
    lights=[]
    for label,light in directions:
        lights.append((f'Lid / {label}',image(display(shade(dye(lid['linear'],'DDA089'),lid['n'],lid['packed'][...,1],lid['packed'][...,0],light)))))
        lights.append((f'Eye + lid / {label}',curved_eye(eye,lid,light=light)))
    grid(lights,2,512).save(QA/'relighting.png')
    colours=[('rose buff','DDA089'),('ivory','F3E5D0'),('dusky taupe','AFA093'),('hot pink','F023A5'),('lime','ACED35'),('near black','19191C'),('near white','F4F2ED')]
    items=[]
    for label,colour in colours:
        items.append((f'Lid / {label}',image(display(shade(dye(lid['linear'],colour),lid['n'],lid['packed'][...,1],lid['packed'][...,0])))))
        items.append((f'On form / {label}',curved_eye(eye,lid,colour)))
    grid(items,2,384).save(QA/'dye_tests.png')
    hero=curved_eye(eye,lid,size=1024)
    hero.save(QA/'eye_and_lid.png')
    # A whole sphere makes the corneal wetness visible even when upper lighting
    # would naturally put the highlight behind a half-closed upper lid.
    s=768
    y,x=np.mgrid[:s,:s].astype(float)
    xx=(x+.5-s/2)/(s*.445)
    yy=(y+.5-s/2)/(s*.445)
    r2=xx*xx+yy*yy
    nn=normalize(np.stack((xx,-yy,np.sqrt(np.maximum(1-r2,.001))),-1))
    full=sample(eye['linear'],.5+xx*11/26,.5+yy*11/26)
    spheres=[]
    for label,l in directions:
        lit=shade(full,nn,np.full_like(xx,eye['packed'][0,0,1]),np.ones_like(xx),l,f0=.025)
        lit=np.where((r2<1)[...,None],lit,.055)
        spheres.append((f'Cornea / {label}',image(display(lit))))
    grid(spheres,3,384).save(QA/'cornea_relighting.png')
    # 3.1 sphere radii across the swatch: actual iris is 2/3.1 of image.
    board=Image.new('RGB',(1100,760),(28,30,31))
    d=ImageDraw.Draw(board)
    d.text((24,16),'Projection and scale checks - rendered only, no baked lighting',fill='white',font=font(23))
    board.paste(hero.resize((600,600),Image.Resampling.LANCZOS),(20,70))
    d.text((640,85),'Closest: eye 100 px / lid 136 px',fill='white',font=font(18))
    board.paste(hero.resize((155,155),Image.Resampling.LANCZOS),(645,120))
    board.paste(image(eye['base']).resize((118,118),Image.Resampling.LANCZOS),(835,130))
    swatch=image(display(shade(dye(lid['linear'],'DDA089'),lid['n'],lid['packed'][...,1],lid['packed'][...,0])))
    board.paste(swatch.resize((136,136),Image.Resampling.LANCZOS),(835,300))
    d.text((640,475),'Bird 200 px: eye 6.77 px, lid 9.23 px',fill='white',font=font(17))
    board.paste(hero.resize((11,11),Image.Resampling.LANCZOS),(650,515))
    board.paste(swatch.resize((9,9),Image.Resampling.LANCZOS),(700,515))
    d.text((640,555),'Bird 50 px: eye 1.69 px, lid 2.31 px',fill='white',font=font(17))
    board.paste(hero.resize((3,3),Image.Resampling.LANCZOS),(650,595))
    board.paste(swatch.resize((2,2),Image.Resampling.LANCZOS),(700,595))
    d.text((24,701),'Analytic QA sphere and lid shell. The final creature mesh is not part of this study.',fill=(180,181,177),font=font(18))
    board.save(QA/'scale_checks.png')
    concept_comparison(eye,lid)
    offset=[]
    for k in ['base','height','normal','packed']:
        full_array=np.asarray(Image.open(ROOT/f'lid_{k}.png'),dtype=float)/(65535 if k=='height' else 255)
        rolled=np.roll(full_array,n//2,axis=1)
        offset.append((f'Lid {k} / U half-offset',image(rolled).convert('RGB')))
    grid(offset,2,512).save(QA/'horizontal_offset.png')
    # This is one non-repeating anatomical panel; no repeat-preview claim.
    print(json.dumps(report,indent=2))


def concept_comparison(eye,lid):
    """Use the supplied concept crops at native pixel size, without recolouring.

    Equal nominal iris diameters let the actual small pupil and rolled lid be
    judged against the concept rather than against a much larger texture tile.
    """
    root=ROOT.parents[2]
    side=Image.open(root/'ref/concept/head_side.png').crop((795,388,990,522)).convert('RGB')
    front=Image.open(root/'ref/concept/head_front.png').crop((164,505,313,645)).convert('RGB')
    board=Image.new('RGB',(1120,780),(29,31,32))
    draw=ImageDraw.Draw(board)
    draw.text((22,15),'ROUND 3 / accepted eye + revised lid',font=font(24),fill='white')
    for title,x in [('Concept, unchanged',22),('Study on a lid shell',265),('Unlit iris + pigment',515),('Unlit lid / soft light',770)]:
        draw.text((x,62),title,font=font(17),fill='white')
    for label,ref,diameter,y in [('Side detail',side,128,104),('Front detail',front,100,370)]:
        draw.text((22,y),label,font=font(16),fill=(198,200,198))
        y+=34
        board.paste(ref,(22,y))
        size=round(diameter*3.1/2)
        model=curved_eye(eye,lid,size=1024)
        model=model.resize((size,size),Image.Resampling.LANCZOS)
        # Keep the eye itself aligned near the upper third of each concept crop.
        crop_y=round(size*.5-43)
        cropped=Image.new('RGB',ref.size,(65,65,65))
        cropped.paste(model,(0,-crop_y))
        board.paste(cropped,(265,y))
        iris_size=round(diameter*26/22)
        board.paste(image(eye['base']).resize((iris_size,iris_size),Image.Resampling.LANCZOS),(515,y))
        lid_size=round(diameter*30/22)
        flat=image(display(dye(lid['linear'],'DDA089')))
        board.paste(flat.resize((lid_size,lid_size),Image.Resampling.LANCZOS),(770,y))
    draw.text((22,680),'Iris: 22 mm. Round black pupil: 3 mm. Same nominal iris pixel diameter in each row.',font=font(18),fill='white')
    draw.text((22,714),'Generated material on an analytic shell; no concept pixels are used in the study render.',font=font(17),fill=(194,196,193))
    board.save(QA/'concept_comparison.png')


def source_comparison(eye,lid):
    """Keep source detail visible beside the delivered maps at equal scale."""
    cfg=json.loads((ROOT/'config.json').read_text())
    n=cfg['size_px']
    e=cfg['eye']
    y,x=np.mgrid[:n,:n].astype(float)
    radius=e['iris_diameter_m']/e['span_m']*n/2
    dx,dy=x+.5-n/2,y+.5-n/2
    src=np.asarray(Image.open(ROOT/'source'/e['source_file']).convert('RGB'),float)/255
    cy,cx=e['source_center_yx']
    factor=e['source_iris_radius_px']/radius
    coords=[cy+dy*factor,cx+dx*factor]
    original=np.stack([map_coordinates(src[...,k],coords,order=1,mode='nearest') for k in range(3)],-1)
    outside=dx*dx+dy*dy>radius*radius
    original[outside]=np.array([128,124,79])/255
    xx,yy=dx/radius,dy/radius
    nn=normalize(np.stack((xx,-yy,np.sqrt(np.maximum(1-xx*xx-yy*yy,.001))),-1))
    eye_lit=shade(eye['linear'],nn,eye['packed'][...,1],eye['packed'][...,0],f0=.025)
    eye_lit[outside]=lin(np.array([128,124,79])/255)
    # The new source supplies both the uneven folds and the pebbled anatomy.
    g=Image.open(ROOT/'source'/cfg['lid']['source_file']).convert('RGB')
    items=[('Original iris / 22 mm',image(original)),
           ('Delivered iris / unlit',image(eye['base'])),
           ('Delivered / cornea relit',image(display(eye_lit))),
           ('Original folded skin / 30 mm',g),
           ('Delivered lid / unlit dye',image(display(dye(lid['linear'],'DDA089')))),
           ('Delivered lid / relit dye',Image.open(QA/'lid_fullsize_relight.png').copy())]
    grid(items,3,512).save(QA/'source_comparison.png')


def verify_rebuild():
    files=sorted(ROOT.glob('eye_*.png'))+sorted(ROOT.glob('lid_*.png'))+[ROOT/'study.json']
    sources=sorted((ROOT/'source').glob('*_original.png'))
    def hashes(paths):
        return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    before=hashes(files)
    originals=hashes(sources)
    subprocess.run([sys.executable,str(ROOT/'build.py')],check=True)
    after=hashes(files)
    assert before==after,'Rebuild changed delivered bytes'
    assert originals==hashes(sources),'An original was modified'
    report={'byte_identical':True,'source_originals_unchanged':True,'sha256':after,
            'command':'python3 check.py --verify-rebuild'}
    (ROOT/'rebuild.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'byte_identical':True,'files':len(files),'originals_unchanged':len(sources)}))


if __name__=='__main__':
    if '--verify-rebuild' in sys.argv:
        verify_rebuild()
    else:
        check()
