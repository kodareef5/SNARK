#!/usr/bin/env python3
"""Rebuild a periodic 2048-square, 1.5 m thatch material.
Requires numpy, scipy and Pillow. No network calls; fixed random seed.

Two original generated sources are retained. The layout is registered to the
four geometric courses, quilted on a torus, and decomposed into pigment and
local relief. Native-resolution epidermal fibres are added to both colour and
height. No geometric course ramp or step is included in height.
"""
from pathlib import Path
import json, hashlib, time
import numpy as np
from PIL import Image, ImageCms, ImageDraw
from scipy.ndimage import gaussian_filter, map_coordinates, maximum_filter1d, median_filter

ROOT=Path(__file__).resolve().parent
N=2048
METRES=1.5
HEIGHT_MM=32.
SEED=314159
PERIOD=1150
TARGET=np.array([190.,166.,112.],np.float32)
PROFILE=ROOT/'source/sRGB.icc'
if not PROFILE.exists():
    PROFILE.write_bytes(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
SRGB=PROFILE.read_bytes()
# Original source control points, measured from the retained image.
SOURCE_TOPS=np.array([60,355,655,948,1245],np.float32)
CENTRES=[
 [49,158,266,375,474,576,678,780,880,981,1090],
 [15,95,205,314,423,530,636,742,849,955,1065],
 [50,160,268,374,477,579,680,786,885,990,1096],
 [15,107,213,318,425,532,640,746,851,957,1065],
]
TIE_Y=[
 [91,103,77,100,86,107,76,104,76,98,109],
 [386,377,393,372,393,375,394,374,392,375,398],
 [686,695,671,693,671,695,673,697,676,698,676],
 [976,966,988,969,988,972,994,971,989,974,995],
]


def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def save_rgb(path,a,srgb=False):
    Image.fromarray(np.uint8(np.clip(np.rint(a),0,255))).save(ROOT/path,**({'icc_profile':SRGB} if srgb else {}))


def mincut(error):
    """Top-to-bottom minimum-error seam, allowing one-pixel lateral steps."""
    rows,cols=error.shape
    total=error[0].astype(np.float64).copy()
    back=np.zeros((rows,cols),np.int8)
    for y in range(1,rows):
        prev=np.stack([np.r_[np.inf,total[:-1]],total,np.r_[total[1:],np.inf]])
        choice=np.argmin(prev,axis=0)
        back[y]=choice-1
        total=error[y]+prev[choice,np.arange(cols)]
    path=np.empty(rows,np.int32);path[-1]=np.argmin(total)
    for y in range(rows-1,0,-1):path[y-1]=path[y]+back[y,path[y]]
    return path


def remove_signature_strays(src):
    # Only the unusually long cross-bundle arcs are replaced. Short stray
    # reeds remain. A vertical median reconstructs the underlying epidermis.
    paths=[[(1168,130),(1110,154),(1053,181),(983,216),(925,239),(882,248)],
           [(935,230),(960,259),(982,276),(1011,287)],
           [(870,542),(893,572),(923,591),(944,596)],
           [(420,489),(452,479),(478,469),(507,447)],
           [(185,871),(222,848),(261,822),(302,797),(344,768),(376,745)],
           [(176,1164),(202,1157),(222,1157),(245,1165),(282,1184)],
           [(969,1166),(1010,1167),(1052,1159),(1100,1147),(1141,1132),(1177,1110),(1216,1080)]]
    mask=Image.new('L',(src.shape[1],src.shape[0]),0)
    d=ImageDraw.Draw(mask)
    for points in paths:d.line(points,fill=255,width=13,joint='curve')
    a=gaussian_filter(np.asarray(mask,np.float32)/255,.8)
    replacement=median_filter(src,size=(29,1,1),mode='reflect')
    out=src*(1-a[...,None])+replacement*a[...,None]
    mask.save(ROOT/'source/repeat_cleanup_mask.png')
    save_rgb('source/cleaned_layout.png',out,True)
    return out


def register_source():
    src=np.asarray(Image.open(ROOT/'source/generated_thatch_layout.png').convert('RGB'),np.float32)
    src=remove_signature_strays(src)
    H,W=src.shape[:2]
    overlap=W-PERIOD
    a=src[:,:overlap];b=src[:,PERIOD:]
    err=np.mean((a-b)**2,axis=2)
    # Prefer a central cut, avoiding tiny slivers at the ends of the overlap.
    err+=((np.arange(overlap)-(overlap-1)/2)/(overlap*.45))**8*10000
    cut=mincut(gaussian_filter(err,(1,.6)))
    mask=smooth(-.65,.65,np.arange(overlap)[None,:]-cut[:,None])
    periodic=src[:,:PERIOD].copy()
    periodic[:,:overlap]=b*(1-mask[...,None])+a*mask[...,None]
    # First register at the final sampling resolution. Course boundaries are
    # exact mesh rows; ragged fringes are permitted to cross those rows.
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    sx=xx*PERIOD/N
    sy=np.interp(yy[:,0],np.arange(5)*512,SOURCE_TOPS).astype(np.float32)[:,None]
    sy=np.broadcast_to(sy,(N,N))
    tex=np.stack([map_coordinates(periodic[...,ch],[sy,sx],order=3,mode='grid-wrap',prefilter=True) for ch in range(3)],-1)
    # Join the last course body into the original image's overhanging top
    # fringe. This gives continuous stalks at the toroidal boundary, without
    # duplicating a tie or inventing a fifth course.
    y0=1946
    vy=SOURCE_TOPS[0]+(np.arange(y0,N)-N)*(SOURCE_TOPS[1]-SOURCE_TOPS[0])/512
    extension=np.stack([map_coordinates(periodic[...,ch],[np.broadcast_to(vy[:,None],(N-y0,N)),sx[y0:]],order=3,mode='grid-wrap',prefilter=True) for ch in range(3)],-1)
    ov=62
    err=np.mean((tex[y0:y0+ov]-extension[:ov])**2,axis=2).T
    err+=((np.arange(ov)-ov*.47)/(ov*.43))**8*10000
    cuty=mincut(gaussian_filter(err,(1,.6)))
    m=smooth(-.65,.65,np.arange(N-y0)[:,None]-cuty[None,:])
    tex[y0:]=tex[y0:]*(1-m[...,None])+extension*m[...,None]
    return np.clip(tex,0,255),{'horizontal_source_period':PERIOD,'horizontal_overlap':overlap,'vertical_join_start':y0,'vertical_join_overlap':ov,'source_top_control_rows':SOURCE_TOPS.tolist()}


def tied_row(old):
    """Keep the whole binding inside the recessed upper 15% of a course."""
    return 56+(np.asarray(old)-56)*.18


def register_bindings(tex):
    original=tex.copy()
    x=np.arange(N,dtype=np.float32)
    y=np.arange(160,dtype=np.float32)[:,None]
    window=np.sin(np.pi*y/160)**2
    for k in range(4):
        cc=np.asarray(CENTRES[k])*N/PERIOD
        old=np.interp(TIE_Y[k],SOURCE_TOPS,np.arange(5)*512)-k*512
        new=tied_row(old)
        amount=(old-new)/np.sin(np.pi*new/160)**2
        offset=np.interp(x,np.r_[cc[-1]-N,cc,cc[0]+N],np.r_[amount[-1],amount,amount[0]])
        sy=k*512+y+window*offset[None,:]
        coords=[sy,np.broadcast_to(x,sy.shape)]
        for ch in range(3):
            tex[k*512:k*512+160,:,ch]=map_coordinates(original[...,ch],coords,order=3,mode='grid-wrap')
    return tex


def overlap_fringes(tex):
    """Carry ragged reed clumps 70–110 px beyond each fixed course origin.

    Texture transport and the antialiased silhouette occur BEFORE any channel
    is derived, so every colour, ridge, fibre and tip remains registered.
    """
    original=tex.copy()
    rng=np.random.default_rng(SEED+244)
    x=np.arange(N,dtype=np.float32)
    fringe=np.zeros((N,N),np.float32)
    proud=np.zeros_like(fringe)
    masks=[]
    for k in range(4):
        # Open notches expose the receiving course's tied top. The long
        # clumps belong to the preceding course, including across row zero.
        jitter=gaussian_filter(rng.normal(size=N).astype(np.float32),2.1,mode='wrap')
        jitter=jitter/jitter.std()*5
        spacing=rng.uniform(35,58,44);spacing*=N/spacing.sum()
        centres=(np.cumsum(spacing)-spacing*.5+rng.uniform(0,N))%N
        end=np.full(N,22.,np.float32)
        for cx,w in zip(centres,spacing):
            d=np.abs((x-cx+N/2)%N-N/2)
            clump=1-smooth(w*.25,w*.43,d)
            end=np.maximum(end,22+(rng.uniform(78,105)-22)*clump)
        end=np.clip(end+jitter,12,110)
        # A few individual stems outlast the main clumps, at real reed width.
        for cx in rng.uniform(0,N,9):
            d=np.abs((x-cx+N/2)%N-N/2)
            end=np.maximum(end,22+(rng.uniform(118,141)-22)*np.exp(-(d/2.0)**4))
        cy=np.arange(-180,160,dtype=np.float32)
        rows=(cy.astype(int)+k*512)%N
        # Spread the extension over the tail AND overhang. Its maximum
        # derivative is 155*1.5/340 < 1, so source rows never reverse/fold.
        shift=155*smooth(-180,160,cy)
        src_y=(k*512+cy-shift)%N
        coords=[np.broadcast_to(src_y[:,None],(len(cy),N)),np.broadcast_to(x,(len(cy),N))]
        strand=np.stack([map_coordinates(original[...,ch],coords,order=3,mode='grid-wrap') for ch in range(3)],-1)
        a=1-smooth(end[None,:]-2.2,end[None,:]+2.2,cy[:,None])
        luma=strand.mean(2)
        crest=luma-gaussian_filter(luma,(1,3),mode='wrap')
        stem=np.clip((crest+9)/18,0,1)
        a*=1-smooth(-10,24,cy[:,None])*(1-stem)*.15
        tex[rows]=tex[rows]*(1-a[...,None])+strand*a[...,None]
        fringe[rows]=np.where(cy[:,None]>=0,a,fringe[rows])
        proud[rows]=1.15*a*smooth(-60,-5,cy[:,None])
        masks.append({'mean_tip_row':float(end.mean()),'min_tip_row':float(end.min()),'max_tip_row':float(end.max()),'tip_row_percentiles':np.percentile(end,[10,25,50,75,90,99]).tolist(),'main_clump_width_fraction_70_to_110_px':float(np.mean((end>=70)&(end<=110))),'gap_width_fraction_below_45_px':float(np.mean(end<45)),'stray_width_fraction_above_110_px':float(np.mean(end>110))})
    return tex,fringe,proud,masks


def normals(h):
    mm_per_px=METRES*1000/N
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))*HEIGHT_MM/(2*mm_per_px)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))*HEIGHT_MM/(2*mm_per_px)
    v=np.stack([-dx,dy,np.ones_like(h)],-1)
    return v/np.linalg.norm(v,axis=2,keepdims=True)


def geometry_fields(tex,fringe):
    """Bundle crowns and local tie masks. No slope or step per course."""
    rng=np.random.default_rng(SEED)
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    crowns=[];groups=[];metadata=[];valleys=[];palettes=[]
    colour_rng=np.random.default_rng(SEED+2026)
    batches=np.array([.08,-.08,.035,-.035],np.float32)
    batch_tints=np.array([[0,0,2],[1,0,-2],[-1,0,2],[0,0,-2]],np.float32)
    tie=np.zeros((N,N),np.float32)
    for k in range(4):
        cc=np.array(CENTRES[k],np.float32)*N/PERIOD
        widths=(np.roll(cc,-1)-np.roll(cc,1))%N/2
        dist=(xx[0][None,:]-cc[:,None]+N/2)%N-N/2
        nearest=np.argmin(np.abs(dist),axis=0)
        dx=dist[nearest,np.arange(N)]
        cw=widths[nearest]
        variation=rng.uniform(8.4,10.4,len(cc))
        profile=np.maximum(0,1-(dx/(cw*.56))**2)**.75*variation[nearest]
        valley=gaussian_filter(smooth(.58,1.,np.abs(dx)/(cw*.5)),2.0,mode='wrap')
        profile=1.28*profile-1.4*valley
        # Equal cross-section means prevent any batch from creating a step.
        profile+=8.3-profile.mean()
        crowns.append(profile)
        valleys.append(valley)
        groups.append(nearest)
        tones=colour_rng.permutation([-.105,.075,-.03,.11,-.075,.025,-.115,.05,-.015,.085,-.005])
        offsets=tones[:,None]*TARGET[None,:]
        kinds=[]
        for b,tone in enumerate(tones):
            if b in (2,8):
                offsets[b]+=np.array([-3.,0.,9.]);kind='older grey straw'
            elif tone>.045:
                offsets[b]+=np.array([0.,1.,6.]);kind='pale cream'
            else:
                offsets[b]+=np.array([2.,0.,-4.]);kind='deeper gold'
            kinds.append(kind)
        palette=gaussian_filter(offsets[nearest],(8.,0),mode='wrap')
        palette-=palette.mean(0)
        palette+=batches[k]*TARGET+batch_tints[k]
        palettes.append(palette)
        records=[]
        for b,(cx,w,ty) in enumerate(zip(cc,widths,TIE_Y[k])):
            Y=k*512+float(tied_row(np.interp(ty,SOURCE_TOPS,np.arange(5)*512)-k*512))
            q=((xx-cx+N/2)%N-N/2)/(w*.36)
            # The generated ties sag slightly. A soft feature gate avoids a
            # hard elliptical ridge. Fine rope relief comes from the source.
            line=Y+4*(1-q*q)
            gate=np.exp(-((yy-line)/9.2)**4)*(1-smooth(.82,1.06,np.abs(q)))
            tie=np.maximum(tie,gate)
            records.append({'id':k*11+b+1,'centre_px':float(cx),'width_px':float(w),'width_cm':float(w*150/N),'source_tie_y':ty,'tie_y_px':float(Y-k*512),'pigment_kind':kinds[b],'pigment_lightness_offset':float(tones[b])})
        metadata.append({'course':k,'top_row':k*512,'batch_lightness_offset':float(batches[k]),'bundles':records})
    h=np.empty((N,N),np.float32);bundle=np.zeros((N,N),np.uint8)
    valley_field=np.empty_like(h);pigment=np.empty((N,N,3),np.float32)
    for k in range(4):
        # The same silhouette transports pigment, crowns and valleys, so
        # each tip retains its parent bundle's tone and rounded cross section.
        t=1-fringe[k*512:(k+1)*512]
        profile=crowns[(k-1)%4][None,:]*(1-t)+crowns[k][None,:]*t
        h[k*512:(k+1)*512]=profile
        valley_field[k*512:(k+1)*512]=valleys[(k-1)%4][None,:]*(1-t)+valleys[k][None,:]*t
        pigment[k*512:(k+1)*512]=palettes[(k-1)%4][None,:,:]*(1-t[...,None])+palettes[k][None,:,:]*t[...,None]
        bundle[k*512:(k+1)*512]=groups[k][None,:]+1+k*11
    return h,tie,bundle,metadata,valley_field,pigment


def intrinsic_colour(tex):
    """Lift source crevices; transport crest reflectance over each reed.

    Source ridge lighting is used for relief, not left in the pigment image.
    Broad colour and fine epidermal pigment are preserved at reduced strength.
    """
    lum=np.sum(tex*np.array([.2126,.7152,.0722],np.float32),axis=2)
    broad=gaussian_filter(lum,(17,12),mode='wrap')
    crest=maximum_filter1d(gaussian_filter(lum,.42,mode='wrap'),7,axis=1,mode='wrap')
    # Plateau-style shadow lift, rather than a bilateral display sharpen.
    lifted=lum+np.maximum(0,crest-lum-5)*.96
    liftmean=gaussian_filter(lifted,(18,11),mode='wrap')
    pigment=(lifted-liftmean)*.9
    # Natural straw chroma is low-frequency intrinsic colour; normalize the
    # overall palette and suppress dark-gap desaturation changes.
    chroma=tex-lum[...,None]
    chroma-=gaussian_filter(chroma,(20,12,0),mode='wrap')
    chroma=np.clip(chroma,-10,10)*.32
    col=TARGET+pigment[...,None]*np.array([.85,.94,1.03])+chroma
    # Longitudinal source colour lives in real straw, not directional light.
    low=gaussian_filter(lum,(22,1.1),mode='wrap')-broad
    col+=np.clip(low,-16,16)[...,None]*.22
    return col.astype(np.float32),lum


def native_fibres():
    rng=np.random.default_rng(SEED+101)
    # Native 2048-resolution, elongated epidermal fibres. All filtering wraps.
    noise=rng.normal(0,1,(N,N)).astype(np.float32)
    f=gaussian_filter(noise,(8.2,.42),mode='wrap')
    f-=gaussian_filter(f,(.4,1.7),mode='wrap')
    f/=f.std()
    f=np.clip(f,-2.6,2.6)
    # Coordinate warp follows the slight naturally varying bundle flow.
    yy,xx=np.mgrid[:N,:N].astype(np.float32)
    warp=1.2*np.sin(yy*2*np.pi/N*9+.35*np.sin(xx*2*np.pi/N*13))
    f=map_coordinates(f,[yy,(xx+warp)%N],order=1,mode='grid-wrap')
    # Compose 44 independent full-resolution epidermis patches from the
    # close reed stock. Every patch is sampled at <= its original scale.
    stock=np.asarray(Image.open(ROOT/'source/generated_reed_stock.png'),np.float32).mean(2)
    stock-=gaussian_filter(stock,(4.0,1.1),mode='reflect')
    stock=np.clip(stock,-18,18)/max(stock.std(),1)
    patches=[]
    for k in range(4):
        canvas=np.zeros((640,N),np.float32);weights=np.zeros_like(canvas)
        cc=np.asarray(CENTRES[k])*N/PERIOD
        for b,cx in enumerate(cc):
            w=((cc[(b+1)%11]-cc[(b-1)%11])%N)/2
            xp=np.arange(int(cx-w*.78),int(cx+w*.78)+1)
            dx=xp-cx
            wt=np.maximum(0,np.cos(np.clip(dx/(w*.78),-1,1)*np.pi/2))**2
            sy=rng.uniform(5,350)+np.arange(640,dtype=np.float32)[:,None]*1.35
            sx=rng.uniform(250,1000)+dx[None,:]*1.3+1.3*np.sin(sy/100+rng.uniform(0,6))
            patch=map_coordinates(stock,[np.broadcast_to(sy,sx.shape),sx],order=1,mode='reflect')
            canvas[:,xp%N]+=patch*wt[None,:]
            weights[:,xp%N]+=wt[None,:]
        patches.append(canvas/np.maximum(weights,.001))
    skin=np.empty((N,N),np.float32)
    blend=smooth(0,115,np.arange(128,dtype=np.float32))[:,None]
    for k in range(4):
        row=patches[k][:512].copy()
        row[:128]=patches[(k-1)%4][512:640]*(1-blend)+row[:128]*blend
        skin[k*512:(k+1)*512]=row
    skin/=skin.std()
    f=.72*skin+.5*f
    f/=f.std()
    return np.clip(f,-3,3)


def build():
    t=time.monotonic()
    tex,registration=register_source()
    tex=register_bindings(tex)
    tex,fringe,proud,fringe_meta=overlap_fringes(tex)
    save_rgb('source/registered_master.png',tex,True)
    crown,tie,bundle,courses,bundle_valley,pigment=geometry_fields(tex,fringe)
    tie_uncovered=tie.copy()
    tie*=1-fringe
    base,lum=intrinsic_colour(tex)
    f=native_fibres()
    # No generation/upscale-only claim: this 2K fibre field is new material
    # detail and contributes coherently to pigment and physical displacement.
    base+=f[...,None]*3.8
    # Intrinsic batch/pigment differences survive mip filtering. A restrained
    # darker pigment cue in the valleys supplements stronger physical relief
    # and AO; there is no illumination or tied-region shadow in this channel.
    base+=pigment-bundle_valley[...,None]*np.array([4.,3.5,3.])
    cy=np.arange(N,dtype=np.float32)[:,None]%512
    weather=np.maximum(smooth(435,505,cy),fringe)
    base+=weather[...,None]*np.array([-1.,.7,5.5])
    base+=TARGET-base.mean((0,1),dtype=np.float64)
    save_rgb('thatch_base.png',base,True)
    # Locally normalized ridge signal, no low-frequency course lighting.
    local=lum-gaussian_filter(lum,(6.0,4.0),mode='wrap')
    contrast=np.sqrt(gaussian_filter(local**2,(12,12),mode='wrap')+36)
    ridges=np.tanh(local/contrast*.68)
    h=8.5+crown+1.35*ridges+tie*.85+f*.07+proud
    h=gaussian_filter(h,.42,mode='wrap')
    h16=np.uint16(np.rint(np.clip(h/HEIGHT_MM,0,1)*65535))
    Image.fromarray(h16).save(ROOT/'thatch_height.png')
    hq=h16.astype(np.float32)/65535
    save_rgb('thatch_normal.png',(normals(hq)*.5+.5)*255)
    # Gap and overhang occlusion is isolated in red. The source's broad
    # brightness is never copied wholesale to AO or height.
    valleys=np.clip(-ridges,0,1)
    micro=np.exp(-.32*valleys)
    y=np.arange(N,dtype=np.float32)[:,None]%512
    tied_shadow=1-.47*(1-fringe)*smooth(0,22,y)*(1-smooth(55,128,y))
    cavity=np.maximum(0,gaussian_filter(h,(5,9),mode='wrap')-h)
    ao=np.clip(micro*tied_shadow*np.exp(-cavity*.055-bundle_valley*.48),.26,1)
    rough=.86+.045*valleys+.013*f+.025*weather
    rough=np.clip(rough,.78,.95)
    rough=rough*(1-tie)+(.765+.012*f)*tie
    rough=np.clip(rough,.75,.95)
    save_rgb('thatch_orm.png',np.stack([ao,rough,np.zeros_like(ao)],-1)*255)
    Image.fromarray(np.uint8(np.rint(tie*255))).save(ROOT/'source/tie_mask.png')
    Image.fromarray(bundle).save(ROOT/'source/bundle_ids.png')
    Image.fromarray(np.uint8(np.rint(bundle_valley*255))).save(ROOT/'source/bundle_valley_mask.png')
    Image.fromarray(np.uint8(np.rint(fringe*255))).save(ROOT/'source/fringe_mask.png')
    Image.fromarray(np.uint8(np.rint(tie_uncovered*255))).save(ROOT/'source/tie_mask_before_overlap.png')
    Image.fromarray(np.uint16(np.rint((np.clip(f,-3,3)+3)/6*65535))).save(ROOT/'source/native_fibre_field.png')
    save_rgb('source/pigment_master.png',base,True)
    meta={'seed':SEED,'size':[N,N],'metres_per_tile':METRES,'millimetres_per_pixel':METRES*1000/N,'height_full_range_mm':HEIGHT_MM,'height_occupied_mm':[float(hq.min()*HEIGHT_MM),float(hq.max()*HEIGHT_MM)],'geometry_course_top_rows':[0,512,1024,1536],'courses':courses,'registration':registration,'fringes':fringe_meta,'tie_visible_fraction':float(tie.sum()/tie_uncovered.sum()),'generated_sources':{name:{'dimensions':list(Image.open(ROOT/'source'/name).size),'sha256':hashlib.sha256((ROOT/'source'/name).read_bytes()).hexdigest()} for name in ['generated_reed_stock.png','generated_thatch_layout.png']},'mean_srgb':np.array(Image.open(ROOT/'thatch_base.png')).mean((0,1)).tolist(),'build_seconds':time.monotonic()-t,'height_note':'Local bundle crowns and inferred reed/rope relief, plus native 2K fibres. No geometric course ramp or step.'}
    meta['revision']=2
    meta['round2']={'course_batch_lightness_offsets':[.08,-.08,.035,-.035],
                    'palette':'Per-bundle cream, gold and older grey straw; common mean correction after compositing.',
                    'bundle_crown_scale':1.28,'additional_valley_depth_mm':1.4,
                    'valley_base_rgb_subtraction':[4,3.5,3],'valley_ao_exponent':.48,
                    'main_fringe_length_px':[70,110],'main_fringe_length_cm':[70*150/N,110*150/N],
                    'stray_tip_max_px':141,'fringe_source_max_shift_px':155,
                    'fringe_transport_min_row_derivative':1-155*1.5/340,
                    'foreground_registration':'One fringe silhouette transports source stems, batch/bundle pigment, crowns and valley fields.'}
    (ROOT/'source/build_manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({k:meta[k] for k in ['mean_srgb','height_occupied_mm','build_seconds']},indent=2))

if __name__=='__main__':build()
