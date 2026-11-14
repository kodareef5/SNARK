#!/usr/bin/env python3
"""Independent delivered-PNG checks and reproducible visual review artifacts.
No imports from the builder: scale, band boundaries and derivatives are checked
independently. Exit nonzero on contract, physical alignment or seam failure.
"""
from pathlib import Path
import argparse,hashlib,json,struct,subprocess,sys,time
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy import ndimage as ndi
from scipy.signal import find_peaks
ROOT=Path(__file__).resolve().parent; OUT=ROOT/'checks'
BANDS=[(0,614,'Bark-on'),(614,1126,'Half-peeled'),(1126,1434,'Thin sticks'),(1434,1782,'Grass cord')]
SCALE=1500/2048; RANGE=10.

def u8(a):return np.rint(np.clip(a,0,255)).astype(np.uint8)
def im(a):return Image.fromarray(u8(a))
def norm(a):return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-9)
def font(size=22):
    try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',size)
    except OSError:return ImageFont.load_default()
def label(canvas,text,xy,size=22):ImageDraw.Draw(canvas).text(xy,text,font=font(size),fill=(221,216,201))
def panel(a,width):
    p=im(a) if not isinstance(a,Image.Image) else a
    return p.resize((width,round(p.height*width/p.width)),Image.Resampling.LANCZOS)
def srgb_to_linear(c):
    c=c/255.;return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
def to_srgb(c):return np.where(c<=.0031308,c*12.92,1.055*np.maximum(c,0)**(1/2.4)-.055)*255

def shade(base,n,orm,light=(.45,.22,.86),clay=False):
    L=norm(np.array(light,dtype=np.float32)); V=np.array([0,0,1.]); H=norm(L+V)
    nl=np.clip(np.sum(n*L,axis=-1),0,1); nv=np.clip(n[...,2],.01,1)
    nh=np.clip(np.sum(n*H,axis=-1),0,1); vh=float(np.dot(V,H))
    rough=orm[...,1]/255; ao=orm[...,0]/255
    a2=np.maximum(rough,.1)**4
    D=a2/(np.pi*(nh*nh*(a2-1)+1)**2+1e-8)
    k=(rough+1)**2/8; G=nl/(nl*(1-k)+k+1e-7)*nv/(nv*(1-k)+k)
    F=.04+.96*(1-vh)**5
    spec=D*G*F/(4*nv*np.maximum(nl,.001))
    color=srgb_to_linear(base) if not clay else np.full_like(base,.24,dtype=np.float32)
    sky=(.25+.08*np.clip(n[...,1],-1,1))*ao
    result=color*sky[...,None]*np.array([.86,.93,1.10])+ (color*.96+spec[...,None])*nl[...,None]*1.05*np.array([1.0,.91,.76])
    return to_srgb(result)

def seam_metric(a,axis):
    d=np.abs(np.diff(a.astype(np.float64),axis=axis))
    w=np.abs(np.take(a,0,axis=axis).astype(float)-np.take(a,-1,axis=axis))
    other=tuple(i for i in range(d.ndim) if i!=axis)
    lines=d.mean(axis=other); edge=float(w.mean()); q=float(np.quantile(lines,.99))
    return {'wrap_mean':edge,'interior_mean':float(d.mean()),'interior_line_p95':float(np.quantile(lines,.95)),
            'interior_line_p99':q,'interior_line_max':float(lines.max()),'wrap_to_interior_mean':edge/max(float(d.mean()),1e-9),
            'pass':bool(edge<=q*1.20+.05)}

def independent_normals(height):
    result=np.empty((2048,2048,3),np.float64)
    for y0,y1,_ in BANDS:
        z=height[y0:y1]*RANGE
        xp=np.concatenate([z[:,1:],z[:,:1]],axis=1); xm=np.concatenate([z[:,-1:],z[:,:-1]],axis=1)
        yp=np.concatenate([z[1:],z[:1]],axis=0); ym=np.concatenate([z[-1:],z[:-1]],axis=0)
        result[y0:y1]=norm(np.stack([-(xp-xm)/(2*SCALE),(yp-ym)/(2*SCALE),np.ones_like(z)],axis=2))
    z=height[1782:]*RANGE; gy,gx=np.gradient(z,SCALE)
    result[1782:]=norm(np.stack([-gx,gy,np.ones_like(z)],axis=2))
    return result

def sheets(maps,normals):
    canvas=Image.new('RGB',(1600,1690),(24,24,24))
    for i,(name,a) in enumerate(maps.items()):
        x=(i%2)*800;y=(i//2)*845
        label(canvas,name,(x+16,y+10));canvas.paste(panel(a,800),(x,y+40))
    canvas.save(OUT/'layers.jpg',quality=94)
    offset_sheet=Image.new('RGB',(1600,1690),(24,24,24))
    for i,(name,a) in enumerate(maps.items()):
        offset=a.copy()
        for y0,y1,_ in BANDS:offset[y0:y1]=np.roll(a[y0:y1],((y1-y0)//2,1024),(0,1))
        im(offset).save(OUT/f'{name}_half_offset.png')
        x=(i%2)*800;y=(i//2)*845;label(offset_sheet,name+' / per-band half offset',(x+12,y+10),20)
        offset_sheet.paste(panel(offset,800),(x,y+40))
    offset_sheet.save(OUT/'offsets.jpg',quality=94)
    base=maps['wood_base']; width=1536
    panel(base,1024).save(OUT/'base_overview.jpg',quality=95)
    tiling=Image.new('RGB',(width,1600),(24,24,24)); cy=0
    for i,(y0,y1,name) in enumerate(BANDS):
        band=base[y0:y1]; three=np.tile(band,(1,3,1)); nine=np.tile(band,(3,3,1))
        im(three).save(OUT/f'band_{i+1}_tile_3across.png')
        im(nine).save(OUT/f'band_{i+1}_tile_3x3.png')
        label(tiling,f'{i+1}  {name} / 3 x 3',(14,cy+6),21);cy+=34
        pv=panel(nine,width);tiling.paste(pv,(0,cy));cy+=pv.height
    tiling.crop((0,0,width,cy)).save(OUT/'tilings.jpg',quality=95)
    relight=Image.new('RGB',(1920,1370),(24,24,24))
    for j,L in enumerate([(-.65,.45,.42),(.65,-.45,.42),(.30,.22,.93)]):
        for row,clay in enumerate([False,True]):
            a=shade(base,normals,maps['wood_orm'],L,clay)
            im(a).save(OUT/f'relight_{j+1}_{"clay" if clay else "colour"}.png')
            label(relight,f'{"Clay" if clay else "Colour"}  light {L}',(640*j+12,685*row+10),18)
            relight.paste(panel(a,640),(640*j,685*row+38))
    relight.save(OUT/'relighting.jpg',quality=95)
    detail=Image.new('RGB',(1536,1252),(24,24,24))
    crops=[(380,160,892,544),(850,700,1362,1084),(200,1438,712,1782)]
    for row,(x0,y0,x1,y1) in enumerate(crops):
        for col,key in enumerate(['wood_base','wood_normal','wood_orm']):
            y=row*416;label(detail,f'{key} / 1:1 ({x0}, {y0})',(col*512+10,y+6),18)
            detail.paste(im(maps[key][y0:y1,x0:x1]),(col*512,y+32))
    detail.save(OUT/'detail_1to1.png')
    # Native resolution strips spanning every horizontal and circumferential wrap.
    seam_sheet=Image.new('RGB',(1024,4*220),(24,24,24))
    for i,(y0,y1,name) in enumerate(BANDS):
        b=base[y0:y1]; cross=np.concatenate([b[-80:],b[:80]],axis=0)
        label(seam_sheet,name+' / circumferential join at center',(10,i*220+5),18)
        seam_sheet.paste(im(cross[:,400:1424]),(0,i*220+32))
    seam_sheet.save(OUT/'wrap_detail.png')
    ends=Image.new('RGB',(1536,4*288),(24,24,24))
    rows=[('Diffuse / 1:1',base),('OpenGL normal / 1:1',maps['wood_normal']),
          ('Upper-left light',shade(base,normals,maps['wood_orm'],(-.65,.45,.42))),
          ('Lower-right light',shade(base,normals,maps['wood_orm'],(.65,-.45,.42)))]
    for row,(title,a) in enumerate(rows):
        label(ends,title,(12,row*288+6),20)
        for col in range(6):
            x=56+col*336; ends.paste(im(a[1787:2043,x:x+256]),(col*256,row*288+32))
    ends.save(OUT/'end_grain_1to1.png')


def cylinder_image(base,normal,orm,band_index,length,diameter,width=1700,height=200,uv_shift=.13,lashing=False,light=(.45,.22,.86)):
    """Orthographic ray/cylinder intersection with both real circular end caps.
    Positions are metres; surface uses 1.5m/U repeat and one band/V circumference.
    Includes GGX roughness/Fresnel, ambient cavity AO and a 13-degree sun.
    """
    y0,y1,_=BANDS[band_index]
    axis=norm(np.array([.91,.012,.414])); B=norm(np.cross(axis,[0.,1.,0.])); C=np.cross(B,axis)
    # B points primarily left/out; C points image-up. End grain is in the B,C plane.
    r=diameter/2; span=length*.96+diameter*.8
    pixel_m=span/width
    yy,xx=np.mgrid[:height,:width]
    O=np.stack([(xx-width/2)*pixel_m,-(yy-height/2)*pixel_m,np.full_like(xx,5.,dtype=float)],axis=-1)
    D=np.array([0.,0.,-1.]); qa=np.sum(O*axis,axis=-1); da=float(D@axis)
    Q=O-qa[...,None]*axis; d=D-da*axis
    aa=float(d@d); bb=2*np.sum(Q*d,axis=-1); cc=np.sum(Q*Q,axis=-1)-r*r
    disc=bb*bb-4*aa*cc; t=(-bb-np.sqrt(np.maximum(0,disc)))/(2*aa)
    P=O+t[...,None]*D; s=np.sum(P*axis,axis=-1)
    side=(disc>=0)&(np.abs(s)<=length/2)&(t>0)
    nearest=np.where(side,t,np.inf); cap=np.zeros(side.shape,dtype=bool)
    for sign in [-1,1]:
        tc=(sign*length/2-qa)/da
        pc=O+tc[...,None]*D; rc=pc-sign*length/2*axis
        ok=(np.sum(rc*rc,axis=-1)<=r*r)&(tc>0)&(tc<nearest)
        nearest=np.where(ok,tc,nearest);cap|=ok
    binding=np.zeros(side.shape,dtype=bool)
    if lashing:
        # A 6cm sleeve on the 14cm pole, raised 4mm to show its edge silhouette.
        # The normal map supplies the individual turn and ply relief.
        ro=r+.004
        cd=np.sum(Q*Q,axis=-1)-ro*ro; sd=bb*bb-4*aa*cd
        ts=(-bb-np.sqrt(np.maximum(0,sd)))/(2*aa)
        ps=O+ts[...,None]*D; ss=np.sum(ps*axis,axis=-1)
        ok=(sd>=0)&(np.abs(ss)<=.03)&(ts>0)&(ts<nearest)
        nearest=np.where(ok,ts,nearest);binding|=ok;cap&=~ok
    visible=np.isfinite(nearest)
    t=np.where(visible,nearest,0);P=O+t[...,None]*D;s=np.sum(P*axis,axis=-1)
    radial=norm(P-s[...,None]*axis)
    theta=np.arctan2(np.sum(radial*C,axis=-1),np.sum(radial*B,axis=-1))
    tx=((s+length/2)/1.5*2048)%2048
    ty=((theta/(2*np.pi)+uv_shift)%1)*(y1-y0)
    def band_sample(a):
        b=a[y0:y1]
        return np.stack([ndi.map_coordinates(b[...,c],[ty,tx],order=1,mode='grid-wrap') for c in range(3)],axis=-1)
    bc=band_sample(base); tn=band_sample(normal); oc=band_sample(orm)
    # Correct circumferential normal slope for the requested real pole diameter.
    tn[...,1]*=(y1-y0)*SCALE/(diameter*1000*np.pi);tn=norm(tn)
    if lashing:
        # Choose complete neighbouring turns closest to the 81.92px nominal
        # 6cm span. Detect boundaries from delivered height, not build metadata.
        zh=np.array(Image.open(ROOT/'wood_height.png'),np.float32)[1434:1782]
        profile=zh.mean(0)
        edge,_=find_peaks(-np.r_[profile,profile,profile],distance=9,prominence=2000)
        edge=edge[(edge>=2048)&(edge<4096)]-2048
        choices=[(abs((edge[j+k]-edge[j])-81.92),int(edge[j]),int(edge[j+k]-edge[j]))
                 for k in (6,7) for j in range(len(edge)-k)]
        _,xstart,spanpx=min(choices)
        cx=(xstart+(s+.03)/.06*spanpx)%2048
        cy=((theta/(2*np.pi)+uv_shift)%1)*348
        def cord_sample(a):
            return np.stack([ndi.map_coordinates(a[1434:1782,:,c],[cy,cx],order=1,mode='grid-wrap') for c in range(3)],axis=-1)
        cb=cord_sample(base);cn=cord_sample(normal);co=cord_sample(orm)
        cn[...,0]*=spanpx*SCALE/60
        cn[...,1]*=348*SCALE/((diameter+.008)*1000*np.pi);cn=norm(cn)
        bc=np.where(binding[...,None],cb,bc);oc=np.where(binding[...,None],co,oc)
        tn=np.where(binding[...,None],cn,tn)
    tangent_theta=-np.sin(theta)[...,None]*B+np.cos(theta)[...,None]*C
    wn=norm(tn[...,0,None]*axis-tn[...,1,None]*tangent_theta+tn[...,2,None]*radial)
    # Right-hand cap faces camera; end grain samples use same physical atlas.
    ex=56+(band_index%6)*336+127.5+np.sum(P*B,axis=-1)/r*124
    ey=1914.5-np.sum(P*C,axis=-1)/r*124
    for a,target in [(base,bc),(orm,oc)]:
        for c in range(3):target[...,c]=np.where(cap,ndi.map_coordinates(a[...,c],[ey,ex],order=1,mode='nearest'),target[...,c])
    cn=np.stack([ndi.map_coordinates(normal[...,c],[ey,ex],order=1,mode='nearest') for c in range(3)],axis=-1)
    capn=norm(cn[...,0,None]*B+cn[...,1,None]*C+cn[...,2,None]*axis)
    wn=np.where(cap[...,None],capn,wn)
    result=shade(bc,wn,oc,light)
    # A restrained neutral background keeps attention on surface and silhouette.
    bg=np.empty_like(result);bg[:]=[29,32,31]
    return np.where(visible[...,None],result,bg)

def cylinders(maps,n):
    for close in [False,True]:
        w=1700;ph=210 if not close else 340
        out=Image.new('RGB',(1800,100+4*(ph+45)),(29,32,31))
        title='ARM-LENGTH DETAIL / 0.75 m poles' if close else 'LOW SUN / 3 m poles / two full length repeats'
        label(out,title,(50,24),28)
        for i,(_,_,name) in enumerate(BANDS):
            diameter=[.12,.10,.05,.14][i];length=.75 if close else 3.
            y=90+i*(ph+45);label(out,f'{i+1}  {name}  /  diameter {diameter*100:.0f} cm',(50,y),22)
            if i==3:label(out,'6 cm wide lashing',(1300,y),22)
            a=cylinder_image(maps['wood_base'],n,maps['wood_orm'],0 if i==3 else i,length,diameter,w,ph,lashing=(i==3))
            out.paste(im(a),(50,y+34))
        out.save(OUT/('cylinders_close.jpg' if close else 'cylinders.jpg'),quality=96)
    close=Image.new('RGB',(1500,1260),(29,32,31))
    for j,L in enumerate([(-.65,.30,.42),(.65,-.30,.42)]):
        label(close,'6 cm grass-cord lashing / 14 cm pole / light '+str(j+1),(25,j*630+18),24)
        a=cylinder_image(maps['wood_base'],n,maps['wood_orm'],0,.30,.14,1450,560,lashing=True,light=L)
        close.paste(im(a),(25,j*630+58))
    close.save(OUT/'cord_cylinders.jpg',quality=96)
    comparison=Image.new('RGB',(2000,952),(29,32,31))
    for col,(title,path) in enumerate([('Round 2 / identical lighting',OUT/'round2/cylinders_close.jpg'),
                                       ('Round 3 / identical lighting',OUT/'cylinders_close.jpg')]):
        label(comparison,title,(col*1000+24,14),24)
        comparison.paste(panel(Image.open(path),1000),(col*1000,44))
    comparison.save(OUT/'cylinders_before_after.jpg',quality=96)

def cord_checks(maps,raw_height,fields,metrics):
    """Retain the accepted independent checks of the delivered cord structure."""
    assertions=metrics['assertions']; revision={}
    z=raw_height[1434:1782]*RANGE;rgb=maps['wood_base'][1434:1782];orm=maps['wood_orm'][1434:1782]
    record=json.loads((OUT/'construction.json').read_text())['bands'][3]
    turns=record['turns'];edges=np.array([t['x_edges'][0] for t in turns]+[2048])
    widths=np.diff(edges);profile=z.mean(0)
    peaks,_=find_peaks(np.tile(profile,3),distance=9,prominence=2)
    peaks=peaks[(peaks>=2048)&(peaks<4096)]-2048
    assertions['cord_complete_turn_grid']=bool(edges[0]==0 and edges[-1]==2048 and np.all((widths>=11)&(widths<=14)))
    assertions['cord_delivered_turn_count']=bool(len(peaks)==len(turns)==164 and all(((peaks>=a)&(peaks<b)).sum()==1 for a,b in zip(edges[:-1],edges[1:])))
    crest=[];trough=[];spectra=[];continuous=[];diagonal_slopes=[]
    for a,b in zip(edges[:-1],edges[1:]):
        crest.append(float(profile[a:b].max()));trough.append(float(min(profile[a],profile[b-1])))
        continuous.append(float(z[:,a:b].max(1).min()))
        # Two plies cross the turn centre twice per complete helix rotation.
        trace=z[:,(a+b)//2];spec=np.abs(np.fft.rfft(trace-trace.mean()))
        spectra.append(int(np.argmax(spec[1:])+1))
        # The ridge phase must move across X, establishing diagonal lay.
        left=z[:,a+(b-a)//3];right=z[:,b-1-(b-a)//3]
        freq=spectra[-1];fl=np.fft.rfft(left-left.mean())[freq];fr=np.fft.rfft(right-right.mean())[freq]
        diagonal_slopes.append(float(abs(np.angle(fr*np.conj(fl)))))
    gap=fields['cord_gaps']>.75;groove=fields['cord_grooves']>.4;body=(fields['cord_gaps']<.05)&(fields['cord_grooves']<.02)
    assertions['cord_round_turn_relief']=bool(min(np.array(crest)-trough)>2.5)
    assertions['cord_continuous_top_to_bottom']=min(continuous)>6
    assertions['cord_two_ply_twist']=bool(all(16<=x<=22 and x%2==0 for x in spectra))
    assertions['cord_diagonal_ridges']=float(np.median(diagonal_slopes))>.4
    assertions['cord_seam_between_whole_turns']=bool(max(profile[0],profile[-1])<np.median(crest)-2.5)
    assertions['cord_deep_gap_height']=bool(z[body].mean()>z[gap].mean()+3)
    assertions['cord_gap_and_ply_occlusion']=bool(orm[gap,0].mean()<orm[body,0].mean()*.5 and orm[groove,0].mean()<orm[body,0].mean())
    assertions['cord_dry_straw_colour']=bool(185<rgb[...,0].mean()<220 and 160<rgb[...,1].mean()<200 and 110<rgb[...,2].mean()<160)
    assertions['height_unclipped']=bool(raw_height.min()>0 and raw_height.max()<1)
    revision['cord']={'turn_count_detected':len(peaks),'width_pixels_min_max':[int(widths.min()),int(widths.max())],
        'diameter_mm_min_max':[float(widths.min()*SCALE),float(widths.max()*SCALE)],
        'mean_height_crest_range_mm':[min(crest),max(crest)],'mean_gap_height_mm':float(z[gap].mean()),
        'mean_body_height_mm':float(z[body].mean()),'mean_ao_gap':float(orm[gap,0].mean()/255),
        'mean_ao_ply_groove':float(orm[groove,0].mean()/255),'mean_ao_body':float(orm[body,0].mean()/255),
        'centre_ridge_cycles_detected':sorted(set(spectra)),'median_diagonal_phase_radians':float(np.median(diagonal_slopes)),
        'cylinder_preview':{'band_width_cm':6,'pole_diameter_cm':14,'sleeve_radial_offset_mm':4}}
    metrics['cord']=revision['cord']
    # At 1:1 plus nearest-neighbour enlargement, show maps and opposing relief.
    detail=Image.new('RGB',(1536,4*384),(24,24,24));n=norm(maps['wood_normal']/127.5-1)
    views=[('Base colour',rgb),('Height / 10 mm',np.repeat((z/10*255)[...,None],3,axis=2)),
           ('OpenGL normal',maps['wood_normal'][1434:1782]),('AO / roughness / metal',orm),
           ('Light from left',shade(rgb,n[1434:1782],orm,(-.65,.35,.42))),
           ('Light from right',shade(rgb,n[1434:1782],orm,(.65,-.35,.42)))]
    for i,(name,a) in enumerate(views):
        x=i%3*512;y=i//3*384;label(detail,name+' / 1:1',(x+8,y+6),18)
        detail.paste(im(a[:348,128:640]),(x,y+32))
    for i in range(3):
        name,a=views[[0,4,5][i]];label(detail,name+' / 3x pixels',(512*i+8,780),18)
        detail.paste(im(a[70:302,200:368]).resize((504,696),Image.Resampling.NEAREST),(512*i,820))
    detail.save(OUT/'cord_detail.png')


def round3_checks(maps,fields,metrics):
    """Compare delivered pixels with the frozen round-2 acceptance baseline.

    Colour targets are measured independently from the builder. Feature masks
    are also checked against the baseline, so recolouring cannot move a feature.
    """
    assertions=metrics['assertions']; revision={}; baseline=OUT/'round2'
    manifest=json.loads((OUT/'round3_baseline.json').read_text())
    revision['baseline_sha256_unchanged']={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest
                                          for name,digest in manifest['baseline_files'].items()}
    assertions['round2_baseline_preserved']=all(revision['baseline_sha256_unchanged'].values())
    revision['source_sha256_unchanged']={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest
                                        for name,digest in manifest['sources'].items()}
    assertions['all_round2_sources_preserved']=all(revision['source_sha256_unchanged'].values())
    for name in maps:
        old=np.array(Image.open(baseline/(name+'.png')))
        current=np.array(Image.open(ROOT/(name+'.png')))
        a,b=(current[1434:1782],old[1434:1782]) if name=='wood_base' else (current,old)
        difference=int(np.abs(a.astype(np.int64)-b.astype(np.int64)).max())
        revision[name+'_protected_max_difference']=difference
        assertions[name+'_round2_protected_pixels_identical']=difference==0
    previous_fields=np.load(baseline/'feature_fields.npz')
    protected=['bark','incisions','disc_mask','cord_grooves','cord_gaps','cord_plies','cord_fray']
    revision['feature_fields_identical']={k:bool(np.array_equal(fields[k],previous_fields[k])) for k in protected}
    assertions['round2_feature_fields_preserved']=all(revision['feature_fields_identical'].values())
    previous=json.loads((baseline/'construction.json').read_text())
    current=json.loads((OUT/'construction.json').read_text())
    keys=['size','tile_metres','mm_per_pixel','height_range_mm','reference_height_mm','normal_convention','bands','end_cells']
    assertions['round2_layout_and_construction_preserved']=all(current[k]==previous[k] for k in keys)

    base=maps['wood_base']; bark=fields['bark']; incisions=fields['incisions']
    revision['bands']=[]; bark_means=[]
    for i,(y0,y1,name) in enumerate(BANDS[:3]):
        a=base[y0:y1];b=bark[y0:y1];inc=incisions[y0:y1]
        lichen=fields['lichen'][y0:y1];weather=fields['weather'][y0:y1]
        core=(b>.95)&(lichen<.01);luma=a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722
        fresh=(b<.05)&(weather<.02);aged=(b<.05)&(weather>.25)
        fissure=core&(inc>.25);ridge=core&(inc<.02)
        flecks=(lichen>.6)&(b>.95)
        record={'index':i+1,'whole_band_mean_rgb':a.mean((0,1),dtype=np.float64).tolist(),
                'bark_core_mean_rgb':a[core].mean(0,dtype=np.float64).tolist(),
                'fresh_wood_mean_rgb':a[fresh].mean(0,dtype=np.float64).tolist(),
                'weathered_wood_mean_rgb':a[aged].mean(0,dtype=np.float64).tolist(),
                'lichen_coverage':float((lichen>.5).sum()/max((b>.95).sum(),1)),
                'lichen_mean_rgb':a[flecks].mean(0,dtype=np.float64).tolist(),
                'bark_luma_p10_p90':np.quantile(luma[core],[.1,.9]).tolist(),
                'fissure_luma_mean':float(luma[fissure].mean()),'ridge_luma_mean':float(luma[ridge].mean())}
        bark_means.append(np.array(record['bark_core_mean_rgb']))
        assertions[f'band_{i+1}_dark_fissures_light_ridges']=record['ridge_luma_mean']>record['fissure_luma_mean']+15
        assertions[f'band_{i+1}_bark_contrast']=bool(np.diff(record['bark_luma_p10_p90'])[0]>25)
        assertions[f'band_{i+1}_sparse_grey_lichen']=bool(.001<record['lichen_coverage']<.04 and flecks.sum()>100
                                                      and np.ptp(record['lichen_mean_rgb'])<32)
        if i in (0,1):
            assertions[f'band_{i+1}_fresh_honey_wood']=bool(np.max(np.abs(np.array(record['fresh_wood_mean_rgb'])-[185,145,95]))<4)
            fresh_chroma=record['fresh_wood_mean_rgb'][0]-record['fresh_wood_mean_rgb'][2]
            aged_chroma=record['weathered_wood_mean_rgb'][0]-record['weathered_wood_mean_rgb'][2]
            assertions[f'band_{i+1}_wood_weathers_greyer']=aged_chroma<fresh_chroma-8
        if i in (0,2):
            target=[115,80,52] if i==0 else [125,88,56]
            assertions[f'band_{i+1}_target_brown']=bool(np.max(np.abs(np.array(record['whole_band_mean_rgb'])-target))<5)
        revision['bands'].append(record)
    assertions['peeled_bark_islands_match_band_1']=bool(np.max(np.abs(bark_means[1]-bark_means[0]))<3)
    yy,xx=np.mgrid[:256,:256];radius=np.hypot(xx-127.5,yy-127.5)
    face=radius<119;rim=(radius>=124)&(radius<=125);ends=[]
    for i in range(6):
        x=56+i*336;a=base[1787:2043,x:x+256]
        record={'index':i+1,'face_mean_rgb':a[face].mean(0,dtype=np.float64).tolist(),
                'rim_mean_rgb':a[rim].mean(0,dtype=np.float64).tolist()}
        ends.append(record)
        assertions[f'end_{i+1}_honey_face_dark_bark_rim']=bool(np.max(np.abs(np.array(record['face_mean_rgb'])-[190,150,100]))<2
            and np.max(np.abs(np.array(record['rim_mean_rgb'])-[98,65,41]))<2)
    revision['ends']=ends
    revision['whole_end_band_mean_rgb']=base[1782:].mean((0,1),dtype=np.float64).tolist()
    assertions['base_unclipped']=bool(base.min()>0 and base.max()<255)
    metrics['round3']=revision

    old=np.array(Image.open(baseline/'wood_base.png'))
    compare=Image.new('RGB',(1536,4*348),(24,24,24))
    crops=[(300,20,1068,320,'Bark-on'),(300,714,1068,1014,'Half-peeled'),
           (300,1126,1068,1434,'Thin sticks'),(56,1782,824,2048,'Cut ends')]
    for row,(x0,y0,x1,y1,title) in enumerate(crops):
        for col,(version,a) in enumerate([('Round 2',old),('Round 3',base)]):
            label(compare,f'{title} / {version}',(col*768+12,row*348+6),20)
            compare.paste(im(a[y0:y1,x0:x1]),(col*768,row*348+36))
    compare.save(OUT/'bark_before_after.jpg',quality=96)


def main():
    started=time.monotonic()
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-rebuild',action='store_true',help='rebuild offline and require identical decoded pixels in all four maps')
    args=parser.parse_args()
    if args.verify_rebuild:
        names=['wood_base','wood_height','wood_normal','wood_orm']
        before={k:np.array(Image.open(ROOT/(k+'.png'))) for k in names}
        subprocess.run([sys.executable,str(ROOT/'build_material.py')],check=True,cwd=ROOT)
        rebuild={}
        for k in names:
            a=np.array(Image.open(ROOT/(k+'.png')))
            rebuild[k]={'identical_pixels':bool(np.array_equal(before[k],a)),
                        'max_integer_difference':int(np.abs(before[k].astype(np.int64)-a.astype(np.int64)).max()),
                        'pixel_sha256':hashlib.sha256(a.tobytes()).hexdigest()}
        rebuild['all_passed']=all(v['identical_pixels'] for v in rebuild.values())
        (OUT/'rebuild_verification.json').write_text(json.dumps(rebuild,indent=2)+'\n')
        if not rebuild['all_passed']:raise SystemExit('Rebuild changed delivered pixels')
    OUT.mkdir(exist_ok=True);metrics={'files':{},'bands':[],'assertions':{}}
    maps={}; raw_height=None
    for name in ['wood_base','wood_height','wood_normal','wood_orm']:
        path=ROOT/(name+'.png');data=path.read_bytes();pic=Image.open(path)
        a=np.array(pic);w,h,bitdepth,colortype=struct.unpack('>IIBB',data[16:26])
        metrics['files'][name]={'size':[w,h],'mode':pic.mode,'bit_depth':bitdepth,'png_color_type':colortype,
                              'icc_profile_present':bool(pic.info.get('icc_profile')),'sha256':hashlib.sha256(data).hexdigest(),
                              'pixel_sha256':hashlib.sha256(a.tobytes()).hexdigest()}
        metrics['assertions'][name+'_contract']=bool((w,h)==(2048,2048) and bitdepth==(16 if name=='wood_height' else 8) and colortype==(0 if name=='wood_height' else 2))
        metrics['assertions'][name+'_profile']=bool(bool(pic.info.get('icc_profile'))==(name=='wood_base'))
        if name=='wood_height':raw_height=a.astype(np.float64)/65535;maps[name]=a.astype(np.float32)/257
        else:maps[name]=a.astype(np.float32)
    decoded=maps['wood_normal']/127.5-1;normal=norm(decoded)
    expected=independent_normals(raw_height)
    error=np.degrees(np.arccos(np.clip(np.sum(expected*normal,axis=2),-1,1)))
    metrics['normal_height_agreement_degrees']={'mean':float(error.mean()),'p99':float(np.quantile(error,.99)),'max':float(error.max())}
    metrics['normal_encoded_length']={'min':float(np.linalg.norm(decoded,axis=2).min()),'max':float(np.linalg.norm(decoded,axis=2).max())}
    metrics['assertions']['normal_matches_delivered_height']=bool(error.max()<.45)
    metrics['assertions']['zero_metalness']=bool(np.all(maps['wood_orm'][...,2]==0))
    fields=np.load(OUT/'feature_fields.npz');bark=fields['bark'];inc=fields['incisions']
    for i,(y0,y1,name) in enumerate(BANDS):
        b=bark[y0:y1];z=raw_height[y0:y1]*RANGE;occ=maps['wood_orm'][y0:y1, :,0]/255;rough=maps['wood_orm'][y0:y1,:,1]/255
        e={'index':i+1,'name':name,'rows_half_open':[y0,y1],'bark_fraction':float((b>.5).mean()),'seams':{},
           'mean_rgb':maps['wood_base'][y0:y1].mean((0,1)).tolist(),'height_mm_min_max':[float(z.min()),float(z.max())]}
        for key,a in maps.items():
            e['seams'][key]={'x':seam_metric(a[y0:y1],1),'y':seam_metric(a[y0:y1],0)}
            for axis in ['x','y']:metrics['assertions'][f'band_{i+1}_{key}_{axis}_wrap']=e['seams'][key][axis]['pass']
        for mask,key in [(b>.95,'bark'),(b<.05,'wood')]:
            if mask.sum():
                e[key+'_mean_height_mm']=float(z[mask].mean());e[key+'_mean_roughness']=float(rough[mask].mean())
        if i<2:metrics['assertions'][f'band_{i+1}_raised_bark']=e['bark_mean_height_mm']>e['wood_mean_height_mm']+1.
        if i<3:metrics['assertions'][f'band_{i+1}_rough_bark']=bool(np.quantile(rough[b>.95],.01)>=.80 and np.quantile(rough[b>.95],.99)<=.95)
        cut=inc[y0:y1]>.4; clear=inc[y0:y1]<.02
        e['ao_checks_mean']=float(occ[cut].mean()) if cut.any() else 1.
        e['ao_clear_mean']=float(occ[clear].mean())
        metrics['assertions'][f'band_{i+1}_cavity_ao']=e['ao_checks_mean']<e['ao_clear_mean']
        res=maps['wood_base'][y0:y1]-ndi.gaussian_filter(maps['wood_base'][y0:y1],(1,1,0),mode='wrap')
        e['native_detail_rms_codevalues']=float(np.sqrt(np.mean(res**2)))
        metrics['bands'].append(e)
    metrics['assertions']['band_1_mostly_bark']=.65<metrics['bands'][0]['bark_fraction']<.95
    metrics['assertions']['band_2_mixed_wood_bark']=.25<metrics['bands'][1]['bark_fraction']<.65
    metrics['assertions']['band_3_mostly_bark']=.70<metrics['bands'][2]['bark_fraction']<=1
    metrics['assertions']['band_4_no_bark']=metrics['bands'][3]['bark_fraction']<.03
    # Independently check six regular connected circular end-grain regions.
    lab,count=ndi.label(fields['disc_mask']>.5); centers=ndi.center_of_mass(fields['disc_mask'],lab,range(1,count+1))
    metrics['end_disc_centers_xy']=[[float(x),float(y+1782)] for y,x in centers]
    metrics['assertions']['six_end_discs']=count==6
    metrics['assertions']['regular_disc_grid']=bool(count==6 and np.allclose(np.diff([x for y,x in centers]),336) and np.allclose([y for y,x in centers],132.5))
    cord_checks(maps,raw_height,fields,metrics)
    round3_checks(maps,fields,metrics)
    metrics['all_passed']=all(metrics['assertions'].values())
    # Height offsets retain their full delivered precision as well as sheet view.
    ho=(raw_height*65535).round().astype(np.uint16)
    for y0,y1,_ in BANDS:ho[y0:y1]=np.roll(ho[y0:y1],((y1-y0)//2,1024),(0,1))
    sheets(maps,normal);Image.fromarray(ho).save(OUT/'wood_height_half_offset.png')
    print('Rendering physical cylinders...',flush=True);cylinders(maps,normal)
    # One generated source overview, for provenance and native density inspection.
    files=sorted((ROOT/'source').glob('generated_*.png'));overview=Image.new('RGB',(1536,((len(files)+2)//3)*540),(24,24,24))
    for i,p in enumerate(files):
        x=i%3*512;y=i//3*540;label(overview,p.stem,(x+10,y+8),18);overview.paste(panel(Image.open(p),512),(x,y+28))
    overview.save(OUT/'source_overview.jpg',quality=94)
    metrics['check_seconds']=time.monotonic()-started
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    failed=[k for k,v in metrics['assertions'].items() if not v]
    print(json.dumps({'all_passed':metrics['all_passed'],'failed':failed,'normal_error':metrics['normal_height_agreement_degrees'],
                      'bark_fractions':[b['bark_fraction'] for b in metrics['bands']]},indent=2))
    if failed:raise SystemExit(1)

if __name__=='__main__':main()
