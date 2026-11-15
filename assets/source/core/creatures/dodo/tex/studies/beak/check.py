"""Validate the delivered PNGs independently and make disposable review images.

Run after build.py. All outputs live in checks/. Does not modify the material.
"""
from pathlib import Path
import argparse
import json
import math
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import binary_erosion, distance_transform_edt, gaussian_filter

ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks'
N=2048
COLORS={'olive':'989260','pale horn':'B4A37C','slate':'52565C','charcoal':'2D3138','umber':'614629',
        'moss':'736D3B','oxblood':'6E321C',
        'lime':'91E42D','hot pink':'F149A7','near black':'101217','near white':'ECECE7'}


def linear(a):
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.maximum(a,0)
    return np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)


def font(size=20):
    for p in ['/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Helvetica.ttc']:
        if Path(p).exists():
            return ImageFont.truetype(p,size)
    return ImageFont.load_default()


def rgb(a):
    return Image.fromarray(np.uint8(np.clip(np.rint(a*255),0,255)))


def composite(a,alpha,bg=(.12,.13,.14)):
    return a*alpha[:,:,None]+np.array(bg)*(1-alpha[:,:,None])


def grid(items, cols=3, size=512, title=None):
    top=70 if title else 0
    out=Image.new('RGB',(cols*size,math.ceil(len(items)/cols)*(size+40)+top),(25,27,29))
    d=ImageDraw.Draw(out)
    if title:
        d.text((22,20),title,font=font(24),fill=(236,232,221))
    for i,(name,im) in enumerate(items):
        x,y=i%cols*size,i//cols*(size+40)+top
        out.paste(im.resize((size,size),Image.Resampling.LANCZOS),(x,y+40))
        d.text((x+14,y+10),name,font=font(18),fill=(220,220,213))
    return out


def load(name):
    a={}
    for layer in ['base','height','normal','packed','regions']:
        p=ROOT/f'{name}_{layer}.png'
        im=Image.open(p)
        a[layer]=np.asarray(im)
    a['alpha']=a['base'][:,:,3].astype(np.float32)/255 if a['base'].shape[-1]==4 else np.ones((N,N),np.float32)
    return a


def render(a,color='olive',light=(-.60,.45,.75),proxy=False):
    base=linear(a['base'][:,:,:3].astype(np.float32)/255)
    dye=linear(np.array([int(COLORS[color][i:i+2],16) for i in (0,2,4)],np.float32)/255)
    diffuse=base*dye/.5
    norm=a['normal'].astype(np.float32)/127.5-1
    norm/=np.linalg.norm(norm,axis=-1,keepdims=True)
    if proxy:
        # Display only: a broad convex profile suggests the modeller's volume.
        # Never exported to any material map, and labelled explicitly in review.
        # Elliptical vertical cross-sections for each jaw: a laterally flattened
        # shell, continuous into the root. These are DISPLAY normals only.
        yy=np.arange(N,dtype=np.float32)[:,None]
        macro=np.zeros((N,N),np.float32)
        for jaw in ['upper','lower']:
            mask=np.asarray(Image.open(ROOT/f'source/beak_{jaw}_mask.png'))>=128
            top=np.argmax(mask,axis=0).astype(np.float32)
            bottom=(N-1-np.argmax(mask[::-1],axis=0)).astype(np.float32)
            radius=np.maximum((bottom-top)/2,1)
            t=(yy-(top+bottom)[None,:]/2)/radius[None,:]
            depth=np.minimum(radius*.68,245)[None,:]*np.sqrt(np.maximum(1-t*t,0))
            macro+=depth*mask
        macro=gaussian_filter(macro,10)
        gy,gx=np.gradient(macro)
        norm[:,:,0]-=gx
        norm[:,:,1]+=gy
        norm/=np.linalg.norm(norm,axis=-1,keepdims=True)
    light=np.array(light,np.float32)
    light/=np.linalg.norm(light)
    nl=np.maximum(np.sum(norm*light,axis=-1),0)
    nv=np.maximum(norm[:,:,2],.03)
    half=light+np.array([0,0,1],np.float32)
    half/=np.linalg.norm(half)
    nh=np.maximum(np.sum(norm*half,axis=-1),0)
    vh=max(half[2],.01)
    rough=a['packed'][:,:,1].astype(np.float32)/255
    alpha=np.maximum(rough**2,.03)
    alpha2=alpha**2
    distribution=alpha2/(np.pi*np.maximum((nh*nh*(alpha2-1)+1)**2,1e-6))
    k=(rough+1)**2/8
    g=(nl/(nl*(1-k)+k))*(nv/(nv*(1-k)+k))
    fresnel=.04+.96*(1-vh)**5
    spec=distribution*g*fresnel/np.maximum(4*nl*nv,.001)
    ao=a['packed'][:,:,0].astype(np.float32)/255
    color=diffuse*(.20+.80*nl[:,:,None])*ao[:,:,None]+spec[:,:,None]*nl[:,:,None]*.9
    return rgb(composite(srgb(color),a['alpha']))


def unlit(a,color=None):
    base=linear(a['base'][:,:,:3].astype(np.float32)/255)
    if color:
        dye=linear(np.array([int(COLORS[color][i:i+2],16) for i in (0,2,4)],np.float32)/255)
        base*=dye/.5
    return rgb(composite(srgb(base),a['alpha']))


def pearson(x,y):
    x,y=x.astype(np.float64),y.astype(np.float64)
    x-=x.mean();y-=y.mean()
    den=np.sqrt(np.sum(x*x)*np.sum(y*y))
    return float(np.sum(x*y)/den) if den>1e-12 else 0.0


def verify(name,a,spec):
    report={}
    mask=np.all(a['regions']==[0,0,255],axis=-1)
    core=binary_erosion(mask,iterations=3) if not spec['tiles'] else mask
    failures=[]
    for layer in ['base','height','normal','packed','regions']:
        p=ROOT/f'{name}_{layer}.png'
        im=Image.open(p)
        bits=p.read_bytes()[24]
        report[layer]=dict(size=list(im.size),mode=im.mode,bits=bits,gamma=im.info.get('gamma'))
        if im.size!=(N,N): failures.append(layer+': size')
        if bits!=(16 if layer=='height' else 8): failures.append(layer+': bit depth')
        if layer=='base' and im.info.get('srgb')!=0: failures.append('base: missing sRGB tag')
        if spec['tiles']:
            data=a[layer].astype(np.float32)
            jumps={}
            for axis in [0,1]:
                ordinary=np.abs(np.diff(data,axis=axis)).mean()
                seam=np.abs(np.take(data,0,axis=axis)-np.take(data,-1,axis=axis)).mean()
                ratio=float(seam/max(ordinary,1e-9))
                jumps['y' if axis==0 else 'x']=ratio
                if ratio>1.3: failures.append(layer+': seam jump')
            report[layer]['seam_ratio']=jumps
    region=a['regions'].astype(np.uint32)
    keys,counts=np.unique((region[:,:,0]<<16)+(region[:,:,1]<<8)+region[:,:,2],return_counts=True)
    colors=np.stack(((keys>>16)&255,(keys>>8)&255,keys&255),axis=-1)
    report['region_counts']={str(tuple(map(int,c))):int(n) for c,n in zip(colors,counts)}
    if not all(tuple(c) in [(0,0,0),(0,0,255)] for c in colors): failures.append('region palette')
    report['non_neighbor_contacts']=0 # The only classes are blue and black.
    if not np.array_equal(mask,a['alpha']>=.5): failures.append('region/alpha agreement')
    base=a['base'][:,:,:3]
    neutral=int(np.max(np.ptp(base[mask].astype(np.int16),axis=-1)))
    report['neutral_max_channel_difference']=neutral
    if neutral>2: failures.append('base neutrality')
    lum=linear(base.astype(np.float32)/255).mean(axis=-1)
    report['mean_linear']=float(lum[mask].mean())
    report['mean_srgb']=float(base[mask].mean())
    if abs(report['mean_linear']-.5)>.02: failures.append('regional mean')
    quarters=[]
    for iy in range(2):
        for ix in range(2):
            sl=np.s_[iy*N//2:(iy+1)*N//2,ix*N//2:(ix+1)*N//2]
            quarters.append(float(lum[sl][mask[sl]].mean()))
    report['dyed_quarter_means_linear']=quarters
    report['quarter_relative_spread']=(max(quarters)-min(quarters))/report['mean_linear']
    if report['quarter_relative_spread']>.02: failures.append('quadrant means')
    h=a['height'].astype(np.float32)/65535*spec['height_mm']
    pitch=spec['span_m']*1000/N
    if spec['tiles']:
        dx=(np.roll(h,-1,axis=1)-np.roll(h,1,axis=1))/(2*pitch)
        dy=(np.roll(h,-1,axis=0)-np.roll(h,1,axis=0))/(2*pitch)
    else:
        dy,dx=np.gradient(h,pitch)
    expected=np.stack((-dx,dy,np.ones_like(dx)),axis=-1)
    expected/=np.linalg.norm(expected,axis=-1,keepdims=True)
    actual=a['normal'].astype(np.float32)/127.5-1
    unit_error=np.max(np.abs(np.linalg.norm(actual,axis=-1)-1))
    enc=np.uint8(np.clip(np.rint((expected*.5+.5)*255),0,255))
    byte_error=int(np.max(np.abs(enc.astype(np.int16)-a['normal'].astype(np.int16))))
    corrs=[pearson(expected[:,:,i][core][::4],actual[:,:,i][core][::4]) for i in [0,1]]
    report['normal_height']={'x_correlation':corrs[0],'y_correlation':corrs[1],
                             'max_unit_length_error':float(unit_error),'max_byte_difference':byte_error}
    if min(corrs)<.9 or unit_error>.008 or byte_error>1: failures.append('normal/height agreement')
    # Signed directional covariance and Lambert tests, over true material pixels.
    normalized=actual[core][::16].copy()
    normalized/=np.linalg.norm(normalized,axis=-1,keepdims=True)
    sample_lum=lum[core][::16]
    light_corr=[]
    for elevation in [25,50,75]:
        for azimuth in np.arange(0,360,45):
            az,el=np.deg2rad([azimuth,elevation])
            light=np.array([np.cos(az)*np.cos(el),np.sin(az)*np.cos(el),np.sin(el)])
            caught=np.maximum(np.sum(normalized*light,axis=-1),0)
            c=pearson(sample_lum,caught)
            light_corr.append(float(c))
    report['base_light_max_abs_correlation']=float(max(map(abs,light_corr)))
    report['base_light_rms_correlation']=float(np.sqrt(np.mean(np.square(light_corr))))
    if report['base_light_max_abs_correlation']>.10: failures.append('base vs normal lighting correlation')
    report['roughness_percentiles']=np.percentile(a['packed'][:,:,1][mask]/255,[0,5,50,95,100]).tolist()
    report['ao_percentiles']=np.percentile(a['packed'][:,:,0][mask]/255,[0,5,50,95,100]).tolist()
    report['ao_mean']=float(a['packed'][:,:,0][mask].mean()/255)
    report['normal_xy_rms']=float(np.sqrt(np.mean(actual[:,:,:2][mask]**2)))
    report['height_std_mm']=float(h[mask].std())
    if spec['tiles']:
        drift=gaussian_filter(lum,12,mode='wrap')
        report['base_lowpass12_std']=float(drift.std())
        report['base_lowpass12_gradient_x_over_y']=float(np.std(np.diff(drift,axis=1))/np.std(np.diff(drift,axis=0)))
    report['metalness_max']=int(a['packed'][:,:,2].max())
    if report['metalness_max']!=0: failures.append('metalness')
    catalogue=json.loads((ROOT/('source/horn_pores.json' if name=='horn' else 'source/beak_pores.json')).read_text())
    pores=np.asarray(catalogue['pores'])
    report['authored_craters']={
        'count':len(pores),'note':'Additional side craters only; side also samples the horn tile.' if name=='beak_side' else 'Periodic tile catalogue.',
        'diameter_mm_percentiles':np.percentile(pores[:,2],[0,25,50,75,90,95,100]).tolist(),
        'count_1_to_2_mm':int(np.count_nonzero(pores[:,2]>=1)),
        'soft_count':int(np.count_nonzero(pores[:,7]>.5))}
    if name=='beak_side':
        wear=np.asarray(Image.open(ROOT/'source/beak_wear.png'))/255
        worn=mask&(wear>.65)
        fresh=mask&(wear<.1)
        report['wear']={'worn_mean_linear':float(lum[worn].mean()),'unworn_mean_linear':float(lum[fresh].mean()),
                        'worn_roughness':float(a['packed'][:,:,1][worn].mean()/255),
                        'unworn_roughness':float(a['packed'][:,:,1][fresh].mean()/255)}
        groove=np.asarray(Image.open(ROOT/'source/beak_grooves.png'))/255
        nostril=np.asarray(Image.open(ROOT/'source/beak_nostril.png'))/255
        plain=core&(wear<.05)&(groove<.01)&(nostril<.01)
        report['unworn_quarter_means_linear']=[]
        for iy in range(2):
            for ix in range(2):
                sl=np.s_[iy*N//2:(iy+1)*N//2,ix*N//2:(ix+1)*N//2]
                sample=lum[sl][plain[sl]]
                report['unworn_quarter_means_linear'].append(float(sample.mean()) if sample.size else None)
        if report['wear']['worn_mean_linear']<=report['wear']['unworn_mean_linear']: failures.append('pale wear')
        if report['wear']['worn_roughness']>=report['wear']['unworn_roughness']: failures.append('smooth wear')
        # All transparent pixels carry nearest material color, not black backing.
        idx=distance_transform_edt(~mask,return_distances=False,return_indices=True)
        report['transparent_rgb_nearest_edge_max_error']=int(np.abs(base[~mask].astype(np.int16)-base[tuple(idx[:,~mask])].astype(np.int16)).max())
        if report['transparent_rgb_nearest_edge_max_error']>0: failures.append('edge dilation')
    # Preserve the raw COMMON verdict. Round 3 prioritizes the explicit request
    # to remove the dark compensation around the pale hook; global normalization
    # leaves honest quadrant differences from intentional wear. Do not conceal
    # those differences by calling the raw quadrant check a pass.
    report['common_failures']=list(failures)
    report['common_checks_passed']=not failures
    report['declared_deviations']=[]
    if name=='beak_side' and 'quadrant means' in failures:
        report['declared_deviations'].append('Raw quadrant means differ because of authored pale wear. Global 0.50 regional normalization replaces the local compensation rejected in round 3.')
        failures.remove('quadrant means')
    report['failures']=failures
    report['passed']=not failures
    return report


def reviews(name,a,spec):
    alpha=a['alpha']
    layers=[]
    for k in ['base','height','normal','packed','regions']:
        data=a[k]
        if k=='height': data=np.repeat((data.astype(np.float32)/65535)[:,:,None],3,axis=-1)
        else: data=data[:,:,:3].astype(np.float32)/255
        layers.append((f'{name} / {k}',rgb(composite(data,alpha))))
    rough=np.repeat((a['packed'][:,:,1]/255)[:,:,None],3,axis=-1)
    layers.append((name+' / roughness',rgb(composite(rough,alpha))))
    grid(layers,3,430,'ALIGNED MAPS | base is unlit; all data layers are linear').save(QA/f'{name}_layers.png')
    views=[]
    for label,light in [('Left / high',(-.62,.45,.68)),('Right / low',(.70,-.28,.55)),('Top / raking',(.05,.90,.36))]:
        im=render(a,'olive',light)
        views.append((label,im))
        im.save(QA/f'{name}_relight_{label.split()[0].lower()}.png')
    grid(views,3,512,'RELIGHT | delivered normals + AO + roughness, no added shape').save(QA/f'{name}_relighting.png')
    dyes=[(label,render(a,label)) for label in COLORS]
    grid(dyes,4,410,'DYE TEST | linear dye divided by region mean 0.50').save(QA/f'{name}_dyes.png')
    if spec['tiles']:
        offset=[]
        for layer in ['base','height','normal','packed']:
            im=a[layer]
            if layer=='height': im=np.uint8(np.rint(im/257))
            im=np.roll(im,(N//2,N//2),axis=(0,1))
            Image.fromarray(im).save(QA/f'horn_{layer}_half_offset.png')
            offset.append((layer+' / half offset',Image.fromarray(im).convert('RGB')))
        grid(offset,2,600,'WRAP CHECK | original joins pass through the centre').save(QA/'horn_offsets.png')
        relit=np.asarray(render(a))
        Image.fromarray(np.tile(relit,(2,2,1))).resize((1600,1600),Image.Resampling.LANCZOS).save(QA/'horn_repeat_2x2.png')
        source_comparison(a)
    else:
        boxes=[('Three rounded growth rings',(310,520,822,1032)),('Nostril and cutting edge',(450,870,962,1382)),
               ('Smooth hook / scuffs',(1360,1040,1872,1552)),('Lower bill',(220,1000,732,1512))]
        relit=render(a,'olive')
        base_display=rgb(composite(a['base'][:,:,:3].astype(np.float32)/255,alpha))
        items=[]
        for label,box in boxes:
            items.append((label,relit.crop(box)))
            items.append((label+' / neutral base',base_display.crop(box)))
        grid(items,4,512,'DETAIL | 1:1 pixels from 2048 exports').save(QA/'beak_details.png')
        # Model-volume interpretation is explicitly separate from material-only checks.
        hero=render(a,'olive',(.45,.65,.7),proxy=True)
        hero.save(QA/'beak_proxy.png')
        grid([('Olive / volume preview',hero),('Lime / volume preview',render(a,'lime',proxy=True))],2,720,
             'FORM PREVIEW | broad proxy curvature added only for this image').save(QA/'beak_form_preview.png')
        sizes(a,hero)
        concept_comparison(a,hero)


def source_comparison(a):
    original=Image.open(ROOT/'source/horn_r2b_generated.png').convert('RGB')
    # This patch lies beyond BOTH periodic overlaps: its coordinate mapping is
    # exact, allowing a source-to-export comparison at the original pixel scale.
    p=int(min(original.size)*.80)
    box=(300,300,680,680)
    mapped=tuple(round(v*N/p) for v in box)
    items=[('Untouched generated source',original.crop(box)),
           ('Delivered neutral base',unlit(a).crop(mapped)),
           ('Delivered olive / relit',render(a).crop(mapped))]
    grid(items,3,570,'SOURCE REVISION | same physical patch; clouds reduced, fine drawing retained, crisp craters added').save(QA/'source_preservation.png')


def concept_comparison(a,hero,palette=True):
    root=ROOT.parents[2]
    concept=Image.open(root/'ref/concept/head_side.png').convert('RGB')
    reference=concept.crop((118,322,795,807)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    # Invert the unchanged traced layout. Each panel is 677 x 485, exactly the
    # concept's pixel scale; no camera or magnification advantage for the study.
    box=(107,365,1901,1650)
    target=(677,485)
    alpha=Image.fromarray(np.uint8(a['alpha']*255)).crop(box).resize(target,Image.Resampling.LANCZOS)
    bg=tuple(np.asarray(concept)[30,30])
    reference.putalpha(alpha)
    panels=[('Our concept / reflected to face left',reference),
            ('Round 4 / olive, unlit base',unlit(a,'olive').crop(box).resize(target,Image.Resampling.LANCZOS)),
            ('Round 4 / olive, relit on form proxy',hero.crop(box).resize(target,Image.Resampling.LANCZOS))]
    out=Image.new('RGB',(3*697+20,650),(25,27,29))
    d=ImageDraw.Draw(out)
    d.text((20,18),'SAME SIZE | concept and delivered olive beak — 677 pixels wide',font=font(25),fill=(238,234,222))
    for i,(label,im) in enumerate(panels):
        patch=Image.new('RGB',target,bg)
        if i: im.putalpha(alpha)
        patch.paste(im,(0,0),im.getchannel('A'))
        x=20+i*697
        d.text((x,76),label,font=font(20),fill=(231,228,217))
        out.paste(patch,(x,115))
    d.text((20,620),'Only the review adds broad form normals. Exported maps contain material relief; the modeller supplies the beak volume.',font=font(18),fill=(201,201,197))
    out.save(QA/'concept_comparison.png')
    # Also compare the actual flat material render, with no proxy normals.
    material=render(a)
    material.save(QA/'beak_side_olive_material_only.png')
    material=material.crop(box).resize(target,Image.Resampling.LANCZOS)
    material.putalpha(alpha)
    flat=Image.new('RGB',(1414,630),(25,27,29)); fd=ImageDraw.Draw(flat)
    fd.text((20,18),'SAME SIZE | concept beside olive material-only relight',font=font(25),fill=(238,234,222))
    for i,(label,im) in enumerate([('Our concept',reference),('Delivered normals / AO / roughness; flat plane',material)]):
        patch=Image.new('RGB',target,bg); patch.paste(im,(0,0),alpha)
        fd.text((20+i*697,76),label,font=font(20),fill=(231,228,217))
        flat.paste(patch,(20+i*697,115))
    flat.save(QA/'concept_material_comparison.png')
    read=Image.new('RGB',(1380,730),(25,27,29)); rd=ImageDraw.Draw(read)
    rd.text((20,18),'BAND READ | same-size reference and study at two stated scales',font=font(23),fill=(238,234,222))
    reference_rgb=Image.new('RGB',target,bg); reference_rgb.paste(reference,(0,0),alpha)
    study_rgb=Image.new('RGB',target,bg)
    shown=hero.crop(box).resize(target,Image.Resampling.LANCZOS)
    study_rgb.paste(shown,(0,0),alpha)
    for row,(width,enlarge,label) in enumerate([(128,3,'128px beak close-up'),(24,12,'128px bird / ~24px beak')]):
        y=90+row*330
        rd.text((20,y),label,font=font(19),fill=(231,228,217))
        for col,(name,im) in enumerate([('Concept',reference_rgb),('Round 4',study_rgb)]):
            small=im.resize((width,round(width*485/677)),Image.Resampling.LANCZOS)
            x=290+col*530
            rd.text((x,y-28),name,font=font(19),fill=(231,228,217))
            read.paste(small,(x,y))
            read.paste(small.resize((small.width*enlarge,small.height*enlarge),Image.Resampling.NEAREST),(x+140,y))
    read.save(QA/'groove_read_sizes.png')
    if not palette:
        return
    # Every breed colour at the native ~37-pixel beak width of a 200px bird.
    out=Image.new('RGB',(1620,770),(25,27,29)); d=ImageDraw.Draw(out)
    d.text((20,16),'200px BIRD | all seven beak colours; native 37px beside 8x nearest enlargement',font=font(23),fill=(238,234,222))
    for i,color in enumerate(list(COLORS)[:7]):
        im=render(a,color,(.45,.65,.7),proxy=True).crop(box)
        small=im.resize((37,27),Image.Resampling.LANCZOS)
        x=20+(i%4)*400; y=90+(i//4)*330
        d.text((x,y),color,font=font(22),fill=(231,228,217))
        out.paste(small,(x,y+42))
        out.paste(small.resize((296,216),Image.Resampling.NEAREST),(x+65,y+40))
    out.save(QA/'palette_read_sizes.png')


def sizes(a,hero):
    mask=a['alpha']>.5
    y,x=np.where(mask)
    box=(int(x.min()),int(y.min()),int(x.max()+1),int(y.max()+1))
    region=hero.crop(box)
    out=Image.new('RGB',(1300,720),(25,27,29))
    d=ImageDraw.Draw(out)
    d.text((22,20),'READ SIZES | native pixels beside an 8x nearest enlargement',font=font(25),fill=(233,230,220))
    y0=95
    for bird_px in [200,128,50]:
        width=max(1,round(bird_px*.12/.65))
        im=region.resize((width,round(width*region.height/region.width)),Image.Resampling.LANCZOS)
        d.text((25,y0+4),f'{bird_px}px bird / ~{width}px beak',font=font(22),fill=(215,214,207))
        out.paste(im,(365,y0))
        out.paste(im.resize((im.width*8,im.height*8),Image.Resampling.NEAREST),(450,y0))
        y0+=190
    out.save(QA/'read_sizes.png')
    # Read-only reference comparison; map onto the concept's blue region bounding box.
    root=ROOT.parents[2]
    concept=Image.open(root/'ref/concept/side.png').convert('RGB')
    regions=np.asarray(Image.open(root/'ref/regions/side.png').convert('RGB'))
    m=np.all(regions==[0,0,255],axis=-1)
    yy,xx=np.where(m)
    bbox=(xx.min(),yy.min(),xx.max()+1,yy.max()+1)
    # Whole original silhouette is flipped, then fitted to its measured source bbox.
    material=hero.crop(box).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    patch=np.asarray(material.resize((bbox[2]-bbox[0],bbox[3]-bbox[1]),Image.Resampling.LANCZOS))
    target=np.asarray(concept).copy()
    tile=target[bbox[1]:bbox[3],bbox[0]:bbox[2]]
    local=m[bbox[1]:bbox[3],bbox[0]:bbox[2]]
    tile[local]=patch[local]
    context=Image.fromarray(target)
    context.save(QA/'bird_context_full.png')
    panel=Image.new('RGB',(1770,450),(25,27,29))
    d=ImageDraw.Draw(panel)
    d.text((20,16),'CONTEXT ONLY | left: concept / right: study fitted to blue beak region',font=font(22),fill=(235,232,223))
    for i,sz in enumerate([200,128,50]):
        # Original bird is ~975 px tall in the square 1254 image.
        wh=round(1254*sz/975)
        for j,im in enumerate([concept,context]):
            im=im.resize((wh,wh),Image.Resampling.LANCZOS)
            panel.paste(im,(20+i*580+j*280,100))
        d.text((20+i*580,65),f'Bird height {sz}px',font=font(19),fill=(216,215,208))
    panel.save(QA/'bird_context_sizes.png')


def main(selected='all',measure_only=False):
    QA.mkdir(exist_ok=True)
    study=json.loads((ROOT/'study.json').read_text())
    results=json.loads((QA/'results.json').read_text()) if selected!='all' and (QA/'results.json').exists() else {}
    results.pop('passed',None)
    for name,spec in study['sets'].items():
        if selected!='all' and selected!=name:
            continue
        a=load(name)
        results[name]=verify(name,a,spec)
        print(name,json.dumps(results[name]),flush=True)
        if not measure_only:
            reviews(name,a,spec)
    results['passed']=all(r['passed'] for r in results.values())
    (QA/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    assert results['passed'], 'Material checks failed. See checks/results.json.'
    deviations=sum(len(r.get('declared_deviations',[])) for k,r in results.items() if k!='passed')
    print(f'Material checks complete; {deviations} declared COMMON deviation(s). See raw measurements and common_failures in results.json.',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--set',choices=['all','horn','beak_side'],default='all')
    parser.add_argument('--measure-only',action='store_true',help='Measure exports without regenerating review images.')
    args=parser.parse_args()
    main(args.set,args.measure_only)
