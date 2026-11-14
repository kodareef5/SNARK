#!/usr/bin/env python3
"""Independent on-disk validation and visual diagnostics; no material mutation."""
from pathlib import Path
import json, struct, hashlib, argparse, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import gaussian_filter

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'checks'; OUT.mkdir(exist_ok=True)
N=2048
FILES=['thatch_base.png','thatch_height.png','thatch_normal.png','thatch_orm.png']


def png_header(p):
    data=p.read_bytes()
    w,h,depth,kind=struct.unpack('>IIBB',data[16:26])
    im=Image.open(p)
    return {'width':w,'height':h,'bit_depth':depth,'colour_type':kind,'mode':im.mode,'icc_profile':bool(im.info.get('icc_profile')),'sha256':hashlib.sha256(data).hexdigest()}


def font(n=19):
    for f in ['/System/Library/Fonts/Helvetica.ttc','/System/Library/Fonts/Supplemental/Arial.ttf']:
        try: return ImageFont.truetype(f,n)
        except OSError: pass
    return ImageFont.load_default()


def sheet(items,path,cols=2,size=768,caption=36):
    out=Image.new('RGB',(cols*size,((len(items)+cols-1)//cols)*(size+caption)),(23,25,27))
    d=ImageDraw.Draw(out)
    for i,(name,im) in enumerate(items):
        x=(i%cols)*size;y=(i//cols)*(size+caption)
        d.text((x+12,y+8),name,font=font(18),fill=(235,235,228))
        if im.mode!='RGB': im=im.convert('RGB')
        if im.size!=(size,size):im=im.resize((size,size),Image.Resampling.LANCZOS)
        out.paste(im,(x,y+caption))
    out.save(OUT/path,quality=95,subsampling=0)


def srgb_decode(c): return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
def srgb_encode(c): return np.where(c<=.0031308,c*12.92,1.055*np.maximum(c,0)**(1/2.4)-.055)


def render(base,norm,orm,light):
    L=np.array(light,np.float32);L/=np.linalg.norm(L)
    diff=np.maximum(0,np.sum(norm*L,axis=2))
    ao=orm[...,0]/255
    rough=orm[...,1]/255
    # Broad dielectric response, intended as a local relief diagnostic.
    V=np.array([0,0,1],np.float32)
    H=L+V;H/=np.linalg.norm(H)
    ndh=np.maximum(np.sum(norm*H,axis=2),0)
    spec=.018*ndh**(2/np.maximum(rough,.1)**4)*diff
    rgb=srgb_decode(base/255)*(.33*ao[...,None]+.82*diff[...,None]*(.7+.3*ao[...,None]))+spec[...,None]
    return Image.fromarray(np.uint8(np.clip(np.rint(srgb_encode(rgb)*255),0,255)))


def seams(a):
    if a.ndim==2:a=a[...,None]
    a=a.astype(np.float64)
    out={}
    for axis,label in [(1,'left_right'),(0,'top_bottom')]:
        delta=np.abs(np.diff(a,axis=axis))
        border=np.abs(np.take(a,0,axis=axis)-np.take(a,-1,axis=axis))
        # Distribution of entire interior line mean differences is a fair
        # comparison with the mean difference along the wrap line.
        reduce=(0,2) if axis==1 else (1,2)
        lines=delta.mean(axis=reduce)
        out[label]={'wrap_mean':float(border.mean()),'interior_mean':float(lines.mean()),'interior_line_p95':float(np.percentile(lines,95)),'interior_line_p99':float(np.percentile(lines,99)),'ratio_to_interior_mean':float(border.mean()/max(lines.mean(),1e-9)),'wrap_pixel_p95':float(np.percentile(border,95))}
    return out


def mip_average(a,size=200):
    """Area average each data channel, preserving floating-point samples."""
    if a.ndim==2:
        return np.asarray(Image.fromarray(a.astype(np.float32)).resize((size,size),Image.Resampling.BOX))
    return np.stack([mip_average(a[...,c],size) for c in range(a.shape[2])],-1)


def comparison_checks(base,normal,orm,h,meta):
    """Compare retained maps at native resolution and an actual 200px mip.

    The distance preview filters linear colour and linear data BEFORE shading,
    then renormalizes normals. This tests whether broad bundle features survive
    texture minification, without pretending to reproduce the game's mesh.
    """
    oldmeta=json.loads((ROOT/'source/round1_build_manifest.json').read_text())
    oldmetrics=json.loads((ROOT/'source/round1_metrics.json').read_text())
    old={f:np.asarray(Image.open(ROOT/'round1'/f)) for f in FILES}
    oldnormal=old[FILES[2]].astype(np.float32)/255*2-1
    oldnormal/=np.linalg.norm(oldnormal,axis=2,keepdims=True)
    rounds=[(old[FILES[0]].astype(np.float32),oldnormal,old[FILES[3]],old[FILES[1]].astype(np.float64)/65535),
            (base,normal.astype(np.float32),orm,h)]
    native=[];small=[];walls=[];stats=[]
    for i,(col,n,packed,height) in enumerate(rounds,1):
        linear=srgb_decode(col/255)
        b=srgb_encode(mip_average(linear))*255
        nm=mip_average(n);nm/=np.linalg.norm(nm,axis=2,keepdims=True)
        om=mip_average(packed)
        albedo=Image.fromarray(np.uint8(np.clip(np.rint(b),0,255)))
        small.append((f'Round {i} | base',albedo))
        native.append((f'Round {i} | base colour, full 2048px tile at 1:1',Image.fromarray(np.uint8(col))))
        walls.append((f'Round {i} | 3 m wall, base',Image.fromarray(np.tile(np.asarray(albedo),(2,2,1)))))
        lum=b@np.array([.2126,.7152,.0722])
        values=[];course_means=[]
        for k,course in enumerate(meta['courses']):
            y0=int((k*512+170)*200/N);y1=int((k*512+425)*200/N)
            course_means.append(float(lum[y0:y1].mean()))
            bundles=[]
            for bundle in course['bundles']:
                cx=bundle['centre_px']*200/N;w=bundle['width_px']*200/N
                xs=np.arange(int(np.floor(cx-w*.23)),int(np.ceil(cx+w*.23)))%200
                bundles.append(float(lum[y0:y1,xs].mean()))
            values.append(bundles)
        body=np.indices((N,N))[0]%512
        valley=np.asarray(Image.open(ROOT/'source/bundle_valley_mask.png'))/255
        centre_mask=(body>170)&(body<425)&(valley<.08)
        valley_mask=(body>170)&(body<425)&(valley>.7)
        stats.append({'round':i,'body_course_luma_200px':course_means,
                      'body_course_lightness_percent_from_mean':((np.array(course_means)/np.mean(course_means)-1)*100).tolist(),
                      'bundle_luma_200px':values,'within_course_bundle_luma_std_200px':np.std(values,axis=1).tolist(),
                      'mean_within_course_bundle_luma_std_200px':float(np.std(values,axis=1).mean()),
                      'crown_minus_valley_height_mm':float((height[centre_mask].mean()-height[valley_mask].mean())*32),
                      'crown_minus_valley_ao':float((packed[...,0][centre_mask].mean()-packed[...,0][valley_mask].mean())/255)})
    # Keep paired columns for each treatment.
    for name,light in [('upper-left',[-.65,.65,.72]),('raking-right',[.91,.12,.40])]:
        for i,(col,n,packed,_) in enumerate(rounds,1):
            b=srgb_encode(mip_average(srgb_decode(col/255)))*255
            nm=mip_average(n);nm/=np.linalg.norm(nm,axis=2,keepdims=True)
            im=render(b,nm,mip_average(packed),light)
            small.append((f'Round {i} | {name}',im))
            if name=='upper-left':
                native.append((f'Round {i} | identical light, full 2048px tile at 1:1',render(col,n,packed,light)))
                walls.append((f'Round {i} | 3 m wall, lit',Image.fromarray(np.tile(np.asarray(im),(2,2,1)))))
    sheet(small,'round_comparison_200px.png',2,200,32)
    sheet(native,'round_comparison_fullsize.png',2,2048,40)
    sheet(walls,'round_comparison_3m_wall_10m.png',2,400,32)
    # Distance sweep checks the requested 5–15 m interval at the same FOV.
    sweep=Image.new('RGB',(844,850),(23,25,27));d=ImageDraw.Draw(sweep)
    y=0
    for size,distance in [(400,5),(200,10),(133,15)]:
        for i,(col,n,packed,_) in enumerate(rounds):
            b=srgb_encode(mip_average(srgb_decode(col/255),size))*255
            nm=mip_average(n,size);nm/=np.linalg.norm(nm,axis=2,keepdims=True)
            im=render(b,nm,mip_average(packed,size),[-.65,.65,.72])
            x=12+i*422
            d.text((x,y+5),f'Round {i+1} | {distance} m | {size} px / 1.5 m',font=font(17),fill=(235,235,228))
            sweep.paste(im,(x,y+30))
        y+=size+40
    sweep.save(OUT/'round_comparison_distance_sweep.png')
    identity_keys=['id','centre_px','width_px','source_tie_y','tie_y_px']
    frozen={f:hashlib.sha256((ROOT/'round1'/f).read_bytes()).hexdigest()==oldmetrics['files'][f]['sha256'] for f in FILES}
    layout_same=all(a[key]==b[key] for ca,cb in zip(meta['courses'],oldmeta['courses']) for a,b in zip(ca['bundles'],cb['bundles']) for key in identity_keys)
    fringe=np.asarray(Image.open(ROOT/'source/fringe_mask.png'))>128
    fringe_stats=[]
    for k in range(4):
        a=fringe[k*512:k*512+160]
        ends=np.max(np.where(a,np.arange(160)[:,None],-1),axis=0)
        fringe_stats.append({'tip_rows_p10_p50_p90_p99':np.percentile(ends,[10,50,90,99]).tolist(),
                             'main_clump_fraction_70_to_110':float(np.mean((ends>=70)&(ends<=110))),
                             'gap_fraction_below_45':float(np.mean(ends<45)),
                             'stray_fraction_above_110':float(np.mean(ends>110))})
    tests={
        'round1_pngs_unchanged':all(frozen.values()),
        'original_generated_sources_unchanged':meta['generated_sources']==oldmeta['generated_sources'],
        'bundle_layout_and_stagger_unchanged':layout_same,
        'bundle_contrast_survives_200px':stats[1]['mean_within_course_bundle_luma_std_200px']>max(8,stats[0]['mean_within_course_bundle_luma_std_200px']*2),
        'four_distinct_batch_tones':min(np.diff(np.sort(stats[1]['body_course_luma_200px'])))>3,
        'course_variation_approximately_plus_minus_8_percent':6<max(stats[1]['body_course_lightness_percent_from_mean'])<10 and -10<min(stats[1]['body_course_lightness_percent_from_mean'])<-6,
        'deeper_bundle_height_valleys':stats[1]['crown_minus_valley_height_mm']>stats[0]['crown_minus_valley_height_mm']*1.2,
        'stronger_bundle_ao_valleys':stats[1]['crown_minus_valley_ao']>stats[0]['crown_minus_valley_ao']+.1,
        'long_fringe_clumps_in_every_course':all(v['main_clump_fraction_70_to_110']>.45 for v in fringe_stats),
        'fringe_has_gaps_and_sparse_long_stems':all(.15<v['gap_fraction_below_45']<.45 and .003<v['stray_fraction_above_110']<.05 for v in fringe_stats),
    }
    tests={key:bool(value) for key,value in tests.items()}
    result={'preview':'Linear-space area filtered colour and ORM; filtered and renormalized normals before lighting. 200 px per 1.5 m. Flat material, no game mesh or texture compression.',
            'rounds':stats,'fringe_measured_from_mask':fringe_stats,'round1_hash_matches':frozen,'tests':tests}
    (OUT/'round_comparison_metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    return tests


def main():
    meta=json.loads((ROOT/'source/build_manifest.json').read_text())
    headers={f:png_header(ROOT/f) for f in FILES}
    ims={f:Image.open(ROOT/f) for f in FILES}
    arrays={f:np.array(im) for f,im in ims.items()}
    base=arrays['thatch_base.png'].astype(np.float32)
    raw_h=arrays['thatch_height.png']
    h=raw_h.astype(np.float64)/65535
    normal=arrays['thatch_normal.png'].astype(np.float64)/255*2-1
    lengths=np.linalg.norm(normal,axis=2)
    normal/=lengths[...,None]
    orm=arrays['thatch_orm.png']
    spacing=1500/N
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))*32/(2*spacing)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))*32/(2*spacing)
    ref=np.stack((-dx,dy,np.ones_like(h)),axis=2)
    ref/=np.linalg.norm(ref,axis=2,keepdims=True)
    angle=np.degrees(np.arccos(np.clip(np.sum(ref*normal,axis=2),-1,1)))
    tie=np.asarray(Image.open(ROOT/'source/tie_mask.png'))>128
    master=np.asarray(Image.open(ROOT/'source/registered_master.png'))
    fringe=np.asarray(Image.open(ROOT/'source/fringe_mask.png'))>128
    ids=np.asarray(Image.open(ROOT/'source/bundle_ids.png'))
    seam={f:seams(a.astype(np.float32)/(65535 if f=='thatch_height.png' else 255)) for f,a in arrays.items()}
    row_means=(h*32).mean(1)
    body_slopes=[]
    for k in range(4):
        y=np.arange(120,470)
        body_slopes.append(float(np.polyfit(y,row_means[k*512+y],1)[0]*512))
    mean=base.mean((0,1),dtype=np.float64)
    tests={
        'dimensions':all(v['width']==N and v['height']==N for v in headers.values()),
        'height_16bit_greyscale':headers['thatch_height.png']['bit_depth']==16 and headers['thatch_height.png']['colour_type']==0,
        'rgb_8bit':all(headers[f]['bit_depth']==8 and headers[f]['colour_type']==2 for f in [FILES[0],FILES[2],FILES[3]]),
        'srgb_on_base_only':headers[FILES[0]]['icc_profile'] and not any(headers[f]['icc_profile'] for f in FILES[1:]),
        'metalness_zero':bool(np.max(orm[...,2])==0),
        'colour_mean_within_one_code':bool(np.max(np.abs(mean-[190,166,112]))<1),
        'normal_quantization_error_below_half_degree':bool(angle.max()<.5),
        'bundle_id_coverage':bool((ids==0).sum()==0),
        'course_origins':meta['geometry_course_top_rows']==[0,512,1024,1536],
        '11_bundles_per_course':all(len(c['bundles'])==11 for c in meta['courses']),
        'bundle_widths_9_to_15_cm':all(9<=b['width_cm']<=15.02 for c in meta['courses'] for b in c['bundles']),
        'body_no_course_ramp':all(abs(v)<.2 for v in body_slopes),
        'seams_within_interior_p95':all(v['wrap_mean']<=v['interior_line_p95'] for m in seam.values() for v in m.values()),
        'ties_partly_hidden':.35<meta['tie_visible_fraction']<.7,
        'bindings_within_upper_15_percent':all(35<=b['tie_y_px']<=65 for c in meta['courses'] for b in c['bundles']),
        'no_mean_height_step_at_course_origins':all(abs(row_means[i]-row_means[(i-1)%N])<.1 for i in [0,512,1024,1536]),
    }
    tests.update(comparison_checks(base,normal,orm,h,meta))
    metrics={'units':'Seam statistics are normalized 0..1 channel differences. Height in millimetres. Normal errors in degrees.', 'files':headers,'physical':{'metres_per_tile':1.5,'millimetres_per_pixel':spacing,'height_full_range_mm':32,'height_used_mm':[float(h.min()*32),float(h.max()*32)]},'base_colour_mean_srgb_0_255':mean.tolist(),'base_colour_channel_std':base.std((0,1),dtype=np.float64).tolist(),'base_tied_region_mean':base[np.indices((N,N))[0]%512<75].mean(0).tolist(),'base_body_mean':base[(np.indices((N,N))[0]%512>150)&(np.indices((N,N))[0]%512<425)].mean(0).tolist(),'seams':seam,'normal_height_agreement_degrees':{'mean':float(angle.mean()),'p99':float(np.percentile(angle,99)),'max':float(angle.max())},'decoded_normal_length':{'mean':float(lengths.mean()),'min':float(lengths.min()),'max':float(lengths.max())},'metalness_nonzero_pixels':int(np.count_nonzero(orm[...,2])),'roughness':{'range':(np.array([orm[...,1].min(),orm[...,1].max()])/255).tolist(),'mean':float(orm[...,1].mean()/255),'ties_mean':float(orm[...,1][tie].mean()/255),'straw_mean':float(orm[...,1][~tie].mean()/255)},'visible_tie_pixels':int(tie.sum()),'visible_fraction_of_authored_tie_masks':meta['tie_visible_fraction'],'fringe_pixels':int(fringe.sum()),'unique_bundle_ids':len(np.unique(ids)),'unassigned_bundle_id_pixels':int((ids==0).sum()),'body_height_trend_mm_per_course':body_slopes,'mean_height_jump_at_course_origins_mm':[float(row_means[i]-row_means[(i-1)%N]) for i in [0,512,1024,1536]],'tests':tests}
    (OUT/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    display={f:(Image.fromarray(np.uint8(np.rint(h*255))).convert('RGB') if f=='thatch_height.png' else im.convert('RGB')) for f,im in ims.items()}
    sheet([(f.replace('thatch_',''),display[f]) for f in FILES],'layers.jpg')
    layout=display[FILES[0]].copy()
    ld=ImageDraw.Draw(layout)
    for y in [0,512,1024,1536]:
        ld.line((0,y,N-1,y),fill=(25,105,200),width=2)
        ld.rectangle((10,y+9,445,y+48),fill=(24,28,30))
        ld.text((20,y+14),f'Course {y//512+1}: geometry origin row {y}',font=font(23),fill=(245,245,235))
    layout.save(OUT/'course_layout.png')
    offsets=[]
    for f in FILES:
        im=Image.fromarray(np.roll(arrays[f],(N//2,N//2),(0,1)))
        im.save(OUT/f.replace('.png','_offset.png'),**({'icc_profile':ims[f].info['icc_profile']} if f==FILES[0] else {}))
        viz=Image.fromarray(np.uint8(np.rint(np.array(im)/257))).convert('RGB') if f==FILES[1] else im.convert('RGB')
        offsets.append((f.replace('thatch_','')+' | half offset',viz))
    sheet(offsets,'offsets.jpg')
    tiled=np.tile(arrays[FILES[0]],(3,3,1))
    Image.fromarray(tiled).save(OUT/'base_3x3.jpg',quality=95,subsampling=0)
    Image.fromarray(tiled).resize((2048,2048),Image.Resampling.LANCZOS).save(OUT/'base_3x3_overview.jpg',quality=95,subsampling=0)
    lights=[('upper_left',[-.65,.65,.72]),('lower_right',[.65,-.55,.72]),('raking_right',[.91,.12,.40])]
    relit=[]
    for name,light in lights:
        im=render(base,normal.astype(np.float32),orm,light)
        im.save(OUT/f'relit_{name}.jpg',quality=97,subsampling=0)
        relit.append((name.replace('_',' ')+' | normal + AO',im))
    sheet(relit,'relighting.jpg',3,768)
    # Neutral clay reveals relief without any base-colour cue.
    clay=render(np.full_like(base,183),normal.astype(np.float32),orm,[-.65,.65,.72])
    clay.save(OUT/'relit_clay.jpg',quality=97,subsampling=0)
    # The exact crop is not resized; 1 output pixel == 1 texture pixel.
    box=(600,430,1368,1198)
    sheet([('base colour | native 1:1',display[FILES[0]].crop(box)),('OpenGL normal | native 1:1',display[FILES[2]].crop(box))],'detail_1to1.png',2,768)
    sheet([('height | native 1:1',display[FILES[1]].crop(box)),('ORM | native 1:1',display[FILES[3]].crop(box))],'detail_data_1to1.png',2,768)
    sheet([('lit | native 1:1',relit[0][1].crop(box)),('clay | native 1:1',clay.crop(box))],'detail_relit_1to1.png',2,768)
    # Shared ID edge overlay helps detect feature registration errors.
    lum=master.astype(np.float32).mean(2)
    edge=(np.abs(np.roll(lum,1,1)-lum)>26)&(np.abs(np.roll(lum,1,0)-lum)<10)
    overlay=np.uint8(base.copy()); overlay[edge]=np.uint8(.58*overlay[edge]+.42*np.array([31,125,204]))
    sheet([('source stem edges / albedo',Image.fromarray(overlay).crop(box)),('height with source edges',Image.fromarray(np.uint8(np.asarray(display[FILES[1]])*.7+np.asarray(Image.fromarray(overlay))*.3)).crop(box))],'alignment.png',2,768)
    print(json.dumps({'tests':tests,'mean':mean.tolist(),'normal_degrees':metrics['normal_height_agreement_degrees'],'body_trend_mm':body_slopes,'seam_ratios':{f:{d:round(s['ratio_to_interior_mean'],3) for d,s in v.items()} for f,v in seam.items()}},indent=2))
    if not all(tests.values()): raise SystemExit('Validation failed; see checks/metrics.json')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rebuild',action='store_true',help='Also verify that rebuilding reproduces all four PNGs byte for byte.')
    args=parser.parse_args()
    if args.rebuild:
        # First build also fixes any stale outputs before the comparison.
        hashes=[]
        for _ in range(2):
            subprocess.run([sys.executable,str(ROOT/'build_material.py')],cwd=ROOT,check=True)
            hashes.append({f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES})
        comparison={'identical_png_files':hashes[0]==hashes[1],'first_build_sha256':hashes[0],'second_build_sha256':hashes[1]}
        (OUT/'rebuild.json').write_text(json.dumps(comparison,indent=2)+'\n')
        if not comparison['identical_png_files']:raise SystemExit('Rebuild is not deterministic')
    main()
