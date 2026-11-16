"""Rebuild the seven undyed saddle materials from the untouched generated sources.

python3 tex/studies/saddle/build.py
python3 tex/studies/saddle/build.py --sets rope_plait --feature-scale 1.2 --quarter-turns 1

All distances inside the construction functions are millimetres. Feature counts
snap to whole repeat periods. Quarter turns change direction without breaking UV
wrap. --span-scale changes the physical coverage, --size changes raster density.
Only this study directory is written. No online dependencies or Blender.
"""
from pathlib import Path
import argparse
import gc
import json
import time
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.fft import fft2, ifft2

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'source'
N = 2048
FEATURE = 1.0
TURN = 0
SPAN_SCALE = 1.0
SEED = 4117
F32 = np.float32
PI = np.pi

SETS = {
    'hide': dict(span_m=.5, height_mm=1.0, form='ball', radii=[.25,.06,.2]),
    'hide_edge': dict(span_m=.25, height_mm=1.6, form='tube', radius=.04, flat=.15, length=1.2),
    'rope_plait': dict(span_m=.0754, height_mm=2.4, form='tube', radius=.006, length=.6, turn=False),
    'rope_twist': dict(span_m=.0377, height_mm=1.6, form='tube', radius=.003, length=.6),
    'rope_wrap': dict(span_m=.1, height_mm=2.8, form='tube', radius=.016, length=.4),
    'wood': dict(span_m=.4, height_mm=.6, form='tube', radius=.02, flat=.6, length=.8),
    'chitin': dict(span_m=.25, height_mm=.35, form='tube', radius=.06, flat=.25, length=.6),
}

def save_rgb(path, a):
    Image.fromarray(np.uint8(np.clip(np.rint(a), 0, 255))).save(path)

def periodic(a):
    """Periodic-plus-smooth decomposition, removing only the boundary mismatch.

    The low-frequency correction extends across the image; no duplicated border
    pixels, mirrored quadrants, conspicuous crossfade bands or repeated stamps.
    """
    if a.ndim == 3:
        return np.stack([periodic(a[...,i]) for i in range(a.shape[-1])], -1)
    h,w = a.shape
    v = np.zeros_like(a)
    v[0] = a[-1]-a[0]
    v[-1] = -v[0]
    v[:,0] += a[:,-1]-a[:,0]
    v[:,-1] -= a[:,-1]-a[:,0]
    den = (2*np.cos(2*PI*np.arange(h,dtype=F32)/h)[:,None]
           +2*np.cos(2*PI*np.arange(w,dtype=F32)/w)[None,:]-4)
    den[0,0] = 1
    f = fft2(v)/den
    f[0,0] = 0
    return (a-ifft2(f).real).astype(F32)

def blur(a, sigma):
    return gaussian_filter(a, sigma, mode='wrap')

def standard(a):
    return (a-a.mean()) / max(float(a.std()), 1e-5)

def field(seed, cells=12, repeat_y=1):
    """Smooth periodic non-repeating modulation; repeat_y=2 closes a rope's girth."""
    rng = np.random.default_rng(SEED+seed)
    little = rng.normal(size=(cells,cells)).astype(F32)
    y,x = np.mgrid[:N,:N].astype(F32)
    out = map_coordinates(little, [y/N*cells*repeat_y,x/N*cells], order=3, mode='grid-wrap')
    return standard(out)

def source(name, target, crop_fraction=1.0):
    im = Image.open(SOURCE / f'{name}_original.png').convert('RGB')
    if crop_fraction != 1:
        w,h = im.size
        im = im.crop((round(.19*w),round(.13*h),round((.19+crop_fraction)*w),round((.13+crop_fraction)*h)))
    a = np.asarray(im.resize((N,N), Image.Resampling.LANCZOS),dtype=F32)
    a = periodic(a)
    # Remove only the broad illumination. Fibre tips, pores, pigment and fine
    # structure remain in albedo at their full original local contrast.
    for c in range(3):
        low = blur(a[...,c],N/14)
        a[...,c] -= low-low.mean()
        a[...,c] += target[c]-a[...,c].mean()
    return np.clip(a,0,255)

def details(rgb, sigma=3.0):
    lum = rgb.mean(-1)
    return standard(lum-blur(lum,sigma)), standard(blur(lum,sigma)-blur(lum,N/30))

def hide(edge=False):
    span = SETS['hide_edge' if edge else 'hide']['span_m']*1000*SPAN_SCALE
    rgb = source('hide_supple', [141,79,42], .5 if edge else 1.0)
    # Preserve the accepted hide's broad pigment mottling, without its cracked
    # cell network. The new original supplies the fine, supple surface grain.
    old = source('hide', [141,79,42], .5 if edge else 1.0)
    for c in range(3):
        pigment = blur(old[...,c],N*(.028 if edge else .014))
        rgb[...,c] += .65*(pigment-pigment.mean())
    del old
    micro,mid = details(rgb, max(1,N*.0009))
    wear = np.clip(.40+.16*field(1,7),0,1)
    # Rubbed spots retain pigment but lose some of their microscopic relief.
    h = .012*np.clip(micro,-2.8,2.8)*(1-.5*wear)+.010*np.clip(mid,-2.8,2.8)
    rough = .51-.14*wear +.009*np.clip(-micro,-2,2)
    rgb -= wear[...,None]*np.array([3.5,2.8,1.8],F32)
    if not edge:
        return rgb,h,rough,{'grain_mm':[.20,.55], 'relief':'quiet fine pores and grain, soft bend wrinkles; no cracked cells','source':'hide_supple_original.png; broad pigment only from hide_original.png'}
    y,x = np.mgrid[:N,:N].astype(F32)
    x *= span/N
    y *= span/N
    wav = FEATURE*(.13*np.sin(2*PI*x/span*5)+.07*np.sin(2*PI*x/span*11))
    e = y-(7*FEATURE+wav)
    roll = np.exp(-.5*(e/(1.05*FEATURE))**2)
    crease = np.exp(-.5*((e-2.8*FEATURE)/(.25*FEATURE))**2)
    channel = np.exp(-.5*((e-7.0*FEATURE)/(1.05*FEATURE))**2)
    h += .42*roll-.24*crease-.15*channel
    scuff = roll*np.clip(.35+.28*field(4,45),0,1)
    # Burnishing darkens actual leather pigment and polishes the rounded rim.
    rgb -= roll[...,None]*np.array([46,30,16],F32)
    rgb += scuff[...,None]*np.array([12,8,5],F32)
    rgb -= crease[...,None]*np.array([17,10,5],F32)
    rgb -= channel[...,None]*np.array([9,6,3],F32)
    rough += .035*scuff-.14*roll-.035*crease
    # Each stitch has independent length, slant, width and wax tint. Capsules
    # preserve the rounded thread silhouette and the actual 5 mm length.
    count = max(4,round(span/(6.9*FEATURE)))
    pitch = span/count
    rng = np.random.default_rng(SEED+73)
    thread = np.zeros((N,N),F32)
    holes = np.zeros_like(thread)
    stitch_records = []
    for i in range(count):
        cx = (i+.5)*pitch +rng.uniform(-.12,.12)*FEATURE
        cy = 14*FEATURE +.13*FEATURE*np.sin(2*PI*cx/span*5)+.07*FEATURE*np.sin(2*PI*cx/span*11)
        length = rng.uniform(4.7,5.25)*FEATURE
        width = rng.uniform(.78,.94)*FEATURE
        angle = np.deg2rad(rng.uniform(-20,-14))
        ca,sa = np.cos(angle),np.sin(angle)
        ix=np.arange(int(np.floor((cx-4*FEATURE)*N/span)),int(np.ceil((cx+4*FEATURE)*N/span)))%N
        iy=np.arange(max(0,int(np.floor((cy-2*FEATURE)*N/span))),min(N,int(np.ceil((cy+2*FEATURE)*N/span))))
        at=np.ix_(iy,ix)
        dx = ((ix.astype(F32)[None,:]*span/N-cx+span/2)%span-span/2)
        dy = iy.astype(F32)[:,None]*span/N-cy
        along = dx*ca+dy*sa
        across = -dx*sa+dy*ca
        # A tapered two-ply bead arches out of each awl hole. Both ends dive
        # beneath the hide instead of terminating in a flat capsule outline.
        arch = np.clip(1-(2*along/length)**4,0,1)
        radius = width/2*(.45+.55*np.sqrt(arch))
        twistphase = 2*PI*(along/(.68*FEATURE))
        wobble = .055*FEATURE*np.sin(twistphase)
        d = np.abs(across-wobble)
        coverage = np.clip((radius-d)/(span/N)+.5,0,1)*np.clip(arch*9,0,1)
        for sign in [-1,1]:
            hole = np.exp(-.5*((along-sign*(length*.48))/(.30*FEATURE))**2
                          -.5*(across/(.39*FEATURE))**2)
            holes[at] = np.maximum(holes[at],hole)
        cross = np.sqrt(np.maximum(1-(d/np.maximum(radius,.01))**2,0))
        ply = .5+.5*np.cos(twistphase+3*across/width)
        # 0.45 mm waxed crown over a 0.15 mm recessed sewing channel.
        thread_height = .45*cross*arch + .045*(ply-.5)*cross*arch
        h[at] += thread_height*coverage
        thread[at] = np.maximum(thread[at],coverage)
        tint = rng.uniform(-4,4)
        fibre_tone = 10*(ply-.5)+2*np.sin(twistphase*3+across*40/FEATURE)
        col = np.array([214,186,139],F32)+tint+fibre_tone[...,None]
        rgb[at] = rgb[at]*(1-coverage[...,None])+col*coverage[...,None]
        rough[at] = rough[at]*(1-coverage)+(.39+.035*(1-ply))*coverage
        stitch_records.append(dict(centre_mm=[float(cx),float(cy)],length_mm=float(length),width_mm=float(width),angle_degrees=float(np.rad2deg(angle))))
    h -= holes*.32*(1-thread)
    # Slight oil-darkening of the pricked walls is pigment; the deeper cavity
    # shading is computed from height into AO below.
    rgb -= (holes*(1-thread))[...,None]*np.array([17,11,6],F32)
    Image.fromarray(np.uint8(thread*255)).save(SOURCE/'hide_edge_thread_mask.png')
    Image.fromarray(np.uint8(holes*255)).save(SOURCE/'hide_edge_holes_mask.png')
    (SOURCE/'stitch_layout.json').write_text(json.dumps(stitch_records,indent=2)+'\n')
    return rgb,h,rough,{'stitch_count':count,'stitch_pitch_mm':pitch,'stitch_length_mm':[4.7*FEATURE,5.25*FEATURE], 'thread_ply':2,'thread_twist_pitch_mm':.68*FEATURE,'thread_crown_mm':.45,'edge_mm':7*FEATURE,'crease_mm':9.8*FEATURE,'stitch_row_mm':14*FEATURE,'source':'hide_supple_original.png; computed burnished roll, sewing channel, two-ply thread and awl holes','other_edge':'mirror this edge into the final strap UV; no bottom border is painted'}

def sample(rgb,u,v):
    return np.stack([map_coordinates(rgb[...,c],[(v%1)*N,(u%1)*N],order=1,mode='grid-wrap') for c in range(3)],-1)

def rope(plait=True):
    y,x = np.mgrid[:N,:N].astype(F32)
    x/=N
    y/=N
    fibre = source('fibre',[199,175,132])
    if plait:
        # Exterior of a round four-strand plait: two opposed chevron chains
        # per girth. Each oblique strand sweeps one quarter-girth before its
        # end dives beneath the next, offset by one step. Angular gates expose
        # only that run of a strand, never a full woven lattice across the map.
        nx=max(4,round(8/FEATURE/4)*4)
        # The junction follows each rounded crossing rather than cutting the
        # entire picture with a ruler-straight seam between strand families.
        junction=y+.006*np.sin(2*PI*nx*x)+.001*np.sin(2*PI*(x+2*y))
        side=np.sin(8*PI*junction)
        gate_a=np.clip(.80+side/.20,0,1)
        gate_b=np.clip(.80-side/.20,0,1)
        a=nx*(x+y)+.012*np.sin(2*PI*(2*x+2*y))
        b=nx*(x-y)+.28+.012*np.sin(2*PI*(3*x-2*y))
        da=(a+.5)%1-.5
        db=(b+.5)%1-.5
        # Round, tapering bundle crowns; the ends overlap at the centre line.
        ra=np.maximum(np.cos(PI*da),0)**2.5
        rb=np.maximum(np.cos(PI*db),0)**2.5
        za=1.45*ra-1.8*(1-gate_a)
        zb=1.45*rb-1.8*(1-gate_b)
        select=np.clip((za-zb)/.12*.5+.5,0,1)
        select=select*select*(3-2*select)
        pa=2*PI*(26*x-26*y)+3*np.arcsin(np.clip(2*da,-.98,.98))
        pb=2*PI*(26*x+26*y)+3*np.arcsin(np.clip(2*db,-.98,.98))
        ca=sample(fibre,2*x-2*y,a/2+.010*np.sin(pa))
        cb=sample(fibre,2*x+2*y,b/2+.21+.010*np.sin(pb))
        ca=np.array([199,175,132],F32)+.72*(ca-np.array([199,175,132],F32))
        cb=np.array([199,175,132],F32)+.72*(cb-np.array([199,175,132],F32))
        ca+=(3*np.sin(2*PI*(x+2*y))+7*np.sin(pa))[...,None]
        cb+=(3*np.sin(2*PI*(2*x-2*y+.1))+7*np.sin(pb))[...,None]
        rgb=ca*select[...,None]+cb*(1-select[...,None])
        exposed=ra*select+rb*(1-select)
        rgb+=(exposed-.5)[...,None]*np.array([15,12,8],F32)
        fine,_=details(rgb,2)
        h=za*select+zb*(1-select)
        h+=.065*(np.cos(pa)*select*ra+np.cos(pb)*(1-select)*rb)
        h+=.012*np.clip(fine,-2.5,2.5)
        rough=.82+.02*np.clip(-fine,-2,2)
        metadata={'construction':'round four-strand plait exterior; opposed chains of offset chevrons, quarter-girth runs with rounded crowns and recessed crossing ends',
                  'rope_diameter_mm':12,'strand_count':4,'circumferences_per_tile':2,
                  'chevron_pitch_mm':75.4/nx*SPAN_SCALE,'strand_angle_degrees':45,
                  'strand_diameter_mm':5,'bundle_ply':3,'fiber_relief_mm':.03,
                  'source':'fibre_original.png; four-strand exterior computed at physical scale'}
        Image.fromarray(np.uint8(select*255)).save(SOURCE/'rope_plait_over_under_mask.png')
    else:
        count = max(2,round(25/FEATURE))
        q = count*x-y+.04*np.sin(2*PI*(3*x+y))+.025*np.sin(2*PI*(7*x-2*y))
        d = (q+.5)%1-.5
        crown = np.maximum(np.cos(PI*d),0)**3.0
        # Two fibre-source spans across the tile keep the generated filaments
        # resolved. Mapping a source per cord would shrink them below a texel.
        rgb = sample(fibre,2*y+x,2*x+.0015*np.sin(2*PI*(18*y+x)))
        rgb += (2.5*np.sin(2*PI*(5*x+y)))[...,None]
        # Exposed fibre tips bleach and abrade a little; this is pigment. Deep
        # inter-turn darkness remains entirely in the height-derived AO.
        rgb += (crown-.5)[...,None]*np.array([9,8,6],F32)
        fine,_ = details(rgb,2)
        # The individual cord is round; small winding variation and a subtle
        # three-ply twist preserve the appearance of hand-bound plant cord.
        twist = .035*np.cos(2*PI*(3*q+18*y))
        h = 1.45*crown+twist*crown+.014*np.clip(fine,-2.5,2.5)
        rough = .80+.022*np.clip(-fine,-2,2)
        metadata = {'construction':'close helical cord turns with fine three-ply twist','cord_diameter_mm':100/count*SPAN_SCALE,'turns_per_tile':count,'helix_advance_per_circumference_mm':100/count*SPAN_SCALE}
    return rgb,h,rough,metadata

def twisted_rope():
    """Three equal-handed helices, two circumference repeats on a 6 mm cord."""
    y,x = np.mgrid[:N,:N].astype(F32)/N
    fibre=source('fibre',[199,175,132])
    count=max(3,round(6/FEATURE/3)*3)
    q=count*x-6*y+.012*np.sin(2*PI*(x+2*y))
    d=(q+.5)%1-.5
    crown=np.maximum(np.cos(PI*d),0)**2.6
    ply=2*PI*(28*x+28*y+.35*np.sin(2*PI*q))
    rgb=sample(fibre,2*x+2*y,q/3+.002*np.sin(ply))
    rgb+=(2.5*np.sin(ply)+2*np.sin(2*PI*(x+2*y)))[...,None]
    rgb+=(crown-.5)[...,None]*np.array([9,7,4],F32)
    fine,_=details(rgb,2)
    h=.95*crown+.025*np.cos(ply)*crown+.009*np.clip(fine,-2.5,2.5)
    rough=.81+.02*np.clip(-fine,-2,2)
    Image.fromarray(np.uint8(crown*255)).save(SOURCE/'rope_twist_strands_mask.png')
    return rgb,h,rough,{'construction':'three-strand laid cord; three equal-handed continuous helices, fine twisted plant fibres','rope_diameter_mm':6,'strand_count':3,'circumferences_per_tile':2,'lay_pitch_mm':37.7/count*3*SPAN_SCALE,'strand_spacing_axial_mm':37.7/count*SPAN_SCALE,'source':'fibre_original.png; helical strand relief computed at physical scale'}

def hard(name):
    if name=='wood':
        rgb=source('wood',[190,151,103])
        micro,mid=details(rgb,2.5)
        worn=np.clip(.45+.18*field(12,6),0,1)
        h=.032*np.clip(micro,-3,3)+.028*np.clip(mid,-2.5,2.5)
        rough=.51-.17*worn+.012*np.clip(-micro,-2,2)
        return rgb,h,rough,{'grain_direction':'left to right; bend the mesh along its grain','pores_mm':[.10,.35],'micro_relief_mm':.12}
    rgb=source('chitin_layers',[221,210,188])
    micro,mid=details(rgb,2.5)
    y,x=np.mgrid[:N,:N].astype(F32)/N
    # One thin worn boundary near the top; a local warm band, not a second
    # border at the vertical wrap. It follows the same shallow growth contour.
    span=SETS['chitin']['span_m']*1000*SPAN_SCALE
    contour=2.0*np.sin(2*PI*x)+.65*np.sin(2*PI*3*x)
    distance=y*span-(8*FEATURE+contour)
    edge=np.exp(-.5*(distance/(1.2*FEATURE))**2)
    inner=np.exp(-.5*((distance-2.3*FEATURE)/(1.8*FEATURE))**2)
    rgb-=edge[...,None]*np.array([18,19,20],F32)
    rgb-=inner[...,None]*np.array([3,3,4],F32)
    h=.005*np.clip(micro,-3,3)+.009*np.clip(mid,-2.5,2.5)-.04*edge
    rough=.285+.012*np.clip(mid,-2,2)+.008*np.clip(-micro,-2,2)-.035*edge
    Image.fromarray(np.uint8(edge*255)).save(SOURCE/'chitin_worn_edge_mask.png')
    return rgb,h,rough,{'growth_direction':'near-parallel left-to-right lamellae, coherent shallow curvature','micro_relief_mm':.04,'worn_edge_mm':8*FEATURE,'source':'chitin_layers_original.png','transmission':'opaque game material; warmer deeper pigment suggests the thinner edge, no real transmission channel'}

def make_normal(h16,span,height_range):
    """OpenGL +Y up; derivatives are taken from the delivered quantized height."""
    h=h16.astype(F32)/65535*height_range
    step=span*1000/N
    dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*step)
    dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*step)
    n=np.stack([-dx,dy,np.ones_like(h)],-1)
    n/=np.sqrt((n*n).sum(-1,keepdims=True))
    return (n*.5+.5)*255

def write_set(name,rgb,h,rough,extra):
    info=dict(SETS[name])
    info['span_m']*=SPAN_SCALE
    # Periodicize derived fields also; this only changes non-periodic numerical
    # roundoff and the small hand-stitch variation crossing a tile boundary.
    if name in ('rope_plait','rope_twist'):
        # A 75.4 mm tile contains two identical 37.7 mm girths. Make each
        # circumference seamless, not just the square's outer boundary.
        h=np.tile(periodic(h[:N//2]),(2,1))
        rough=np.tile(periodic(rough[:N//2]),(2,1))
        rgb=np.tile(periodic(rgb[:N//2]),(2,1,1))
    else:
        h=periodic(h)
        rough=periodic(rough)
        rgb=periodic(rgb)
    if TURN:
        rgb=np.rot90(rgb,TURN).copy(); h=np.rot90(h,TURN).copy(); rough=np.rot90(rough,TURN).copy()
    # Centre absolute millimetres in the declared encoding range; never rescale
    # relief to fill the image's range, which would exaggerate smooth materials.
    h-=float((h.max()+h.min())/2)
    maximum=float(np.max(np.abs(h)))
    if maximum > info['height_mm']*.499:
        raise ValueError(f'{name}: {maximum*2:.3f} mm will not fit height encoding')
    h16=np.uint16(np.clip(np.rint((h/info['height_mm']+.5)*65535),0,65535))
    Image.fromarray(h16).save(HERE/f'{name}_height.png')
    normal=make_normal(h16,info['span_m'],info['height_mm'])
    # Isotropic multiscale positive cavity depth: no light vector is involved.
    step=info['span_m']*1000/N
    cavity=np.maximum(blur(h,max(.4/step,1))-h,0)*.6
    cavity+=np.maximum(blur(h,max(1.5/step,2))-h,0)*.4
    ao=np.exp(-cavity/(.64 if name.startswith('rope') else .43))
    floor=.56 if name in ('rope_plait','rope_twist') else .68 if name=='rope_wrap' else .80
    ao=np.clip(ao,floor,1)
    packed=np.stack([ao,np.clip(rough,.1,.95),np.zeros_like(h)],-1)*255
    save_rgb(HERE/f'{name}_base.png',rgb)
    save_rgb(HERE/f'{name}_normal.png',normal)
    save_rgb(HERE/f'{name}_packed.png',packed)
    Image.new('RGB',(N,N),(0,0,0)).save(HERE/f'{name}_regions.png')
    # Small reusable constructions retain all five aligned layers. Their boxes
    # are recorded in the full-size parent map, and coverage is in millimetres.
    if name in ('hide_edge','rope_plait','rope_twist','rope_wrap') and TURN==0:
        folder=SOURCE/'elements'
        folder.mkdir(exist_ok=True)
        if name=='hide_edge':
            record=json.loads((SOURCE/'stitch_layout.json').read_text())[12]
            cx,cy=[v/(info['span_m']*1000)*N for v in record['centre_mm']]
            size=128;stem='stitch'
        else:
            cx,cy=N//2,N//2
            size=512 if name in ('rope_plait','rope_twist') else 128
            stem={'rope_plait':'plait_crossing','rope_twist':'twisted_cord','rope_wrap':'cord_turn'}[name]
        box=[round(cx-size/2),round(cy-size/2),round(cx+size/2),round(cy+size/2)]
        for layer in ['base','height','normal','packed','regions']:
            Image.open(HERE/f'{name}_{layer}.png').crop(box).save(folder/f'{stem}_{layer}.png')
        extra['reusable_element']={'name':stem,'parent_box_px':box,'span_mm':size/N*info['span_m']*1000,'layers':str(folder.relative_to(HERE))+f'/{stem}_*.png','tiles':False}
    info.update(tiles=True,cutout=False,regions=[],dyed=False,size=N,quarter_turns=TURN,
                feature_scale=FEATURE,seed=SEED,construction=extra,
                actual_relief_mm=round(float(h.max()-h.min()),5),
                height_encoding='white high; full 0..65535 range equals height_mm; middle grey is zero',
                channels={'base':'sRGB RGB','height':'linear uint16','normal':'OpenGL RGB8 +Y up','packed':'linear RGB8: AO, roughness, zero metal','regions':'RGB black only'})
    print(f'{name}: {N} square, {info["span_m"]} m, actual relief {info["actual_relief_mm"]} mm',flush=True)
    return info

def main():
    global N,FEATURE,TURN,SPAN_SCALE,SEED
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--sets',default=','.join(SETS))
    ap.add_argument('--size',type=int,default=2048)
    ap.add_argument('--feature-scale',type=float,default=1)
    ap.add_argument('--span-scale',type=float,default=1)
    ap.add_argument('--quarter-turns',type=int,default=0)
    ap.add_argument('--seed',type=int,default=4117)
    a=ap.parse_args()
    N,FEATURE,SPAN_SCALE,TURN,SEED=a.size,a.feature_scale,a.span_scale,a.quarter_turns%4,a.seed
    start=time.monotonic()
    meta_path=HERE/'study.json'
    meta=json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta.update(study='saddle',round=2,description='Undyed supple hide, burnished edges with waxed stitches, four-strand plait, three-strand cord, wrapped grips, honey wood and layered ivory chitin.',source_tool='built-in image_gen',source_native_size=[1254,1254],build='python3 tex/studies/saddle/build.py',check='python3 tex/studies/saddle/check.py')
    meta.setdefault('sets',{})
    for name in a.sets.split(','):
        if name=='hide': layers=hide(False)
        elif name=='hide_edge': layers=hide(True)
        elif name=='rope_plait': layers=rope(True)
        elif name=='rope_twist': layers=twisted_rope()
        elif name=='rope_wrap': layers=rope(False)
        elif name in ('wood','chitin'): layers=hard(name)
        else: raise ValueError(name)
        meta['sets'][name]=write_set(name,*layers)
        del layers
        gc.collect()
        meta_path.write_text(json.dumps(meta,indent=2)+'\n')
    print(f'Built in {time.monotonic()-start:.1f} seconds',flush=True)

if __name__=='__main__': main()
