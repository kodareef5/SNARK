#!/usr/bin/env python3
"""Build linear cloud data from the retained imagegen density studies.

Only writes within this folder. No network, models, sun vectors, lighting,
colour transforms or heavyweight dependencies. About 250 MB working memory.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
import argparse
import hashlib
import json
import time
from pathlib import Path
import site
site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.ndimage import gaussian_filter

HERE = Path(__file__).resolve().parent
N = 2048


def smooth(t):
    t = np.clip(t, 0, 1)
    return t*t*(3-2*t)


def quilt(layer):
    """Four distinct source fields, native pixels, partition of unity on a torus.

    Each patch is 1254 pixels across, centres are 1024 apart. Smoothstep
    windows overlap for 230 pixels. No source repeats within the period.
    Low patches get independent quarter turns to break any residual common
    source lighting orientation. Cirrus stays on the common wind axis.
    """
    out = np.zeros((N,N), np.float32)
    total = np.zeros_like(out)
    records = []
    for i, (cx,cy) in enumerate([(512,512),(1536,512),(512,1536),(1536,1536)]):
        path = HERE/'originals'/f'{layer}_{i+1:02}.png'
        with Image.open(path) as im:
            a = np.asarray(im.convert('RGB'), np.float32).mean(2)/255
        if layer == 'low':
            a = np.rot90(a, [0,1,3,2][i])
            # Source bytes are a shape descriptor, not measured radiance.
            a = np.clip((a-.018)/.92, 0, 1)
        else:
            # Increase weak generated descriptor signal, retain black air.
            a = np.clip((a-.003)/.29, 0, 1)
        h,w = a.shape
        assert h == w and 1024 < w < 2048
        q = np.arange(w, dtype=np.float32)-(w-1)/2
        edge = (w-1024)
        win = smooth((w/2-np.abs(q))/edge)
        weight = win[:,None]*win[None,:]
        yy = (np.arange(w)+cy-w//2)%N
        xx = (np.arange(w)+cx-w//2)%N
        out[np.ix_(yy,xx)] += a*weight
        total[np.ix_(yy,xx)] += weight
        records.append({'source':str(path.relative_to(HERE)), 'size':[w,h],
                        'centre':[cx,cy], 'quarter_turns':[0,1,3,2][i] if layer=='low' else 0,
                        'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    assert total.min() > .99
    return out/total, records


def low_channels(a, revision):
    # Isotropic filtering removes tiny photographic creases before they could
    # become fake optical-depth shadows. Large lobes remain mass maxima.
    core = gaussian_filter(a, 5.0, mode='wrap')
    detail = gaussian_filter(a, .65, mode='wrap')
    cover = -np.expm1(-7.2*np.maximum(detail-.012,0)**1.16)
    # Thickness has broader support than fine cover, but exactly vanishes in air.
    mass = .78*core + .22*gaussian_filter(a, 1.8, mode='wrap')
    thick = np.clip(mass/.83,0,1)**1.35
    thick *= smooth(cover/.22)
    if revision >= 2:
        # Sparse optical fringes; don't inflate every faint source shred into
        # bright opaque sky cover. Keep resolved lobe structure in depth.
        cover = -np.expm1(-8.0*np.maximum(detail-.025,0)**1.72)
        mass = .20*core + .80*gaussian_filter(a, .9, mode='wrap')
        thick = np.clip(mass/.89,0,1)**1.85
        thick *= smooth(cover/.18)
    if revision >= 3:
        # Preserve variation in the densest cores instead of clipping a whole
        # percentile to 1. Only the strongest mass reaches full depth.
        thick = np.clip(mass/max(float(mass.max()),1e-8),0,1)**1.85
        thick *= smooth(cover/.18)
    return cover, thick


def torus_labels(mask):
    """Connected components with adjacency through the two periodic edges."""
    labels, n = ndimage.label(mask)
    parent = np.arange(n+1)
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for first, last in [(labels[0], labels[-1]), (labels[:,0], labels[:,-1])]:
        for a,b in zip(first,last):
            if a and b:
                parent[root(a)] = root(b)
    return np.array([root(i) for i in range(n+1)])[labels]


def spaced_heaps(a):
    """Retain unique native heaps; move them by integer translation on the torus.

    The original four-patch quilt remains the source field. Selection depends
    on connected mass, not brightness alone: detached scraps disappear while
    every retained lobe keeps its native pixels. A short smooth support skirt
    keeps torn fringes close to the parent. No source heap is used twice.
    """
    labels = torus_labels(gaussian_filter(a,3,mode='wrap') > .30)
    counts = np.bincount(labels.ravel()); counts[0] = 0
    ranked = np.argsort(counts)[::-1]
    # Drop the three oversized joined complexes. Retain substantial compact
    # heaps and a varied smaller population, each native shape exactly once.
    ranks = [3,4,5,6,7,8,9,10,12,14,16,18,20,22,25,28,31,34,37,40,43,46,49,52]
    selected = [int(ranked[r]) for r in ranks if counts[ranked[r]] >= 1800]
    rng = np.random.default_rng(27019)
    out = np.zeros_like(a)
    occupied = np.zeros((N,N),bool)
    source_used = np.zeros((N,N),bool)
    records = []
    for i,k in enumerate(selected):
        sy,sx = np.nonzero(labels == k)
        # Circular centres keep components that cross the quilt wrap intact.
        cx = int(np.angle(np.mean(np.exp(2j*np.pi*sx/N))) * N/(2*np.pi)) % N
        cy = int(np.angle(np.mean(np.exp(2j*np.pi*sy/N))) * N/(2*np.pi)) % N
        dx = (sx-cx+N//2)%N-N//2; dy = (sy-cy+N//2)%N-N//2
        x = np.arange(dx.min()-140,dx.max()+141)+cx
        y = np.arange(dy.min()-140,dy.max()+141)+cy
        seed = labels[np.ix_(y%N,x%N)] == k
        distance = ndimage.distance_transform_edt(~seed)
        skirt = smooth((24-distance)/16)
        patch = a[np.ix_(y%N,x%N)]*skirt
        support = patch > .025
        assert not np.any(source_used[np.ix_(y%N,x%N)] & support), 'Native source mass reused'
        source_used[np.ix_(y%N,x%N)] |= support
        # Vary clear separation (150-420 m) and admit loose groupings, but
        # never overlap masks. Rejection sampling has no patch-grid anchors.
        gap = int(rng.integers(38,108))
        clearance = distance < 24+gap
        for attempt in range(20000):
            tx,ty = rng.integers(0,N,2)
            # An irregular broad clear corridor; it bends and has no 4 km
            # period. Only reject centres; natural cloud edges define it.
            lane = 870 + 160*np.sin(2*np.pi*ty/N) + 85*np.sin(4*np.pi*ty/N+.6)
            lane_distance = abs((tx-lane+N/2)%N-N/2)
            if lane_distance < 110 + min(100,np.sqrt(counts[k]/np.pi)*.35):
                continue
            xx = (x-cx+tx)%N; yy = (y-cy+ty)%N
            if np.any(occupied[np.ix_(yy,xx)] & clearance):
                continue
            break
        else:
            raise RuntimeError('Could not place native cloud without crowding')
        out[np.ix_(yy,xx)] = np.maximum(out[np.ix_(yy,xx)],patch)
        occupied[np.ix_(yy,xx)] |= support
        records.append({'component':k,'core_pixels':int(counts[k]),
                        'source_centre_xy':[cx,cy],'destination_centre_xy':[int(tx),int(ty)],
                        'integer_translation_xy':[int(tx)-cx,int(ty)-cy],
                        'clearance_pixels':gap})
    return out, records


def typical_origin(rgb, clustered=False):
    """Choose representative wrap lines; translate only, never repair pixels.

    The field is already continuous on the torus. Since seam() compares one
    slice to the mean, stochastic density can give a non-unit ratio on an
    arbitrary line. This chooses near-average lines for both data channels.
    """
    if clustered:
        f=rgb[:,:,:2].astype(np.float32)
        scores=[]
        for axis in [1,0]:
            profile=np.abs(f-np.roll(f,1,axis)).mean(axis=1-axis)
            ratio=profile/np.maximum(profile.mean(axis=0),1e-9)
            scores.append(np.sum(np.log(np.maximum(ratio,1e-5))**2,axis=1))
        # Keep a genuinely quiet 4 km quarter legible in the stored tile.
        # This is only an origin choice on the already-built periodic sky.
        q=ndimage.uniform_filter(f[:,:,0]/255,size=N//2,mode='wrap')
        q=np.roll(q,(-N//4,-N//4),(0,1))
        minimum=np.minimum.reduce([q,np.roll(q,N//2,0),np.roll(q,N//2,1),
                                   np.roll(q,(N//2,N//2),(0,1))])
        score=scores[0][None,:]+scores[1][:,None]+(20*np.maximum(minimum-.075,0))**2
        y,x=np.unravel_index(np.argmin(score),score.shape)
        return np.roll(rgb,(-int(y),-int(x)),(0,1)),[-int(x),-int(y)]
    shifts=[]
    for axis in [1,0]:
        f=rgb[:,:,:2].astype(np.float32)
        delta=np.abs(f-np.roll(f,1,axis))
        profile=delta.mean(axis=1-axis)
        ratio=profile/np.maximum(profile.mean(axis=0),1e-9)
        score=np.sum(np.log(np.maximum(ratio,1e-5))**2,axis=1)
        idx=int(np.argmin(score))
        rgb=np.roll(rgb,-idx,axis)
        shifts.append(-idx)
    return rgb,shifts


def clustered_heaps(a, revision=5):
    """Unique native heaps in uneven 2–4 km weather groups, revision five.

    Keep the accepted mass/edge construction. Remove the hooked complex and
    split one other oversized parent at its natural density saddle. The two
    remaining oversized parents are replaced with ordinary new source heaps.
    No source magnification, repeated sprites, noise or directional shading.
    """
    filtered = gaussian_filter(a,3,mode='wrap')
    old = torus_labels(filtered > .30)
    counts = np.bincount(old.ravel()); counts[0] = 0
    ranked = np.argsort(counts)[::-1]
    seeds = np.zeros_like(old)
    origins = {}; k = 0
    # Keep all ordinary round-two selections, then favour medium additions.
    # The weakest sixteen optional small heaps made the horizon speckled.
    for rank in [*range(4,50),52]:
        parent = ranked[rank]
        k += 1; seeds[old==parent] = k
        origins[k] = {'parent_component':int(parent),'parent_rank':rank,'core_threshold':.30}
    for rank,threshold in [(2,.40)]:
        fragments = torus_labels((old==ranked[rank]) & (filtered>threshold))
        sizes = np.bincount(fragments.ravel()); sizes[0] = 0
        for child in np.flatnonzero(sizes>=12000):
            k += 1; seeds[fragments==child] = k
            origins[k] = {'parent_component':int(ranked[rank]),'parent_rank':rank,
                          'core_threshold':threshold}
    counts = np.bincount(seeds.ravel()); counts[0] = 0
    padded=np.pad(seeds,32,mode='wrap')
    nearest=ndimage.distance_transform_edt(padded==0,return_distances=False,return_indices=True)
    owner=padded[tuple(nearest)][32:-32,32:-32]
    del padded,nearest
    rng = np.random.default_rng(31073)
    # Elliptical associations, not evenly spaced individual-cloud rejection.
    # The last, small association leaves most of its quarter clear.
    groups = [(420,430,440,330,-.18), (1550,440,465,280,-.43),
              (470,1470,340,420,-.35), (1540,1530,235,155,-.30)]
    targets = np.array([.38,.28,.29,.05])
    assigned = np.zeros(4)
    occupied = np.zeros((N,N),bool); used = np.zeros_like(occupied)
    out = np.zeros_like(a); records = []; patches=[]
    for k in np.argsort(counts)[::-1]:
        if not counts[k]: continue
        sy,sx = np.nonzero(seeds==k)
        cx = int(np.angle(np.mean(np.exp(2j*np.pi*sx/N)))*N/(2*np.pi))%N
        cy = int(np.angle(np.mean(np.exp(2j*np.pi*sy/N)))*N/(2*np.pi))%N
        dx=(sx-cx+N//2)%N-N//2;dy=(sy-cy+N//2)%N-N//2
        x=np.arange(dx.min()-36,dx.max()+37)+cx
        y=np.arange(dy.min()-36,dy.max()+37)+cy
        local=seeds[np.ix_(y%N,x%N)]
        distance=ndimage.distance_transform_edt(local!=k)
        skirt=smooth((24-distance)/16)
        # Neighbouring split cores own disjoint original mass, with a soft
        # zero-valued gap at their saddle instead of a geometric hard cut.
        ownership=owner[np.ix_(y%N,x%N)]==k
        skirt *= smooth(ndimage.distance_transform_edt(ownership)/5)
        patch=a[np.ix_(y%N,x%N)]*skirt
        support=patch>.025
        assert not np.any(used[np.ix_(y%N,x%N)]&support), 'Source mass reused'
        used[np.ix_(y%N,x%N)] |= support
        patches.append((patch,x-cx,y-cy,int(counts[k]),dict(origins[k],
            source_field='native_quilt',component=int(k),source_centre_xy=[cx,cy])))
    # New whole heaps supply ordinary large shapes without duplicating or
    # enlarging any accepted round-two cloud. Only the new source is reduced
    # to 90% with a box filter; this keeps its largest heaps below 1.5 km.
    # Same mass transfer and skirt as the original native quilt heaps.
    path=HERE/'originals/low_05.png'
    extra=np.asarray(Image.open(path).convert('RGB').resize((1128,1128),Image.Resampling.BOX),np.float32).mean(2)/255
    extra=np.clip((extra-.018)/.92,0,1)
    lab,n=ndimage.label(gaussian_filter(extra,3)>.30)
    sizes=np.bincount(lab.ravel());sizes[0]=0
    ids=np.argsort(sizes)[::-1]
    extra_used=np.zeros(extra.shape,bool)
    for rank in [0,1,3,4,5,6,7,8]:
        k=int(ids[rank]);sy,sx=np.nonzero(lab==k)
        cx=int(sx.mean());cy=int(sy.mean())
        x=np.arange(max(0,sx.min()-36),min(extra.shape[1],sx.max()+37))
        y=np.arange(max(0,sy.min()-36),min(extra.shape[0],sy.max()+37))
        distance=ndimage.distance_transform_edt(lab[np.ix_(y,x)]!=k)
        patch=extra[np.ix_(y,x)]*smooth((24-distance)/16)
        # Sources almost reach the frame: fade only the outermost 8 pixels.
        patch*=smooth(np.minimum(x,extra.shape[1]-1-x)/8)[None,:]
        patch*=smooth(np.minimum(y,extra.shape[0]-1-y)/8)[:,None]
        support=patch>.025
        assert not np.any(extra_used[np.ix_(y,x)]&support)
        extra_used[np.ix_(y,x)] |= support
        patches.append((patch,x-cx,y-cy,int(sizes[k]),dict(
            source_field='originals/low_05.png',source_scale=1128/1254,parent_rank=rank,core_threshold=.30,
            component=k,source_centre_xy=[cx,cy])))
    if revision >= 6:
        return broken_rows(patches)
    for patch,x,y,count,origin in sorted(patches,key=lambda p:-p[3]):
        gap=int(rng.integers(2,15))
        packed_support=patch>.08
        clearance=ndimage.distance_transform_edt(~packed_support)<=gap
        group=int(np.argmin((assigned+count*.5)/targets))
        gx,gy,rx,ry,angle=groups[group]
        for attempt in range(16000):
            if attempt and attempt%2500==0:
                # A packed association can hand a heap to another weather
                # group; it must never fall back to uniform sky coverage.
                options=np.argsort((assigned+count*.5)/targets)
                group=int(options[(attempt//2500)%4])
                gx,gy,rx,ry,angle=groups[group]
            # Bounded Gaussian creates close local neighbours and clear
            # outskirts; centres never scatter uniformly over the tile.
            u,v=rng.normal(0,.64,2)
            if u*u+v*v>2.2: continue
            tx=int(gx+rx*u*np.cos(angle)-ry*v*np.sin(angle))%N
            ty=int(gy+rx*u*np.sin(angle)+ry*v*np.cos(angle))%N
            xx=(x+tx)%N; yy=(y+ty)%N
            if not np.any(occupied[np.ix_(yy,xx)]&clearance): break
        else: raise RuntimeError(f'Group {group} full at heap {k}')
        out[np.ix_(yy,xx)] = np.maximum(out[np.ix_(yy,xx)],patch)
        occupied[np.ix_(yy,xx)] |= packed_support
        assigned[group] += count
        cx,cy=origin['source_centre_xy']
        records.append(dict(origin,core_pixels=count,destination_centre_xy=[tx,ty],
            integer_translation_xy=[tx-cx,ty-cy],group=group,clearance_pixels=gap))
    return out,records


def broken_rows(patches, seed=4721):
    """Translate the accepted heaps into unequal, bending, interrupted rows.

    Curves cross the torus edges. Neither quarters nor a quiet square enter
    placement. The field controls centre proposals only, never cloud pixels.
    """
    rng=np.random.default_rng(seed)
    side=256
    yy,xx=np.mgrid[:side,:side].astype(np.float32)*N/side
    density=np.zeros((side,side),np.float32)
    paths=[((-180,450),(420,80),(1050,300),145,1.0),
           ((700,1000),(1180,750),(1980,460),185,.90),
           ((-260,1400),(260,1520),(740,1150),140,.72),
           ((1030,1950),(1470,1350),(2030,1450),195,1.05)]
    for i,(p0,p1,p2,width,strength) in enumerate(paths):
        for t in np.linspace(0,1,32):
            cx,cy=(1-t)**2*np.array(p0)+2*t*(1-t)*np.array(p1)+t*t*np.array(p2)
            dx=(xx-cx+N/2)%N-N/2;dy=(yy-cy+N/2)%N-N/2
            radius=width*(.78+.25*np.sin(5*t+i))
            weight=strength*(.2+.8*np.sin(np.pi*t)**.6)*(.65+.35*np.cos(3*np.pi*t+i))
            density+=weight*np.exp(-.5*(dx*dx+dy*dy)/radius**2)
    # Sample a continuous centre field through a small CDF. Source heaps are
    # still integer translated at their original size and never duplicated.
    probability=density.ravel()**1.1
    cdf=np.cumsum(probability);cdf/=cdf[-1]
    occupied=np.zeros((N,N),bool);out=np.zeros((N,N),np.float32);records=[]
    for patch,x,y,count,origin in sorted(patches,key=lambda p:-p[3]):
        gap=int(rng.integers(3,25))
        support=patch>.08
        clearance=ndimage.distance_transform_edt(~support)<=gap
        for attempt in range(30000):
            index=int(np.searchsorted(cdf,rng.random()))
            tx=int((index%side+rng.random())*N/side)%N
            ty=int((index//side+rng.random())*N/side)%N
            xxp=(x+tx)%N;yyp=(y+ty)%N
            if not np.any(occupied[np.ix_(yyp,xxp)]&clearance):break
        else:raise RuntimeError('Broken rows cannot accommodate the accepted heaps')
        out[np.ix_(yyp,xxp)]=np.maximum(out[np.ix_(yyp,xxp)],patch)
        occupied[np.ix_(yyp,xxp)]|=support
        cx,cy=origin['source_centre_xy']
        records.append(dict(origin,core_pixels=count,destination_centre_xy=[tx,ty],
            integer_translation_xy=[tx-cx,ty-cy],clearance_pixels=gap,layout_seed=seed))
    return out,records


def cirrus_bands(revision=5):
    """Two native long-fibre bands and isolated source patches.

    Compact edge windows reach exactly zero. There is no all-sky background
    population. Each new source appears once, translated on the torus.
    """
    out=np.zeros((N,N),np.float32); records=[]
    sources=[
            ('high_05.png',None,610,530,1.0),
            ('high_06.png',(180,0,1110,1254),1540,1150,1.35),
            ('high_03.png',(680,270,950,460),1410,630,.75),
            ('high_02.png',(620,600,940,800),510,1630,.70)]
    if revision>=6:
        sources.extend([
            ('high_04.png',(670,540,1100,810),1462,1938,.70),
            ('high_01.png',(180,320,650,560),226,1290,.60)])
    for name,crop,cx,cy,gain in sources:
        path=HERE/'originals'/name
        with Image.open(path) as im:
            if crop: im=im.crop(crop)
            a=np.asarray(im.convert('RGB'),np.float32).mean(2)/255
        h,w=a.shape
        a=np.maximum(a-.0035,0)/.32*gain
        # Compact source window: only the outer 90 pixels taper, not a
        # repeated directional band envelope superposed on short hooks.
        margin=90 if name in ['high_05.png','high_06.png'] else 55
        wx=smooth(np.minimum(np.arange(w),np.arange(w)[::-1])/margin)
        wy=smooth(np.minimum(np.arange(h),np.arange(h)[::-1])/margin)
        a*=wy[:,None]*wx[None,:]
        xx=(np.arange(w)+cx-w//2)%N; yy=(np.arange(h)+cy-h//2)%N
        out[np.ix_(yy,xx)] += a
        records.append({'source':str(path.relative_to(HERE)),
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'crop':crop,'size':[w,h],'centre':[cx,cy],'gain':gain})
    return out,records


def high_channels(a, revision):
    detail = gaussian_filter(a, .45, mode='wrap')
    cover = .74*(-np.expm1(-2.7*detail**1.12))
    mass = gaussian_filter(a, 2.2, mode='wrap')
    thick = np.clip(mass/.87,0,1)**1.1
    thick *= smooth(cover/.08)
    if revision >= 2:
        cover = .43*(-np.expm1(-2.4*detail**1.25))
        thick = np.clip(mass/.87,0,1)**1.1
        thick *= smooth(cover/.055)
    if revision == 4:
        # Broad wind-aligned envelopes only change existing native fibre mass;
        # they cannot create a veil in empty air. Smooth periodic distances.
        yy,xx = np.mgrid[:N,:N].astype(np.float32)
        bands = np.zeros_like(a)
        angle = np.deg2rad(26)
        for cx,cy,length,width,strength in [(310,470,650,105,1.0),
                                           (1410,1260,740,145,1.0),
                                           (490,1830,470,85,.72)]:
            # Sum periodic images, then take a saturating envelope; compact
            # Gaussian tails join continuously at the texture edges.
            envelope = np.zeros_like(a)
            for ox in [-N,0,N]:
                for oy in [-N,0,N]:
                    dx=xx-cx+ox;dy=yy-cy+oy
                    along=dx*np.cos(angle)-dy*np.sin(angle)
                    across=dx*np.sin(angle)+dy*np.cos(angle)
                    envelope += strength*np.exp(-.5*((along/length)**2+(across/width)**2))
            bands = np.maximum(bands,envelope)
        bands = smooth((bands-.18)/.65)
        cover = (.32+.43*bands)*(-np.expm1(-(2.4+1.9*bands)*detail**(1.30-.45*bands)))
        # Depth still follows isotropically filtered fibre mass. It does not
        # inherit an artificial wind-facing or sun-facing edge.
        mass = gaussian_filter(a*(.72+.65*bands),2.2,mode='wrap')
        thick = (mass/max(float(mass.max()),1e-8))**1.1
        thick *= smooth(cover/.055)
    if revision >= 5:
        detail=gaussian_filter(a,.45,mode='wrap')
        cover=.75*(-np.expm1(-3.8*detail**.95))
        mass=gaussian_filter(a,2.2,mode='wrap')
        thick=(mass/max(float(mass.max()),1e-8))**1.1
        thick*=smooth(cover/.055)
    return cover, thick


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--revision',type=int,default=6,choices=[1,2,3,4,5,6])
    ap.add_argument('--out',default='.')
    args = ap.parse_args()
    dest=(HERE/args.out).resolve()
    assert dest==HERE or HERE in dest.parents
    dest.mkdir(parents=True,exist_ok=True)
    started=time.monotonic()
    meta={'revision':args.revision,'size':N,'colour_space':'linear data; no colour profile',
          'blue':0,'high_wind':'image lower-left to upper-right, about 25 degrees above +x'}
    if args.revision>=6:
        meta['recommended_tile_spans_m']={'low':8000,'high':32000}
    for layer,make in [('low',low_channels),('high',high_channels)]:
        a,records=cirrus_bands(args.revision) if layer=='high' and args.revision>=5 else quilt(layer)
        placements = None
        if layer=='low' and args.revision>=4:
            a,placements=clustered_heaps(a,args.revision) if args.revision>=5 else spaced_heaps(a)
            if args.revision>=5:
                p=HERE/'originals/low_05.png'
                records.append({'source':str(p.relative_to(HERE)),'size':list(Image.open(p).size),
                    'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'use':'eight unique whole heaps'})
        cover,thick=make(a,args.revision)
        rgb=np.zeros((N,N,3),np.uint8)
        rgb[:,:,0]=np.rint(np.clip(cover,0,1)*255).astype(np.uint8)
        rgb[:,:,1]=np.rint(np.clip(thick,0,1)*255).astype(np.uint8)
        shifts=[0,0]
        if args.revision>=3:
            rgb,shifts=typical_origin(rgb,clustered=layer=='low' and args.revision==5)
        Image.fromarray(rgb).save(dest/f'{layer}.png',compress_level=6)
        meta[layer]={'sources':records,'periodic_roll_xy':shifts,'mean_cover':float(rgb[:,:,0].mean()/255),
                     'mean_thickness':float(rgb[:,:,1].mean()/255)}
        if placements is not None:
            meta[layer]['retained_heaps']=placements
            meta[layer]['source_mass_pixels_used_more_than_once']=0
        print(layer,meta[layer]['mean_cover'],meta[layer]['mean_thickness'],flush=True)
    meta['build_seconds']=round(time.monotonic()-started,3)
    (dest/'build_metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
    print('Build seconds',meta['build_seconds'])


if __name__ == '__main__':
    main()
