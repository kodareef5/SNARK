#!/usr/bin/env python3
"""Build the 3 m direction-A thatch material from frozen sources and model guides.

Python 3 + numpy, scipy, Pillow. Run: python3 build_material.py
Coordinates: x increases right; image rows increase down. All x sampling wraps.
Source pictures are inputs; no image generation or network is needed to rebuild.
"""
from pathlib import Path
import hashlib, json, time
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, gaussian_filter1d, map_coordinates, distance_transform_edt, label

ROOT = Path(__file__).resolve().parent
N = 2048
HEIGHT_MM = 16.0
PIXEL_MM = 3000.0 / N
SEED = 912731
MODE = ('nearest', 'wrap')
PALETTE = json.loads((ROOT/'source/round4_palette.json').read_text())
PLACEMENT = json.loads((ROOT/'source/round3_placement.json').read_text())

def smooth(x):
    x = np.clip(x, 0, 1)
    return x*x*(3-2*x)

def save_png(name, a, color=False):
    meta = PngImagePlugin.PngInfo()
    meta.add_text('Description', 'Direction A long-skirt thatch; 3 m x 3 m; pixel-aligned model UVs')
    if color:
        meta.add(b'sRGB', b'\x00')
    Image.fromarray(a).save(ROOT/name, pnginfo=meta, compress_level=6)

def read_guides(root=ROOT):
    spec = json.loads((root/'guide/LAYOUT.json').read_text())
    layout = np.array(Image.open(root/'guide/layout.png'))
    labels = np.array(Image.open(root/'guide/bundles.png'))
    env = np.array(Image.open(root/'guide/envelope.png')) > 127
    upper_colors = np.unique(labels[0], axis=0)
    packed = labels[...,0].astype(np.int32)*65536+labels[...,1].astype(np.int32)*256+labels[...,2]
    ids = upper_colors[:,0].astype(np.int32)*65536+upper_colors[:,1].astype(np.int32)*256+upper_colors[:,2]
    upper = np.isin(packed, ids)
    upper_end = np.sum(upper, axis=0)-1
    lower_end = np.sum(env, axis=0)-1
    upper_start = int(np.nonzero(np.all(layout == [250,235,180], axis=2))[0].min())
    lower_start = int(np.nonzero(np.all(layout == [230,210,150], axis=2))[0].min())
    # Sample bundle IDs only where an entire row belongs to that tier.
    lower_body_row = int(upper_end.max()+1)
    tie_rows = {t: (spec['covers']['y'][1]-spec[t+'_tier']['tied_at']) /
                spec['covers']['metres_per_pixel'] for t in ['upper','lower']}
    return dict(spec=spec, tie_rows=tie_rows, lower_body_row=lower_body_row,
                layout=layout, labels=labels, env=env, upper=upper,
                upper_end=upper_end, lower_end=lower_end,
                upper_start=upper_start, lower_start=lower_start,
                along=np.array(Image.open(root/'guide/along.png')).astype(np.float32)/255,
                depth=np.array(Image.open(root/'guide/depth.png')).astype(np.float32)/65535*.2)

def intervals(row):
    edges = np.flatnonzero(np.any(row != np.roll(row, 1, axis=0), axis=1))
    return [(int(a), int(b)) for a,b in zip(edges, np.r_[edges[1:], edges[0]+N])]

def prepare_sources():
    body = np.array(Image.open(ROOT/'source/reed_body_generated.png').convert('RGB')).astype(np.float32)/255
    lum = np.sum(body*np.array([.2126,.7152,.0722],np.float32),axis=2)
    # Reject broad illumination and compress dark generated interstices. These
    # are used as fibre pigmentation, never as a baked macro shadow.
    residual = lum-gaussian_filter(lum, (30,16))
    bdetail = np.tanh(residual*4.0)
    sheaf = np.array(Image.open(ROOT/'source/reed_sheaves_generated.png')).astype(np.float32)/255
    sa = sheaf[...,3]
    sl = np.sum(sheaf[...,:3]*np.array([.2126,.7152,.0722],np.float32),axis=2)
    mean = gaussian_filter(sl*sa, (32,14))/np.maximum(gaussian_filter(sa,(32,14)),.001)
    sdetail = np.tanh((sl-mean)*4)
    return bdetail, sdetail, sa

def sample(a, y, x):
    return map_coordinates(a, [y,x], order=1, mode='nearest')

def tier(name, g, src, index):
    rng = np.random.default_rng(SEED+index*1000)
    # Retain round 2's independent appearance recipe on the new geometry.
    appearance = np.random.default_rng(SEED+24000+index*1000)
    # New colour choices must never advance the accepted geometry or appearance
    # streams: even an extra appearance draw would move the dark/waxy reeds.
    colour_rng = np.random.default_rng(SEED+44000+index*1000)
    upper = name == 'upper'
    tip_start = g[name+'_start']
    endline = g[name+'_end']
    tie = g['tie_rows'][name]
    row_start = 0 if upper else g['upper_start']-92
    ids = intervals(g['labels'][0 if upper else g['lower_body_row']])
    assert len(ids) == g['spec'][name+'_tier']['bundles']
    Y = np.arange(N,dtype=np.float32)[:,None]
    X = np.arange(N,dtype=np.float32)[None,:]
    bdetail,sdetail,sa = src
    rgb = np.zeros((N,N,3),np.float32)
    relief = np.zeros((N,N),np.float32)
    roughness = np.zeros((N,N),np.float32)
    alpha = np.zeros((N,N),np.float32)
    tier_domain = np.arange(N)[:,None] <= endline[None,:]
    safety_distance = distance_transform_edt(np.tile(tier_domain,(1,3)))[:,N:2*N]
    generated = np.zeros((N,N),np.float32)
    params = []
    for bi,(left,right) in enumerate(ids):
        w=right-left
        cols=np.arange(left,right)%N
        xx=np.arange(w,dtype=np.float32)[None,:]
        t=np.clip((Y-tie)/(np.mean(endline[cols])-tie),0,1.2)
        top=np.clip((tie-Y)/max(tie-row_start,1),0,1)
        rng.uniform(-.11,.11)  # Keep the source/appearance sampling schedule.
        lean=0.0  # The model supplies bundle lean; UV bundle axes stay vertical.
        spread=.58+.46*smooth(t)+.25*top
        # Distinct source windows, never a resized 1254px wall.
        sx=(xx-w*.5-lean*t)/(w*spread)+.5
        cx=rng.uniform(30,bdetail.shape[1]-w*2-30)
        cy=rng.uniform(0,80)
        bx=cx+sx*w*rng.uniform(1.3,1.9)
        by=np.broadcast_to(cy+(Y-row_start)*rng.uniform(.77,.93), bx.shape)
        bd=sample(bdetail,by,bx)
        # The full-resolution four-sheaf atlas supplies real papery splinters
        # and tip clusters; each is independently warped into its guide sheaf.
        si=(bi*3+index)%4
        scx=[178,570,956,1372][si]
        sy=np.where(Y<tip_start,
                    30+(Y-row_start)/max(tip_start-row_start,1)*706,
                    736+(Y-tip_start)/np.maximum(endline[cols][None,:]-tip_start-22,35)*280)
        sy=np.broadcast_to(sy,(N,w))
        shx=np.broadcast_to(scx+(sx-.5)*rng.uniform(245,315),(N,w))
        sd=sample(sdetail,sy,shx)
        mask=sample(sa,sy,shx)* (sy<1015)
        detail=bd*(1-mask*.72)+sd*mask*.72
        # Vary ageing, not illumination. Bleaching follows the supplied along
        # guide for visible pixels and an analytic extension behind the skirt.
        ag=np.clip((Y-tie)/(endline[cols][None,:]-tie),0,1)
        visible = g['upper'][:,cols] if upper else ~g['upper'][:,cols]
        ag=np.where(visible,g['along'][:,cols],ag)
        bleach_jitter=rng.uniform(.31,.43)-.37  # Keep the geometry RNG schedule.
        fade_start=PALETTE['body_bleach_start']+bleach_jitter
        fade_end=colour_rng.uniform(*PALETTE['bleach_end_range'])
        bleach=smooth((ag-fade_start)/(fade_end-fade_start))
        tone=rng.uniform(-7,7)
        # Arrange one fresher handful between two similarly aged neighbours.
        # Preserve the accepted tone ordering; increase its colour range only.
        tone=PLACEMENT['tone_overrides'].get(name,{}).get(str(bi),tone)
        # Older sheaves are quieter and browner, fresh ones more honey-gold.
        age=appearance.uniform(-1,1)
        offset=tone*PALETTE['bundle_tone_gain']*np.array([1,.91,.69])+age*np.array([-3,2,7])
        color=np.array(PALETTE['body_rgb'],np.float32)+offset
        tip=np.array(PALETTE['tip_rgb'],np.float32)+rng.uniform(-4,4)+age*np.array([-2,-1,3])
        local=color[None,None,:]*(1-bleach[...,None])+tip[None,None,:]*bleach[...,None]
        local+=detail[...,None]*np.array([61,53,37])
        # Dark papery fibre pigmentation, not macro hollows or cast shadows.
        local+=np.minimum(detail,0)[...,None]*np.array(PALETTE['dark_fibre_rgb'])
        rgb[:,cols]=local
        roughness[:,cols]=.845+bleach*.065+detail*.025+age*.012
        relief[:,cols]=3.8+detail*3.2
        generated[:,cols]=detail
        # Generated alpha is used only in the tip zone; a safety margin prevents
        # the remapped source from becoming an outline of the model envelope.
        inset=endline[cols][None,:]-Y
        alpha[:,cols]=np.where(Y<tip_start,1,mask*smooth((inset-13)/20))
        params.append(dict(id=bi,left=left,right=right,width=w,lean=float(lean),tone=float(tone),source_sheaf=int(si),
                           guide_rgb=g['labels'][0 if upper else g['lower_body_row'],left].tolist(),
                           pigment_offset=offset.tolist(),age=float(age),body_rgb=color.tolist(),tip_rgb=tip.tolist(),
                           fade_start=float(fade_start),fade_end=float(fade_end)))
    # Introduce long analytic reeds at true output resolution. Their albedo,
    # rounded cross-section and tip alpha come from the SAME paths.
    stem_count=0; dark_count=0; waxy_count=0; golden_count=0; paler_count=0
    for p in params:
        left,right,w=p['left'],p['right'],p['width']
        center=(left+right)/2
        count=int(w/2.65)
        qs=np.linspace(-.57,.57,count)+rng.normal(0,.006,count)
        rng.shuffle(qs)
        for j,q in enumerate(qs):
            stray = rng.random()<.11
            radius=rng.uniform(.90,2.1) if not stray else rng.uniform(.52,1.06)
            if rng.random()<.08: radius=rng.uniform(2.0,3.1)
            phase=rng.uniform(0,6.283)
            lean=p['lean']+rng.normal(0,2.8)
            if stray: lean+=rng.uniform(-37,37)
            maxend=int(endline[int(center+q*w)%N])
            # Broken short reeds coexist with a long irregular fringe.
            keep=rng.uniform(.40,.93) if rng.random()<.22 else rng.uniform(.72,.98)
            endpoint=tip_start+(maxend-tip_start)*keep-rng.uniform(8,26)
            y0=row_start if not stray else int(rng.uniform(row_start,tip_start-60))
            yy=np.arange(y0,min(N,int(endpoint)+1),dtype=np.float32)
            t=np.clip((yy-tie)/(maxend-tie),0,1.2)
            top=np.clip((tie-yy)/max(tie-row_start,1),0,1)
            spread=.56+.50*smooth(t)+.28*top
            path=center+q*w*spread+lean*t
            path+=np.sin(yy/rng.uniform(140,280)+phase)*rng.uniform(.6,2.1)
            path+=np.sin(yy/37+phase)*.18
            # A minority of loose ends peel sideways from their neighbours.
            # Their colour, cylinder relief and alpha all follow the same kink.
            terminal=smooth((yy-tip_start+15)/max(40,maxend-tip_start-10))
            bend=rng.uniform(-28,28) if stray else rng.uniform(-4,4)
            path+=bend*terminal
            # Find first geometry collision and end the actual stem early,
            # rather than cutting a whole sheet against a jagged boundary.
            limit=endline[np.rint(path).astype(int)%N]-14
            clearance=safety_distance[yy.astype(int),np.rint(path).astype(int)%N]
            bad=np.flatnonzero((yy>=tip_start)&((yy>limit)|(clearance<15)))
            if len(bad):
                cut=max(0,int(bad[0])-int(rng.integers(6,20)))
                yy,path,t,top=yy[:cut],path[:cut],t[:cut],top[:cut]
            if len(yy)<1: continue
            endpoint=float(yy[-1])
            taperlen=rng.uniform(16,62)
            taper=np.clip((endpoint-yy)/taperlen,0,1)
            if rng.random()<.22: taper=np.clip((endpoint-yy)/2,0,1)
            rr=radius*(.2+.8*np.sqrt(taper))
            rr*=1+.07*np.sin(yy/31+phase)
            # Small reed nodes are staggered independently, never in courses.
            nodeY=y0+rng.uniform(80,max(81,len(yy)-30))
            node=np.exp(-((yy-nodeY)/1.5)**2)
            rr+=node*.28
            ix=np.floor(path).astype(int)[:,None]+np.arange(-4,5)[None,:]
            d=ix-path[:,None]
            coverage=np.clip(rr[:,None]+.55-np.abs(d),0,1)
            coverage*=smooth((yy-y0)/5)[:,None] if stray else 1
            inds=(yy.astype(int)[:,None],ix%N)
            bleach_jitter=rng.uniform(.32,.52)-.42
            fade_start=p['fade_start']+bleach_jitter*.35
            fade_end=p['fade_end']+colour_rng.uniform(-.025,.025)
            tip_kind=colour_rng.random()
            golden=tip_kind<PALETTE['golden_tip_probability']
            paler=tip_kind>1-PALETTE['paler_tip_probability']
            golden_count+=int(golden);paler_count+=int(paler)
            strength=colour_rng.uniform(.45,.68) if golden else colour_rng.uniform(.92,1.0)
            bleach=smooth((t-fade_start)/(fade_end-fade_start))*strength
            old=rng.normal(0,16)
            dark=appearance.random()<PALETTE['dark_reed_probability']+max(0,abs(q)-.40)*.9
            waxy=appearance.random()<PALETTE['waxy_reed_probability'] and not dark
            dark_count+=int(dark);waxy_count+=int(waxy)
            cbody=np.array(PALETTE['stem_rgb'],np.float32)+old*np.array([1.28,1.13,.78])+np.array(p['pigment_offset'])*.90
            # These are actual aged stems, not a painted directional shadow.
            if dark: cbody-=appearance.uniform(.75,1.25)*np.array(PALETTE['dark_reed_rgb'])
            ctip=np.array(PALETTE['stem_tip_rgb'],np.float32)+old*.40
            if paler: ctip+=np.array([5,6,6])
            if dark: ctip-=np.array([16,18,15])
            stemcolor=cbody[None,:]*(1-bleach[:,None])+ctip[None,:]*bleach[:,None]
            # The generated skin supplies fine pigment breakup, no left/right
            # highlight is painted into albedo.
            skin=generated[inds]*8
            pigment=1.1*np.sin(yy/13+phase)+.7*np.sin(yy/3.5+phase)
            col=stemcolor[:,None,:]+skin[...,None]+pigment[:,None,None]-node[:,None,None]*7
            blend=coverage*(PALETTE['stem_pigment_blend']+.22*smooth((yy-tip_start+15)/90))[:,None]
            if stray: blend=np.maximum(blend,coverage*.76)
            rgb[inds]=rgb[inds]*(1-blend[...,None])+col*blend[...,None]
            stemrough=appearance.uniform(.70,.755) if waxy else appearance.uniform(.79,.90)
            r=stemrough*(1-bleach)+.925*bleach
            r+=.008*np.sin(yy/21+phase)
            roughness[inds]=roughness[inds]*(1-coverage)+r[:,None]*coverage
            dome=np.sqrt(np.maximum(0,1-(d/np.maximum(rr[:,None],.01))**2))
            h=3.0+dome*(radius*1.45+1.1)+node[:,None]*.6
            if stray: h+=1.8
            relief[inds]=relief[inds]*(1-coverage)+h*coverage
            alpha[inds]=np.maximum(alpha[inds],coverage)
            stem_count+=1
    # Break up any perfectly horizontal start of transparency. The dense first
    # reeds of each fringe bridge the body; the veil decays within 12–35 pixels.
    tip_y=np.arange(N)[:,None]-tip_start
    veil=1-smooth(tip_y/(20+8*np.sin(np.arange(N)[None,:]*.09)))
    alpha=np.maximum(alpha,veil)
    alpha=np.where(np.arange(N)[:,None]<=endline[None,:]-9,alpha,0)
    alpha=np.where(np.arange(N)[:,None]<tip_start,1,alpha)
    # The outer 14px of each skirt remains empty. Remove disconnected flecks
    # after the shader's exact 0.5 threshold, including across the wrap seam.
    binary=(alpha>=.5) & ((safety_distance>=14)|(np.arange(N)[:,None]<tip_start))
    connected,_=label(np.tile(binary,(1,3)),structure=np.ones((3,3),int))
    binary=connected[:,N:2*N]==connected[0,N]
    alpha=binary.astype(np.float32)
    # Compression is local only: do not put guide/depth into height.
    tie_dist=np.abs(np.arange(N,dtype=np.float32)[:,None]-tie)
    compression=np.exp(-(tie_dist/10)**2)
    # Shallow diagonal impressions left by twisted cord under each rod. The
    # horizontal phase closes exactly over a 3m repeat. No rope is painted on.
    twist_phase=2*np.pi*X/N*224+(Y-tie)*.72+.35*np.sin(2*np.pi*X/N*7)
    twist=(.5+.5*np.cos(twist_phase))**5
    impression=compression*twist
    relief=3.8+(relief-3.8)*(1-.55*compression)-PALETTE['tie_compression_mm']*compression
    relief-=PALETTE['cord_impression_mm']*impression
    rgb-=compression[...,None]*np.array(PALETTE['tie_browning_rgb'])
    rgb-=impression[...,None]*np.array([5,4,3])
    roughness-=compression*.025
    # No step in relief at either skirt transition: remove low-frequency relief
    # while retaining the local rounded stems and the small tied compression.
    relief-=gaussian_filter(relief,(26,18),mode=MODE)-3.8
    relief=np.clip(relief,0,HEIGHT_MM)
    return rgb,relief,alpha,roughness,dict(bundles=params,stem_count=stem_count,tie_row=tie,
                                         dark_stems=dark_count,waxy_stems=waxy_count,
                                         golden_tip_stems=golden_count,paler_tip_stems=paler_count)

def normal_from_height(height_u16):
    h=height_u16.astype(np.float32)/65535*HEIGHT_MM
    dx=(np.roll(h,-1,axis=1)-np.roll(h,1,axis=1))/(2*PIXEL_MM)
    dy=np.gradient(h,PIXEL_MM,axis=0)
    n=np.stack([-dx,dy,np.ones_like(h)],axis=2)
    n/=np.linalg.norm(n,axis=2,keepdims=True)
    return np.rint((n*.5+.5)*255).clip(0,255).astype(np.uint8)

def main():
    start=time.time()
    (ROOT/'source').mkdir(exist_ok=True)
    g=read_guides();src=prepare_sources()
    print('Building upper sheaves...',flush=True)
    u,uh,ua,ur,up=tier('upper',g,src,0)
    print('Building lower sheaves...',flush=True)
    l,lh,la,lr,lp=tier('lower',g,src,1)
    # Save construction evidence/underpainting at native master resolution.
    save_png('source/upper_master.png',np.dstack([np.rint(u).clip(0,255).astype(np.uint8),np.rint(ua*255).astype(np.uint8)]),True)
    save_png('source/lower_master.png',np.dstack([np.rint(l).clip(0,255).astype(np.uint8),np.rint(la*255).astype(np.uint8)]),True)
    upper_body=np.arange(N)[:,None]<g['upper_start']
    upper_tip=g['upper']&~upper_body
    use_upper=upper_body|(upper_tip&(ua>=.5))
    rgb=np.where(use_upper[...,None],u,l)
    # Rebuild binary coverage inside the new tier envelopes.
    # Hidden RGB is kept as inherited; no requirement is placed on it.
    a=np.where(g['upper'],ua,la)>=.5
    a[~g['env']]=False
    h=np.where(use_upper,uh,lh)
    # No macro silhouettes or overlap offsets in the height map.
    hu=np.rint(h/HEIGHT_MM*65535).clip(0,65535).astype(np.uint16)
    norm=normal_from_height(hu)
    depth=g['depth']
    # Extend each geometry surface before evaluating concavity, so no shadow
    # is manufactured at the guide's triangular envelope or tip-zone boundary.
    upper_mask=g['upper']
    filled=[]
    for mask in [upper_mask,~upper_mask]:
        nearest=distance_transform_edt(~mask,return_distances=False,return_indices=True)
        surface=depth[tuple(nearest)]
        surface=gaussian_filter(surface,(10,1),mode=MODE)
        cavity=np.maximum(0,gaussian_filter(surface,(0,24),mode=MODE)-surface)*9
        cavity+=np.maximum(0,gaussian_filter(surface,(0,55),mode=MODE)-surface)*3
        filled.append(cavity)
    concavity=np.where(use_upper,filled[0],filled[1])
    local_cavity=np.maximum(0,gaussian_filter(h,(3,2),mode=MODE)-h)
    ao=.95-np.clip(concavity,0,.30)-np.clip(local_cavity*.085,0,.19)
    y=np.arange(N,dtype=np.float32)[:,None]
    # Contact follows actual individual cutout stems, not the envelope edge.
    front_coverage=use_upper.astype(np.float32)
    contact=gaussian_filter(front_coverage,(19,8),mode=MODE)*(~use_upper)
    ao-=contact*.66
    for p in [up,lp]:
        ao-=.20*np.exp(-((y-p['tie_row'])/12)**2)
    ao=np.clip(ao,.28,1)
    # Stem-coherent roughness: rare waxy skins catch a narrower highlight,
    # while old stems and bleached split ends remain dry and diffuse.
    rng=np.random.default_rng(SEED+8000)
    fine=rng.normal(0,1,(N,N)).astype(np.float32)
    fine=gaussian_filter(fine,(1.8,.55),mode=MODE)
    rough=np.clip(np.where(use_upper,ur,lr)+fine*.012,.70,.95)
    orm=np.stack([ao,rough,np.zeros_like(ao)],axis=2)
    save_png('thatch_base.png',np.dstack([np.rint(rgb).clip(0,255).astype(np.uint8),a.astype(np.uint8)*255]),True)
    save_png('thatch_height.png',hu)
    save_png('thatch_normal.png',norm)
    save_png('thatch_orm.png',np.rint(orm*255).clip(0,255).astype(np.uint8))
    # Both underlying layers are retained for honest two-surface previewing.
    np.savez_compressed(ROOT/'source/relief_layers.npz',upper_height=uh.astype(np.float16),lower_height=lh.astype(np.float16),upper_alpha=ua.astype(np.float16))
    manifest=dict(revision=4,seed=SEED,appearance_seed=SEED+24000,colour_seed=SEED+44000,palette=PALETTE,placement=PLACEMENT,
                  size=[N,N],height_full_range_mm=HEIGHT_MM,mm_per_pixel=PIXEL_MM,
                  upper=up,lower=lp,build_seconds=round(time.time()-start,2),
                  guide_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'guide').iterdir() if p.is_file()},
                  source_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'source').glob('*generated.png')})
    (ROOT/'source/build_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Built four maps in %.1f seconds.'%(time.time()-start),flush=True)

if __name__=='__main__': main()
