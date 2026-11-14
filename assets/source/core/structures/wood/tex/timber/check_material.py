"""Independent numerical checks and visual review artifacts for timber."""
from pathlib import Path
import colorsys
import json
import struct
import hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
OUT.mkdir(exist_ok=True)
N = 2048
MM_PX = 3000/N
HEIGHT_MM = 16
def font(size):
    for name in ('/System/Library/Fonts/Supplemental/Arial.ttf','DejaVuSans.ttf'):
        try: return ImageFont.truetype(name,size)
        except OSError: pass
    return ImageFont.load_default(size=size)

FONT = font(18)
SMALL = font(15)
BG = (24,26,27)


def img(a):
    return Image.fromarray(np.asarray(a).astype(np.uint8))


def linear(a):
    a = a/255.0
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)


def encoded(a):
    a = np.maximum(a,0)
    a = np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)
    return np.rint(np.clip(a,0,1)*255).astype(np.uint8)


def lit(base, norm, orm, direction, ambient=.31, direct=1.08):
    n = norm.astype(np.float32)/127.5-1
    n /= np.linalg.norm(n,axis=2,keepdims=True)
    light = np.array(direction,dtype=np.float32)
    light /= np.linalg.norm(light)
    half = light+np.array([0,0,1])
    half /= np.linalg.norm(half)
    nl = np.clip(np.sum(n*light,axis=2),0,1)
    nh = np.clip(np.sum(n*half,axis=2),0,1)
    nv = np.clip(n[...,2],.01,1)
    rough = orm[...,1]/255
    alpha2 = rough**4
    D = alpha2/(np.pi*(nh*nh*(alpha2-1)+1)**2)
    k = (rough+1)**2/8
    G = nl/(nl*(1-k)+k)*nv/(nv*(1-k)+k)
    F = .04+.96*(1-np.clip(half[2],0,1))**5
    spec = D*G*F/(4*np.maximum(nl*nv,.005))*nl
    ao = orm[...,0]/255
    return encoded(linear(base)*(ambient*ao[...,None]+nl[...,None]*direct)+spec[...,None]*.55)


def panel(images, titles, cols=2, size=680, filename='layers.jpg'):
    rows = (len(images)+cols-1)//cols
    out = Image.new('RGB',(cols*size,rows*(size+36)),BG)
    draw = ImageDraw.Draw(out)
    for i,(im,title) in enumerate(zip(images,titles)):
        x=(i%cols)*size; y=(i//cols)*(size+36)
        if not isinstance(im,Image.Image): im=img(im)
        im=im.convert('RGB').copy()
        im.thumbnail((size,size),Image.Resampling.LANCZOS)
        out.paste(im,(x+(size-im.width)//2,y+36+(size-im.height)//2))
        draw.text((x+12,y+9),title,font=FONT,fill=(225,225,218))
    out.save(OUT/filename,quality=95)
    return out


def header(path):
    data=path.read_bytes()
    width,height,depth,ctype,_,_,_=struct.unpack('>IIBBBBB',data[16:29])
    chunks=[]; at=8
    while at<len(data):
        length=struct.unpack('>I',data[at:at+4])[0]
        chunks.append(data[at+4:at+8].decode('ascii'))
        at+=12+length
    return dict(width=width,height=height,bit_depth=depth,color_type=ctype,chunks=chunks,
                sha256=hashlib.sha256(data).hexdigest())


def run():
    paths={key:ROOT/f'timber_{key}.png' for key in ('base','height','normal','orm')}
    base=np.asarray(Image.open(paths['base']))
    h16=np.asarray(Image.open(paths['height']))
    normal=np.asarray(Image.open(paths['normal']))
    orm=np.asarray(Image.open(paths['orm']))
    config=json.loads((ROOT/'source'/'construction.json').read_text())
    fields=np.load(ROOT/'source'/'construction_fields.npz')
    h=h16.astype(np.float64)/65535*HEIGHT_MM
    # Recompute using padded slices, independent of the builder's np.roll implementation.
    p=np.pad(h,1,mode='wrap')
    vx=-(p[1:-1,2:]-p[1:-1,:-2])/(2*MM_PX)
    vy=(p[2:,1:-1]-p[:-2,1:-1])/(2*MM_PX)
    nz=1/np.sqrt(vx*vx+vy*vy+1)
    true=np.stack((vx*nz,vy*nz,nz),axis=2)
    rebuilt=np.rint((true+1)*127.5).astype(np.uint8)
    decoded=normal.astype(np.float64)/127.5-1
    length=np.linalg.norm(decoded,axis=2)
    decoded/=length[...,None]
    angle=np.degrees(np.arccos(np.clip(np.sum(decoded*true,axis=2),-1,1)))
    # Pixel-centre rasterisation of mathematically exact k*2048/12 boundaries.
    ids=np.floor((np.arange(N)+.5)*12/N).astype(np.uint8)
    assert np.array_equal(ids,fields['band_ids'])
    assert np.array_equal(rebuilt,normal), 'Normals do not agree with delivered height!'
    assert np.all(orm[...,2]==0)
    for key,path in paths.items():
        hd=header(path)
        assert hd['width']==hd['height']==N
        assert hd['bit_depth']==(16 if key=='height' else 8)
        assert hd['color_type']==(0 if key=='height' else 2)
        if key!='base': assert not any(c in hd['chunks'] for c in ('iCCP','sRGB','gAMA'))
    seams={}
    for key,a in [('base',base),('height_mm',h),('normal',normal),('orm',orm)]:
        a=a.astype(float)
        if a.ndim==2:a=a[...,None]
        delta=np.abs(a[:,1:]-a[:,:-1]).mean(axis=(0,2))
        wrap=float(np.abs(a[:,0]-a[:,-1]).mean())
        boundary_rows=np.flatnonzero(ids[1:]!=ids[:-1])+1
        internal_y=[float(np.abs(a[j]-a[j-1]).mean()) for j in boundary_rows]
        seams[key]=dict(horizontal_wrap_mean=wrap,
            interior_column_delta_mean=float(delta.mean()),
            interior_column_delta_p95=float(np.percentile(delta,95)),
            horizontal_wrap_within_interior_p95=bool(wrap<=np.percentile(delta,95)),
            vertical_wrap_mean=float(np.abs(a[0]-a[-1]).mean()),
            band_boundary_delta_range=[min(internal_y),max(internal_y)])
    metrics=dict(files={k:header(p) for k,p in paths.items()},
        mean_srgb=base.mean(axis=(0,1)).tolist(),
        height_range_mm=[float(h.min()),float(h.max())],
        normal_max_byte_error=int(np.max(np.abs(rebuilt.astype(int)-normal.astype(int)))),
        normal_mismatched_channels=int(np.count_nonzero(rebuilt!=normal)),
        normal_quantization_degrees=dict(mean=float(angle.mean()),p99=float(np.percentile(angle,99)),max=float(angle.max())),
        normal_decoded_length_range=[float(length.min()),float(length.max())],
        metal_nonzero_pixels=int(np.count_nonzero(orm[...,2])),
        roughness_percentiles=np.percentile(orm[...,1]/255,[0,1,10,50,90,99,100]).tolist(),
        ao_percentiles=np.percentile(orm[...,0]/255,[0,1,10,50,90,99,100]).tolist(),
        band_pixel_counts=np.bincount(ids).tolist(),
        band_mean_srgb=[base[ids==k].mean(axis=(0,1)).tolist() for k in range(12)],
        seams=seams,
        source_sizes={k:list(Image.open(ROOT/'source'/f'generated_{k}.png').size) for k in 'abc'})
    metrics['surface_by_band']=[]
    for k in range(12):
        interior=(ids==k) & (np.minimum((np.arange(N)+.5)-k*N/12,
                                      (k+1)*N/12-(np.arange(N)+.5))*MM_PX>12)
        slope=np.degrees(np.arccos(true[interior,:,2]))
        metrics['surface_by_band'].append(dict(band=k,
            treatment=config['bands'][k]['treatment'],
            interior_height_p1_p50_p99_mm=np.percentile(h[interior],[1,50,99]).tolist(),
            normal_tilt_p50_p95_degrees=np.percentile(slope,[50,95]).tolist(),
            axe_cut_max_mm=float(fields['tool_depth_mm'][ids==k].max()),
            kerf_cut_max_mm=float(fields['kerf_depth_mm'][ids==k].max()),
            check_cut_max_mm=float(fields['check_depth_mm'][ids==k].max()),
            fibre_height_std_mm=float(fields['fibre_relief_mm'][interior].std())))
    assert all(v['horizontal_wrap_within_interior_p95'] for v in seams.values()), seams
    # Physical feature checks supplement the visual review and normal agreement.
    for band,surface in zip(config['bands'],metrics['surface_by_band']):
        kind=band['treatment']
        if kind=='hewn':
            assert all(80<=c['length_mm']<=200 and 2<=c['cut_depth_mm']<=5 for c in band['axe_cuts'])
            lo,_,hi=surface['interior_height_p1_p50_p99_mm']
            assert hi-lo>3, 'Hewn face has lost its broad surface relief'
        if kind=='sawn':
            assert all(5<=c['spacing_mm']<=15 and .3<=c['cut_depth_mm']<=.6 for c in band['saw_cuts'])
            assert .45<surface['kerf_cut_max_mm']<=.61
        if kind=='weathered':
            assert surface['normal_tilt_p50_p95_degrees'][1]>15
    for check in config['drying_checks']:
        assert 3<=check['width_mm']<=8 and 400<=check['length_mm']<=1200
        assert metrics['surface_by_band'][check['band']]['check_cut_max_mm']>5
    metrics['physical_feature_checks_passed']=True
    # Pass-four acceptance: compare against the frozen pre-edit material.
    prior3=OUT/'pass3'
    baseline=json.loads((prior3/'baseline.json').read_text())
    oldconfig=json.loads((prior3/'construction.json').read_text())
    oldbase3=np.asarray(Image.open(prior3/'timber_base.png'))
    unchanged_maps={key:metrics['files'][key]['sha256']==baseline['files'][f'timber_{key}.png']
                    for key in ('height','normal','orm')}
    unchanged_fields={key:hashlib.sha256(fields[key].tobytes()).hexdigest()==expected
                      for key,expected in baseline['construction_field_sha256'].items()}
    palette_keys={'revision','build_seconds','base_mean_srgb','arris_srgb','palette_method'}
    unchanged_construction=({k:v for k,v in config.items() if k not in palette_keys}==
                            {k:v for k,v in oldconfig.items() if k not in palette_keys})
    unchanged_sources={name:hashlib.sha256((ROOT/'source'/name).read_bytes()).hexdigest()==expected
                       for name,expected in baseline['source_sha256'].items()}
    unchanged_profile=hashlib.sha256((ROOT/'source'/'srgb.icc').read_bytes()).hexdigest()==baseline['srgb_profile_sha256']
    assert all(unchanged_maps.values()), 'Protected data maps differ from pass three'
    assert all(unchanged_fields.values()) and unchanged_construction, 'Construction or layout changed'
    assert all(unchanged_sources.values()) and unchanged_profile, 'Frozen source/profile changed'
    # Written Material palette values, not the warm painted reference samples.
    target=np.array([98,67,45])
    arris_target=np.array([118,82,55])
    board_target=np.array([172,128,82])
    oldmean=oldbase3.mean(axis=(0,1))
    newmean=np.array(metrics['mean_srgb'])
    bandmeans=np.array(metrics['band_mean_srgb'])
    oldbandmeans=np.array([oldbase3[ids==k].mean(axis=(0,1)) for k in range(12)])
    band_error=np.max(np.abs((bandmeans-newmean)-(oldbandmeans-oldmean)))
    delta=base.astype(np.int16)-oldbase3.astype(np.int16)
    edge=fields['arris'].astype(np.float64)
    expected_offset=(target-oldmean)+(edge[...,None]-edge.mean())*(arris_target-target)
    residual=delta-expected_offset
    # The 170/171-row bands sample the same continuous arris at different
    # subpixel positions; account for their small difference in rubbed area.
    band_edge_shift=(np.array([edge[ids==k].mean() for k in range(12)])[:,None]-edge.mean())*(arris_target-target)
    band_pigment_error=np.max(np.abs((bandmeans-newmean)-(oldbandmeans-oldmean)-band_edge_shift))
    assert np.max(np.abs(newmean-target))<.01, 'Base mean missed the concept palette'
    assert band_error<.1 and band_pigment_error<.01, 'Band-to-band pigment variety changed'
    # The two separately rounded PNGs allow up to one byte of offset error.
    # This pixelwise comparison also protects the pigment in all tool marks.
    assert np.max(np.abs(residual))<1.001, 'Native colour detail changed beyond palette/arris offsets'
    arris_mean=base[edge>.8].mean(axis=0)
    interior_mean=base[edge==0].mean(axis=0)
    arris_by_band=np.array([base[ids==k][edge[ids==k]>.8].mean(axis=0) for k in range(12)])
    interior_by_band=np.array([base[ids==k][edge[ids==k]==0].mean(axis=0) for k in range(12)])
    assert np.max(np.abs(arris_mean-arris_target))<4, 'Rubbed arrises missed T+'
    assert np.all(arris_by_band-interior_by_band>np.array([10,8,5])), 'A band lost its rubbed edges'
    weathered=[b['band'] for b in config['bands'] if b['treatment']=='weathered']
    fresh=[b['band'] for b in config['bands'] if b['treatment']!='weathered']
    saturation=np.array([colorsys.rgb_to_hsv(*(rgb/255))[1] for rgb in bandmeans])
    old_saturation=np.array([colorsys.rgb_to_hsv(*(rgb/255))[1] for rgb in oldbandmeans])
    assert np.all(saturation<old_saturation), 'A band is still as saturated as pass three'
    assert np.all(bandmeans[:,0]>bandmeans[:,1]) and np.all(bandmeans[:,1]>bandmeans[:,2])
    assert saturation[weathered].max()<saturation[fresh].min(), 'Weathered bands lost their greyer character'
    luminance=lambda rgb: float(linear(rgb) @ np.array([.2126,.7152,.0722]))
    frame_hue=colorsys.rgb_to_hsv(*(newmean/255))[0]*360
    old_hue=colorsys.rgb_to_hsv(*(oldmean/255))[0]*360
    board_hue=colorsys.rgb_to_hsv(*(board_target/255))[0]*360
    assert old_hue<frame_hue<board_hue and luminance(newmean)<luminance(board_target)*.4
    metrics['palette_revision']=dict(
        revision=4,pass3_mean_srgb=oldmean.tolist(),target_mean_srgb=target.tolist(),
        arris_target_srgb=arris_target.tolist(),arris_outer_mean_srgb=arris_mean.tolist(),
        interior_mean_srgb=interior_mean.tolist(),arris_outer_band_mean_srgb=arris_by_band.tolist(),
        interior_band_mean_srgb=interior_by_band.tolist(),
        mean_delta_srgb=(newmean-oldmean).tolist(),
        max_band_relative_mean_error=float(band_error),
        max_band_pigment_mean_error_after_arris=float(band_pigment_error),
        max_pixel_offset_error=float(np.max(np.abs(residual))),
        channel_min_max=[base.min(axis=(0,1)).tolist(),base.max(axis=(0,1)).tolist()],
        band_hsv_saturation=saturation.tolist(),
        board_reference_srgb=board_target.tolist(),
        hue_degrees=dict(pass3_frame=old_hue,frame=frame_hue,board_reference=board_hue),
        linear_luminance=dict(frame=luminance(newmean),board_reference=luminance(board_target)),
        data_maps_byte_identical_to_pass3=unchanged_maps,
        construction_fields_identical_to_pass3=unchanged_fields,
        construction_and_layout_identical_to_pass3=unchanged_construction,
        generated_sources_identical_to_pass3=unchanged_sources,
        srgb_profile_identical_to_pass3=unchanged_profile)
    panel([oldbase3,base],
          ['PASS 3 | unlit base, mean (100, 58, 36)',
           'PASS 4 | unlit base, mean (98, 67, 45)'],
          cols=2,size=900,filename='base_before_after.jpg')
    palette=Image.new('RGB',(900,900),BG)
    draw=ImageDraw.Draw(palette)
    for i,(rgb,label) in enumerate([(oldmean,'PASS 3 | timber (100, 58, 36)'),
                                   (newmean,'PASS 4 / T | timber (98, 67, 45)'),
                                   (arris_target,'T+ | rubbed arris target (118, 82, 55)'),
                                   (board_target,'B | board reference only (172, 128, 82)')]):
        y=20+i*220
        draw.text((24,y),label,font=font(24),fill=(225,225,218))
        draw.rectangle((24,y+45,876,y+195),fill=tuple(np.rint(rgb).astype(int)))
    palette.save(OUT/'palette_reference.png')
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    # Diagnostic height is a display conversion, not the delivered uint16 image.
    hg=np.rint(h/HEIGHT_MM*255).astype(np.uint8)
    maps=[base,hg,normal,orm]
    titles=['BASE | sRGB, unlit','HEIGHT | 0–16 mm, white high','NORMAL | OpenGL, true metric scale','ORM | AO / roughness / metalness=0']
    panel(maps,titles,filename='layers.jpg')
    for key,a in zip(('base','height','normal','orm'),maps):
        img(np.roll(a,(N//2,N//2),axis=(0,1))).save(OUT/f'offset_{key}.png')
    panel([np.roll(a,(N//2,N//2),axis=(0,1)) for a in maps],
          ['HALF OFFSET | '+s.split(' | ')[0] for s in titles],filename='offsets.jpg')
    # Native 6144x6144 repetitions and compact 3x3 review.
    small=[]
    for key,a in zip(('base','normal','orm'),(base,normal,orm)):
        repeated=np.tile(a,(3,3,1))
        img(repeated).save(OUT/f'tiling_3x3_{key}.jpg',quality=95)
        small.append(img(repeated))
    panel(small,['BASE | 9m × 9m repeat','NORMAL | 9m × 9m repeat','ORM | 9m × 9m repeat'],
          cols=3,size=600,filename='tilings.jpg')
    lights=[lit(base,normal,orm,(-.85,.30,.38)),lit(base,normal,orm,(.85,-.30,.38))]
    for i,a in enumerate(lights):img(a).save(OUT/f'lit_{i+1}.png')
    panel(lights,['LIGHT A | upper left, raking','LIGHT B | lower right, raking'],
          cols=2,size=850,filename='relighting.jpg')
    grazing_directions=[(-1,.14,.14),(1,-.14,.14),(-.20,1,.20)]
    grazing=[lit(base,normal,orm,direction,.08,2.8) for direction in grazing_directions]
    for i,a in enumerate(grazing):img(a).save(OUT/f'lit_raking_{i+1}.png')
    panel(grazing,['STRONG RAKE | 7.9 degrees, from left','STRONG RAKE | 7.9 degrees, from right',
                  'CROSS-GRAIN RAKE | 11.1 degrees'],
          cols=3,size=900,filename='strong_raking.jpg')
    neutral=np.full_like(base,145)
    clay_orm=orm.copy(); clay_orm[...,1]=170
    clays=[lit(neutral,normal,clay_orm,direction,.08,2.8) for direction in grazing_directions]
    for i,a in enumerate(clays):img(a).save(OUT/f'relief_raking_{i+1}.png')
    panel(clays,['ACTUAL RELIEF | 7.9 degree left rake','ACTUAL RELIEF | 7.9 degree right rake',
                'ACTUAL RELIEF | 11.1 degree cross-grain rake'],
          cols=3,size=900,filename='relief_review.jpg')
    # Full-resolution cross-wrap samples, with the seam at x=512 in each panel.
    seam_detail=Image.new('RGB',(2048,12*112),BG)
    draw=ImageDraw.Draw(seam_detail)
    for k in range(12):
        cy=int((k+.5)*N/12)
        ys=np.arange(cy-42,cy+42)
        xs=np.arange(N-512,N+512)%N
        for col,a in enumerate((base,lights[1])):
            seam_detail.paste(img(a[np.ix_(ys,xs)]),(col*1024,k*112+24))
            draw.text((col*1024+10,k*112+3),f'{k:02d} | '+('BASE' if col==0 else 'LIT')+' | wrap at panel centre',font=SMALL,fill=(225,225,218))
    seam_detail.save(OUT/'seams_native.jpg',quality=97)
    # All 12 exact boundary lines on a separate overlay only.
    al=img(base).resize((1024,1024),Image.Resampling.LANCZOS)
    draw=ImageDraw.Draw(al)
    for k in range(12):
        yy=k*1024/12
        draw.line((0,round(yy),1023,round(yy)),fill=(115,215,206),width=1)
        draw.text((8,int(yy)+6),f'{k:02d} {config["bands"][k]["treatment"]}',font=FONT,fill=(236,239,217))
    al.save(OUT/'band_alignment.jpg',quality=96)
    # Rotate the trim grain into posts. Every centre crop is 12–25 cm wide.
    widths=[.12,.15,.20,.25,.16,.22,.12,.18,.25,.14,.20,.25]
    post=Image.new('RGB',(1800,2*1110),BG)
    draw=ImageDraw.Draw(post)
    records=[]
    for k,width in enumerate(widths):
        rows=np.flatnonzero(ids==k)
        bh=min(len(rows),round(width*N/3))
        y0=int(round((k+.5)*N/12-bh/2))
        x0=(137+k*127)%1200
        # One metre length shown at exactly 1000 screen px/m.
        cut=lights[k%2][y0:y0+bh,x0:x0+683]
        strip=img(cut).transpose(Image.Transpose.ROTATE_270)
        strip=strip.resize((round(width*1000),1000),Image.Resampling.LANCZOS)
        xx=(k%6)*300+(300-strip.width)//2; yy=(k//6)*1110+60
        post.paste(strip,(xx,yy))
        draw.text(((k%6)*300+20,(k//6)*1110+12),f'{k:02d} {config["bands"][k]["treatment"]} | {width*100:.0f} cm',font=FONT,fill=(230,230,219))
        records.append(dict(band=k,uv_crop=[x0,y0,x0+683,y0+bh],width_m=width,screen_px_per_m=1000))
    post.save(OUT/'post_faces.jpg',quality=96)
    (OUT/'post_crops.json').write_text(json.dumps(records,indent=2)+'\n')
    # Full 3m length post faces, original density, easily inspectable for every band.
    full=Image.new('RGB',(12*185,N+46),BG)
    draw=ImageDraw.Draw(full)
    for k in range(12):
        cut=img(lights[0][ids==k]).transpose(Image.Transpose.ROTATE_270)
        full.paste(cut,(185*k+7,40))
        draw.text((185*k+12,10),f'{k:02d} / 3m',font=FONT,fill=(230,230,219))
    full.save(OUT/'full_length_posts.jpg',quality=96)
    # Native detail sheet: features in matched crops across all four maps and relight.
    locations=[('HEWN + CHECK',65,0),('SAWN + OIL',720,171),
               ('WEATHERED',160,341),('25 mm PEG',1145,512),('WRAPPED CHECK',1820,1707)]
    detail=Image.new('RGB',(5*520,len(locations)*228),BG)
    draw=ImageDraw.Draw(detail)
    display=[base, np.repeat(hg[...,None],3,axis=2), normal,orm,lights[0]]
    for r,(label,x0,y0) in enumerate(locations):
        for col,a in enumerate(display):
            xx=np.arange(x0,x0+512)%N
            yy=np.arange(y0,y0+171)%N
            cut=a[np.ix_(yy,xx)]
            detail.paste(img(cut),(col*520+4,r*228+42))
            draw.text((col*520+8,r*228+12),label+' | '+['BASE','HEIGHT','NORMAL','ORM','LIT'][col],font=SMALL,fill=(225,225,218))
    detail.save(OUT/'native_details.jpg',quality=97)
    # Readable, lossless 1:1 feature crops. No enlarged or resampled pixels.
    features=[('hewn',0,120),('sawn',1,720),('weathered',7,730),
              ('wrapped_check',10,1640),('wane',8,40)]
    for name,k,x0 in features:
        rows=np.flatnonzero(ids==k)
        xx=np.arange(x0,x0+1024)%N
        out=Image.new('RGB',(1024,4*207),BG)
        draw=ImageDraw.Draw(out)
        cross=name in ('weathered','wrapped_check','wane')
        first=2 if cross else 0
        labels=['BASE','11.1 DEGREE CROSS RAKE' if cross else '7.9 DEGREE RAKE',
                'RELIEF CROSS-GRAIN' if cross else 'RELIEF LEFT','RELIEF RIGHT']
        for i,(a,label) in enumerate(zip([base,grazing[first],clays[first],clays[1]],labels)):
            out.paste(img(a[np.ix_(rows,xx)]),(0,i*207+32))
            draw.text((8,i*207+7),f'{k:02d} {name.upper()} | {label} | 1:1 pixels',font=FONT,fill=(225,225,218))
        out.save(OUT/f'native_{name}.png')
    # Historical geometry comparison: current relief is byte-identical to pass 2.
    prior=OUT/'pass1'
    if (prior/'timber_base.png').exists():
        oldbase=np.asarray(Image.open(prior/'timber_base.png'))
        oldnormal=np.asarray(Image.open(prior/'timber_normal.png'))
        oldorm=np.asarray(Image.open(prior/'timber_orm.png'))
        oldclayorm=oldorm.copy(); oldclayorm[...,1]=170
        oldclay=lit(neutral,oldnormal,oldclayorm,grazing_directions[0],.08,2.8)
        panel([oldbase,base,oldclay,clays[0]],
              ['PASS 1 | base','PASS 4 | base','PASS 1 | same rake, neutral pigment','PASS 2/3/4 | same rake, neutral pigment'],
              cols=2,size=900,filename='before_after.jpg')
        oldh=np.asarray(Image.open(prior/'timber_height.png')).astype(float)*HEIGHT_MM/65535
        oldp=np.pad(oldh,1,mode='wrap')
        olddx=(oldp[1:-1,2:]-oldp[1:-1,:-2])/(2*MM_PX)
        olddy=(oldp[2:,1:-1]-oldp[:-2,1:-1])/(2*MM_PX)
        metrics['relief_comparison']={}
        for kind in ('hewn','sawn','weathered'):
            rowmask=np.isin(ids,[b['band'] for b in config['bands'] if b['treatment']==kind])
            rowmask &= (fields['arris'][:,0]<.01)
            oldtilt=np.degrees(np.arctan(np.hypot(olddx[rowmask],olddy[rowmask])))
            newtilt=np.degrees(np.arccos(true[rowmask,:,2]))
            metrics['relief_comparison'][kind]=dict(
                pass1_tilt_p50_p95_degrees=np.percentile(oldtilt,[50,95]).tolist(),
                pass2_tilt_p50_p95_degrees=np.percentile(newtilt,[50,95]).tolist())
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    # Contact sheet includes all the requested visual checks.
    panel([img(oldbase3),img(base),palette]+[Image.open(OUT/p) for p in ['layers.jpg','offsets.jpg','tilings.jpg',
          'band_alignment.jpg','relighting.jpg','relief_review.jpg',
          'post_faces.jpg','native_details.jpg','seams_native.jpg',
          'strong_raking.jpg','native_hewn.png','native_sawn.png']],
          ['BEFORE | pass 3 base (100, 58, 36)','AFTER | pass 4 base (98, 67, 45)',
           'UNLIT PALETTE | T, T+ and board B',
           'LAYERS','HALF-TILE OFFSETS','3 × 3 REPEAT',
           'EXACT BAND BOUNDARIES','TWO LIGHT DIRECTIONS','RELIEF WITHOUT PIGMENT',
           '12–25 cm POST FACES','NATIVE DETAIL','NATIVE WRAP JOINS',
           'STRONG 7.9 DEGREE RAKE','HEWING | NATIVE CROP','SAW KERFS | NATIVE CROP'],
          cols=3,size=700,filename='contact_sheet.jpg')
    print(json.dumps({k:metrics[k] for k in ('mean_srgb','height_range_mm','normal_max_byte_error','normal_quantization_degrees','roughness_percentiles','ao_percentiles','seams','palette_revision')},indent=2))


if __name__=='__main__':run()
