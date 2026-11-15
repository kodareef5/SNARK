"""Round-two regression audit and material review; original checker is unchanged.

Run after build_material.py and check_material.py. Reads only saved artifacts.
The cylindrical review is a GGX diagnostic, not a capture from the game.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates
from check_material import panel, font, light_preview

ROOT = Path(__file__).resolve().parent
OUT = ROOT/'checks'
OLD = ROOT/'source/round1'
LAYERS = ('base','height','normal','orm')
RECTS = {'crownshaft':(0,0,1024,1024),'root':(1536,1024,2048,1536)}


def lum(a):
    return a[...,0]*.2126+a[...,1]*.7152+a[...,2]*.0722


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def cylindrical_review(maps, light, width=320, height=620, scale=385, offset=.34):
    """1.10 m circumference, 1.90 m tall, seen from 50 degrees below.

    Orthographic cylindrical intersection in screen coordinates. Normals are
    transformed from tangent space into the camera frame before GGX shading.
    """
    yy,xx=np.mgrid[:height,:width]
    x=(xx-(width-1)/2)/scale
    screen_y=((height-1)/2-yy)/scale
    radius=1.1/(2*np.pi)
    z=np.sqrt(np.maximum(radius*radius-x*x,0))
    elevation=np.deg2rad(50)
    cy,sy=np.cos(elevation),np.sin(elevation)
    y=(screen_y-sy*z)/cy
    mask=(np.abs(x)<radius)&(np.abs(y)<.95)
    theta=np.arctan2(x,z)
    u=(theta/(2*np.pi)+offset)%1
    v=np.clip((.95-y)/1.9,0,1)

    def sample(a):
        # Approximate footprint filtering; don't judge distant detail by
        # nearest/bilinear sampling of a full-resolution atlas (which aliases).
        mip_size=128 if scale<100 else 512
        a=np.asarray(Image.fromarray(a).resize((mip_size,mip_size),Image.Resampling.BOX))
        padded=np.pad(a,((0,0),(1,1),(0,0)),mode='wrap')
        return np.stack([map_coordinates(padded[...,i].astype(float),
            [v*(a.shape[0]-1),u*a.shape[1]+.5],order=1,mode='nearest')
            for i in range(3)],-1)

    b=sample(maps['base'][:1024,:1024])
    n=sample(maps['normal'][:1024,:1024])/255*2-1
    n/=np.linalg.norm(n,axis=2)[...,None]
    world_x=n[...,0]*np.cos(theta)+n[...,2]*np.sin(theta)
    world_z=-n[...,0]*np.sin(theta)+n[...,2]*np.cos(theta)
    camera_n=np.dstack((world_x,n[...,1]*cy+world_z*sy,-n[...,1]*sy+world_z*cy))
    orm=sample(maps['orm'][:1024,:1024])/255
    shaded=np.asarray(light_preview(b,camera_n,orm[...,1],orm[...,0],light))
    out=np.full((height,width,3),[40,43,41],dtype=np.uint8)
    out[mask]=shaded[mask]
    return Image.fromarray(out)


def check():
    old={k:np.asarray(Image.open(OLD/f'palm_parts_{k}.png')) for k in LAYERS}
    new={k:np.asarray(Image.open(ROOT/f'palm_parts_{k}.png')) for k in LAYERS}
    metrics={'checks':{},'protected_pixels':{},'changed_regions':{},'normal_response':{}}

    def expect(name,passed,detail=None):
        metrics['checks'][name]={'pass':bool(passed),'detail':detail}

    allowed=np.zeros((2048,2048),bool)
    for x0,y0,x1,y1 in RECTS.values(): allowed[y0:y1,x0:x1]=True
    for k in LAYERS:
        delta=old[k]!=new[k]
        if delta.ndim==3: delta=np.any(delta,axis=2)
        n=int(np.count_nonzero(delta&~allowed))
        metrics['protected_pixels'][k]={'count':int((~allowed).sum()),'changed':n,
            'baseline_pixels_sha256':hashlib.sha256(old[k][~allowed].tobytes()).hexdigest(),
            'current_pixels_sha256':hashlib.sha256(new[k][~allowed].tobytes()).hexdigest()}
        expect(k+'_only_requested_regions_changed',n==0,n)
        for name,(x0,y0,x1,y1) in RECTS.items():
            count=int(delta[y0:y1,x0:x1].sum())
            metrics['changed_regions'].setdefault(name,{})[k]=count
            expect(name+'_'+k+'_updated',count>0,count)
    for p in ('guide/LAYOUT.json','guide/layout.png','check_material.py'):
        expect(p+'_unchanged',sha(ROOT/p)==sha(OLD/p))
    previous=json.loads((OLD/'material.json').read_text())
    current=json.loads((ROOT/'material.json').read_text())
    for name,p in previous['patches'].items():
        q=current['patches'][name]
        expect(name+'_mapping_unchanged',all(p[k]==q[k] for k in ('rect','coverage_m','wrap_u')))
        if name not in RECTS:
            expect(name+'_metadata_unchanged',p==q)
    c=new['base'][:1024,:1024].astype(float)
    l=lum(c[40:960])
    contrast=(np.percentile(l,95,axis=1)-np.percentile(l,5,axis=1))/np.median(l,axis=1)
    metrics['crownshaft_row_value_contrast']={
        'definition':'Per-row sRGB luminance (p95-p5)/median, living rows 40:960',
        'min':float(contrast.min()),'median':float(np.median(contrast)),'max':float(contrast.max())}
    expect('crownshaft_value_variation_10_to_15_percent',contrast.min()>=.10 and contrast.max()<=.15)
    top=c[40:100].mean((0,1));bottom=c[900:960].mean((0,1))
    metrics['crownshaft_grade_rgb']={'top':top.tolist(),'bottom':bottom.tolist()}
    expect('crownshaft_lighter_top',lum(top)>lum(bottom))
    expect('crownshaft_cooler_bottom',bottom[2]/bottom[1]>top[2]/top[1])
    rough=new['orm'][:985,:1024,1]/255.
    expect('living_crownshaft_gloss',rough.min()>=.25-1/255 and rough.max()<=.35+1/255,
           [float(rough.min()),float(rough.max())])
    masks=np.load(ROOT/'derivation.npz')
    edge=masks['crownshaft_round2_edge_relief_m']*1000
    metrics['crownshaft_edge_relief_mm']={'peak':float(edge.max()),
        'median_row_peak':float(np.median(edge[40:960].max(axis=1)))}
    expect('crownshaft_lips_one_to_two_mm',1<=edge.max()<=2)
    dry=masks['crownshaft_round2_dry_mask']
    metrics['crownshaft_dry_patch_pixels_over_025']=int((dry>.25).sum())
    expect('crownshaft_sparse_dry_patches',0<(dry>.25).sum()<1024*1024*.005)
    for label,maps in (('before',old),('after',new)):
        n=maps['normal'][40:960,:1024].astype(float)/255*2-1
        n/=np.linalg.norm(n,axis=2)[...,None]
        angle=np.degrees(np.arccos(np.clip(n[...,2],-1,1)))
        metrics['normal_response'][label]={
            'rms_tilt_degrees':float(np.sqrt(np.mean(angle*angle))),
            'p99_tilt_degrees':float(np.percentile(angle,99))}
        mip=np.asarray(Image.fromarray(maps['normal'][:1024,:1024]).resize(
            (128,128),Image.Resampling.BOX)).astype(float)/255*2-1
        mip=mip[5:120]
        mip/=np.linalg.norm(mip,axis=2)[...,None]
        angle=np.degrees(np.arccos(np.clip(mip[...,2],-1,1)))
        metrics['normal_response'][label]['mip128_rms_tilt_degrees']=float(np.sqrt(np.mean(angle*angle)))
        metrics['normal_response'][label]['mip128_p99_tilt_degrees']=float(np.percentile(angle,99))
    # Native RMS primarily measures microtexture. The reported failure in game
    # was at 10 m; test structure after footprint filtering, not more raw noise.
    expect('crownshaft_relief_response_increased',
        metrics['normal_response']['after']['mip128_p99_tilt_degrees']>
        metrics['normal_response']['before']['mip128_p99_tilt_degrees']*2)
    r=new['base'][1024:1536,1536:2048].astype(float)
    top=r[:30].mean((0,1));middle=r[180:220].mean((0,1));bottom=r[-30:].mean((0,1))
    metrics['root_rgb']={'top':top.tolist(),'middle':middle.tolist(),'bottom':bottom.tolist()}
    expect('root_mid_matches_design',np.max(np.abs(middle-[120,103,74]))<3)
    expect('root_paler_greyer_top',lum(top)>lum(middle) and np.ptp(top)<np.ptp(middle))
    expect('root_dark_soil_bottom',lum(bottom)<lum(middle)*.70)

    # Four columns show the preserved old and delivered new pixels directly.
    comparisons=Image.new('RGB',(1536,840),(25,28,27))
    for row,(name,(x0,y0,x1,y1)) in enumerate(RECTS.items()):
        for col,(label,maps,k) in enumerate((('R1 base',old,'base'),('R2 base',new,'base'),
                                           ('R1 normal',old,'normal'),('R2 normal',new,'normal'))):
            im=Image.fromarray(maps[k][y0:y1,x0:x1])
            comparisons.paste(panel(im,name+' / '+label,384),(384*col,420*row))
    comparisons.save(OUT/'round2_comparison.jpg',quality=96)
    preview=Image.new('RGB',(1280,900),(25,28,27))
    d=ImageDraw.Draw(preview)
    lights=[(-.65,.45,.6),(.65,.45,.6)]
    for i,(label,maps,light) in enumerate((('R1 / left light',old,lights[0]),('R2 / left light',new,lights[0]),
                                          ('R1 / right light',old,lights[1]),('R2 / right light',new,lights[1]))):
        preview.paste(panel(cylindrical_review(maps,light),label,320),(i*320,0))
        # At 10 m, 1080 vertical pixels and 60-degree vertical FoV, scale is
        # 93.53 px/m. This is a stated orthographic screen-size approximation.
        far=cylindrical_review(maps,light,width=160,height=180,scale=93.53)
        preview.paste(far,(i*320+80,685))
    d.text((15,665),'Below at 50 deg | Approx. 10 m / 1080p / 60 deg vertical FoV (native size below)',
           fill=(230,233,226),font=font(17))
    d.text((15,875),'Diagnostic GGX cylinders; final game lighting, mesh UVs and compression are not evaluated.',
           fill=(195,199,191),font=font(16))
    preview.save(OUT/'round2_crownshaft_cylinders.jpg',quality=96)
    failures=[k for k,v in metrics['checks'].items() if not v['pass']]
    metrics['status']='FAIL' if failures else 'PASS'
    metrics['failures']=failures
    (OUT/'round2_metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    print(metrics['status'],len(metrics['checks']),'round-two checks')
    print('Protected pixels:',{k:v['changed'] for k,v in metrics['protected_pixels'].items()})
    print('Crown value variation:',metrics['crownshaft_row_value_contrast'])
    print('Crown normal response:',metrics['normal_response'])
    if failures: raise SystemExit(', '.join(failures))


if __name__=='__main__':
    check()
