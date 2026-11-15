"""Deterministic injury / harvest pigment, in the current animal's physical frame.

Run from any directory: python3 -B tex/layers/paint.py
Only writes the four requested PNGs and checks/manifest.json beside this script.
Alpha is an arrival clock, never conventional opacity. No lights or wet highlights.
"""
from pathlib import Path
import hashlib
import json
import site

site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import distance_transform_edt, gaussian_filter
from scipy.interpolate import CubicSpline, PchipInterpolator
from scipy.spatial import cKDTree

HERE = Path(__file__).resolve().parent
TEX = HERE.parent
PAINT = TEX / "paint"
BAKES = TEX.parent / "ref" / "bakes"
N = 1024
INPUTS = {}


def read(path):
    path = Path(path)
    INPUTS[str(path.relative_to(TEX.parent))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return path


def data(path):
    return json.loads(read(path).read_text())


def pic(path, nearest=False):
    im = Image.open(read(path))
    return np.asarray(im.resize((N, N), Image.Resampling.NEAREST if nearest else Image.Resampling.BILINEAR)).astype(np.float32)


def smooth(a, b, x):
    t = np.clip((x-a)/(b-a), 0, 1)
    return t*t*(3-2*t)


def mix(a, b, weight):
    return np.asarray(a) * (1-weight[..., None]) + np.asarray(b) * weight[..., None]


def waves(u, v, seed, scale=1):
    """Smooth irregular pigment, shared across seams and both membrane faces.

    Fixed value-noise lattice: no periodic stripe drawing or random-state input.
    """
    def octave(x,y,s):
        ix,iy=np.floor(x),np.floor(y)
        fx,fy=x-ix,y-iy
        fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy)
        def sample(a,b):
            h=np.sin(a*127.1+b*311.7+s*74.7)*43758.5453
            return h-np.floor(h)
        return ((sample(ix,iy)*(1-fx)+sample(ix+1,iy)*fx)*(1-fy)
                +(sample(ix,iy+1)*(1-fx)+sample(ix+1,iy+1)*fx)*fy)*2-1
    return (octave(u*32*scale,v*32*scale,seed)*.62
            +octave(u*73*scale,v*73*scale,seed+2)*.28
            +octave(u*149*scale,v*149*scale,seed+7)*.10)


def stroke(u, v, points):
    """Distance to an open, variable-width physical stroke (millimetres).

    This is a pigment field, not a closed outline. Paths and their unequal
    widths are the original drawing in source/marks.json.
    """
    pts = np.asarray(points, dtype=float)/1000
    distance = np.full_like(u, 100)
    for start, end in zip(pts, pts[1:]):
        dx, dy = end[:2]-start[:2]
        t = np.clip(((u-start[0])*dx+(v-start[1])*dy)/(dx*dx+dy*dy), 0, 1)
        width = start[2]+t*(end[2]-start[2])
        d = np.hypot(u-start[0]-t*dx, v-start[1]-t*dy)/np.maximum(width, .001)
        distance = np.minimum(distance, d)
    return distance


def membrane_wound(mark, u, v, palette):
    """A slit or puncture assembled from separate lips, clots and bruises.

    All fields are physical X/Z fields shared by the membrane's two faces.
    Blood is confined to disconnected strokes: no radial red bank surrounds
    the opening. The support and its reveal clock include the runoff drops.
    """
    seed = mark['seed']
    pal = {k: np.asarray(value, np.float32) for k, value in palette.items()}
    noise = waves(u, v, seed)
    fine = waves(u, v, seed+4, 3.5)
    first, last = mark['reveal']
    drawing = mark['drawing']
    # Unequal, overlapping bruises; one side is much more heavily soaked.
    bruise = np.full_like(u, 100)
    for x, y, length, width in drawing['bruises_mm']:
        d = np.hypot((u-x/1000)/(length/2000), (v-y/1000)/(width/2000))
        bruise = np.minimum(bruise, d)
    bruise *= 1+.22*noise+.045*fine
    # Bruised skin must remain distinct from the near-black opening. A broad
    # field of wound-core value would turn the entire bruise into another hole.
    col = mix(pal['bruise_deep'],pal['bruise_skin'],smooth(.08,.95,bruise))
    col += fine[:,None]*3+noise[:,None]*np.array([4,3,3])
    r = bruise.copy()
    arrival = first+(last-first)*np.clip(bruise,0,1)**1.65

    # Later contusions spread well beyond the accepted aperture drawing.
    # Their clock is independent, so a larger stage-three bruise does not
    # enlarge the stage-one hole or turn the runoff into a continuous stripe.
    spread = np.full_like(u, 100)
    for x, y, length, width in drawing.get('spread_bruises_mm', []):
        d = np.hypot((u-x/1000)/(length/2000), (v-y/1000)/(width/2000))
        spread = np.minimum(spread, d)
    spread *= 1+.17*noise+.04*fine
    spread_first = drawing.get('spread_start', 2.02)
    spread_clock = spread_first+(2.995-spread_first)*np.clip(spread,0,1)**2.5
    spread_col = mix(pal['contusion_deep'],pal['contusion_skin'],smooth(.12,.92,spread))
    spread_col += noise[:,None]*np.array([5,3,4])+fine[:,None]*2
    col = np.where((bruise>=1)[:,None],spread_col,col)
    r = np.minimum(r,spread)
    arrival = np.minimum(arrival,spread_clock)

    if mark['shape'] == 'tear':
        lips = np.asarray(drawing['lips_mm'])/1000
        low = np.interp(u, lips[:,0], lips[:,1])+.0018*fine
        high = np.interp(u, lips[:,0], lips[:,2])+.0020*noise
        centre = (low+high)/2
        half = np.maximum((high-low)/2, .001)
        gap = np.abs(v-centre)/half
        ends = smooth(lips[0,0]-.008,lips[0,0]+.003,u)*(1-smooth(lips[-1,0]-.006,lips[-1,0]+.002,u))
        opening = (1-smooth(.72,1.10,gap))*ends
        # Advance inward from the trailing edge; the short split arrives last.
        progress = smooth(*drawing.get('opening_progress_m',[-.14,.16]),u)
        gap_arrival = first+drawing.get('opening_advance',.92)*progress+.32*np.clip(gap,0,1)
        arrival = np.minimum(arrival, np.where(opening>.01,gap_arrival,4))
        # The peeled-back lip is a dark flap with short pucker folds. It is
        # deliberately longer and farther from the gap than the other lip.
        fold = np.full_like(u,100)
        for path in drawing['folds_mm']:
            fold = np.minimum(fold,stroke(u,v,path))
        col = mix(col, pal['split']*.65, (1-smooth(.45,1,fold))*.65)
    else:
        # An oblique, torn aperture with intruding tongues, not a round disk.
        opening_path = drawing['opening_mm']
        gap = stroke(u+.0025*noise,v+.004*fine,opening_path)
        gap *= 1+.22*noise
        opening = 1-smooth(.58,1.12,gap)
        arrival = np.minimum(arrival,np.where(gap<1.15,first+.30*np.clip(gap,0,1),4))

    # Individually drawn clots, smears and detached drops with changing width.
    # A thin blood lip has holes; neither bank is generated from gap distance.
    for item in drawing.get('thin_blood_strokes', []) + drawing['blood_strokes']:
        d = stroke(u,v,item['path_mm'])*(1+.18*noise+.05*fine)
        r = np.minimum(r,d)
        pigment = 1-smooth(.42,1,d)
        pigment_name = 'fresh_crimson' if item['pigment']=='blood' else item['pigment']
        blood = pal[pigment_name]+fine[:,None]*np.array([9,2,2])+noise[:,None]*np.array([12,2,3])
        col = mix(col,blood,pigment*item.get('strength',1))
        start = item.get('start',first+item.get('delay',0))
        clock = start+(item.get('end',last)-start)*np.clip(d,0,1)**1.5
        arrival = np.minimum(arrival,np.where(d<1,clock,4))
    col = mix(col,pal['wound_core']+fine[:,None]*1.5,opening)
    # Leave a soft, irregular final fringe rather than an opaque decal edge.
    fringe = 2.75*smooth(.58,.82,r)+.245*smooth(.82,1,r)
    arrival = np.maximum(arrival,fringe)
    return r, col, arrival


class Atlas:
    def __init__(self, name):
        self.name = name
        self.meta = data(PAINT / f"{name}_pieces.json")
        self.ids = {p['name']: p['number'] for p in self.meta['pieces']}
        self.piece = pic(PAINT / f"{name}_pieces.png", True)[..., 0].astype(np.uint8)
        self.covered = self.piece > 0
        self.iy, self.ix = np.where(self.covered)
        self.p = self.piece[self.covered]
        b = self.meta['position_box']
        pos = np.stack([pic(PAINT / f"{name}_position_{a}.png", True)/65535 *
                        (b['max'][i]-b['min'][i])+b['min'][i] for i, a in enumerate('xyz')], -1)
        self.pos = pos[self.covered]
        self.mm = pic(PAINT / f"{name}_texel_mm.png", True)[self.covered]/1000*2
        base = pic(TEX / f"{name}_base.png")[..., :3].mean(-1)
        height = pic(TEX / f"{name}_height.png")/65535
        self.grain = np.clip(((base-gaussian_filter(base, 5))/13 +
                            (height-gaussian_filter(height, 3))*7)[self.covered], -1, 1)
        self.clump = np.clip((gaussian_filter(height, 1)-gaussian_filter(height, 6))[self.covered]*12, -1, 1)
        # Read all current material inputs. Relief and weights are not rewritten.
        self.packed = pic(TEX / f"{name}_packed.png")[self.covered]/255
        pic(TEX / f"{name}_normal.png")
        suffixes = ['mask', 'mask2'] if name.endswith('wing') else ['regions']
        for suffix in suffixes:
            pic(TEX / f"{name}_{suffix}.png", suffix == 'regions')
        normal = pic(BAKES / f"{name}_normal_object.png")[..., :3]/127.5-1
        normal[..., 0] *= -1  # corrected position maps store the negative-X half
        self.normal = normal[self.covered]
        self.normal /= np.maximum(np.linalg.norm(self.normal, axis=-1, keepdims=True), 1e-8)
        flow = pic(BAKES / f"{name}_flow.png")[..., :2]/127.5-1
        du = np.gradient(pos, axis=1)
        dv = -np.gradient(pos, axis=0)
        tangent = (du*flow[..., :1]+dv*flow[..., 1:2])[self.covered]
        self.flow = tangent/np.maximum(np.linalg.norm(tangent, axis=-1, keepdims=True), 1e-8)
        count = len(self.p)
        self.out = {k: {'rgb': np.zeros((count, 3), np.float32),
                        'arrival': np.full(count, 4, np.float32)} for k in ['hurt', 'decay']}
        self.marks = []

    def frame(self, mark):
        membrane = mark['kind'] in ('membrane', 'leather')
        if membrane:
            mask = np.isin(self.p, [self.ids['membrane_upper'], self.ids['membrane_under']])
            dx = -self.pos[:, 0]-mark['at'][0]
            dz = self.pos[:, 2]-mark['at'][1]
            t = np.deg2rad(mark['angle'])
            u, v = dx*np.cos(t)+dz*np.sin(t), -dx*np.sin(t)+dz*np.cos(t)
            depth = np.zeros_like(u)
            anchor = mark['at']
        else:
            mask = self.p == self.ids[mark['piece']]
            dist = np.sum((self.pos-np.array(mark['at']))**2, axis=-1)
            index = np.argmin(np.where(mask, dist, np.inf))
            anchor = self.pos[index]
            n = self.normal[index]
            t = np.array(mark['axis'], np.float32)
            if mark['kind'] == 'fuzz':
                # The local comb and its downstream sign come from the bake.
                flow = self.flow[index].copy()
                t = flow if np.linalg.norm(flow) > .5 else t
            t -= n*np.dot(t, n)
            t /= max(np.linalg.norm(t), 1e-8)
            b = np.cross(n, t)
            rel = self.pos-anchor
            u, v, depth = (np.sum(rel*axis, axis=-1) for axis in (t,b,n))
            # Exclude the mirrored centreline and opposite surface of thin horn.
            mask &= self.pos[:, 0] < -0.006
            mask &= np.sum(self.normal*n, axis=-1) > -0.15
        return mask, u, v, depth, np.asarray(anchor).tolist()

    def paint(self, mark, palette):
        mask, u, v, depth, anchor = self.frame(mark)
        length, width = np.array(mark['size'])/1000
        a, b = u/(length/2), v/(width/2)
        seed = mark['seed']
        macro = waves(u, v, seed)
        fine = waves(u, v, seed+4, 3.5)
        membrane = mark['kind'] in ('membrane', 'leather')
        # Ragged, unequal silhouette; no UV-space random pixels or circular stamps.
        warp = np.interp(a,np.linspace(-1,1,11),np.roll([.07,-.13,.03,-.09,.16,.05,-.02,.13,-.06,.1,-.08],seed%11))
        r = np.sqrt(a*a + (b+warp)**2 + (depth/max(width*.8, .04))**2)
        r *= 1 + 0.14*macro + 0.035*fine
        kind = mark['kind']
        if kind in ('fuzz', 'skin'):
            # A swept mat with unequal locks, including long soaked tails.
            # Physical 8–25 mm edge variation survives the 256-pixel store.
            comb = waves(u*.28, v*1.9, seed+63, 1.4)
            centre = .12*np.sin(a*3+seed)+.10*macro
            breadth = .65+.15*np.sin(a*4+seed)+.16*comb
            r = np.sqrt((a/(.93+.08*macro))**2 + ((b-centre)/breadth)**2
                        + (depth/max(width*.72,.035))**2)
            for j, (offset, shift, reach) in enumerate([(-.44,.27,.85),(-.13,.45,.90),(.24,.35,.72),(.49,.13,.67)]):
                lock = np.sqrt(((a-shift)/reach)**2+
                               ((b-offset-.08*macro)/(.15+.035*np.sin(seed+j)))**2+
                               (depth/max(width*.6,.03))**2)
                r = np.minimum(r, lock)
            r *= 1+.085*comb+.035*fine
        elif kind == 'membrane':
            r, wound_col, wound_arrival = membrane_wound(mark,u,v,palette)
        elif kind == 'leather':
            # Narrow, branching shrinkage fields derive from the real vascular
            # paths. No round stamp supplies the drying field's silhouette.
            r = np.full_like(u,100)
            drying_arrival = np.full_like(u,4)
            x,z = -self.pos[:,0],self.pos[:,2]
            for item in mark['drying_network']:
                path = self.network_paths[item['path']]
                guides = np.asarray(path['guides'])*1000
                arc = np.r_[0,np.cumsum(np.linalg.norm(np.diff(guides,axis=0),axis=1))]
                samples = np.linspace(0,arc[-1],max(4,int(arc[-1]/30)))
                curve = CubicSpline(arc,guides,bc_type='natural')(samples)
                radii = PchipInterpolator(arc,item['radii_mm'])(samples)
                points = np.column_stack([curve,radii])
                d = stroke(x,z,points)*(1+.13*macro+.035*fine)
                r = np.minimum(r,d)
                begin = mark['reveal'][0]+item.get('delay',0)
                clock = begin+(2.995-begin)*np.clip(d,0,1)**1.7
                drying_arrival = np.minimum(drying_arrival,np.where(d<1,clock,4))
            # Keep the accepted inter-vessel splits inside the drying field,
            # including the short branches that lie away from a vessel.
            for path in mark['creases_xz_mm']:
                support = [[px,pz,18+radius*5] for px,pz,radius in path]
                d = stroke(x,z,support)*(1+.13*macro+.035*fine)
                r = np.minimum(r,d)
                clock = 1.18+1.815*np.clip(d,0,1)**1.7
                drying_arrival = np.minimum(drying_arrival,np.where(d<1,clock,4))
        mask &= r < 1
        layer = mark.get('layer', 'hurt')
        first, last = mark['reveal']
        arrival = first+(last-first)*np.clip(r, 0, 1)**2.0
        # The last narrow fringe is still partially mixed at stage three. This
        # avoids a fully opaque sticker border without using alpha as opacity.
        arrival += (2.995-last)*smooth(.64,1,r)
        if kind == 'leather':
            fringe = 2.75*smooth(.38,.70,r)+.245*smooth(.70,1,r)
            arrival = np.maximum(drying_arrival,fringe)
        if not membrane and layer == 'hurt':
            # Fade before the mirrored midline rather than cutting a straight
            # alpha edge into the saddle view of the back of the neck.
            arrival = np.maximum(arrival, 2.995*smooth(-.048,-.006,self.pos[:,0]))
        # A shared physical grain is vital on the membrane's two views.
        grain = 0.45*fine if membrane else self.grain*.65+self.clump*.45+fine*.18
        pal = {k: np.array(value, np.float32) for k, value in palette.items()}
        if kind in ('fuzz', 'skin', 'membrane'):
            col = mix(pal['blood'], pal['blood_edge'], smooth(.42, .96, r))
            col += grain[:, None] * np.array([14, 3, 2])
            if kind == 'membrane':
                col, arrival = wound_col, wound_arrival
            else:
                # Existing pile supplies clumps inside the stain. No skin ring
                # or pale tissue outline around the blood-matted fuzz.
                clots = waves(u*.25,v*2.8,seed+22,1.5)
                col = mix(col,pal['maroon'],smooth(-.15,.45,clots)*.65)
                line = -.12+.13*np.sin(a*4+seed)+.07*macro
                breadth = .12+.08*smooth(.2,-.7,a)
                focus = smooth(.85,.36,np.abs(a+.24))*smooth(breadth+.07,breadth-.03,np.abs(b-line))
                col = mix(col, pal['wound_core']+fine[:, None]*2, focus)
                streak = smooth(.02,.42,clots)*smooth(-.2,.5,a)
                col = mix(col,pal['blood_edge'],streak*.7)

        elif kind == 'horn':
            col = np.broadcast_to(pal['horn'], (len(a),3)).copy()+fine[:, None]*9
            line = .13*np.sin(a*9+seed)+.07*np.sin(a*21)
            crack = smooth(.17,.045,np.abs(b-line))*smooth(.97,.55,np.abs(a))
            col = mix(col, pal['split'], crack)
            chip = smooth(.35,.08,np.sqrt((a+.35)**2+(b-.23)**2))
            col = mix(col, pal['bone_shadow'], chip*.85)

        elif kind == 'harvest':
            muscle = waves(u*.45,v*2.7,seed+8,2)*.7+fine*.3
            col = np.broadcast_to(pal['meat'], (len(a),3)).copy()+muscle[:, None]*np.array([19,10,11])
            recess = smooth(.46,.1,r)*(.45+.2*macro)
            col = mix(col, pal['opening'], recess)
            # Rolled hide only where it was cut; fascia in short broken pieces,
            # never an ivory outline enclosing the meat.
            lip = smooth(.62,.80,r)*(1-smooth(.92,1,r))
            col = mix(col,pal['hide_lip']+grain[:,None]*8,lip*.90)
            skin = smooth(.84,.96,r)*smooth(-.1,.35,macro)*smooth(-.4,.3,b)
            col = mix(col,pal['skin']+grain[:,None]*10,skin*.75)
            fascia = smooth(.035,.009,np.abs(r-.73))*smooth(.05,.7,macro)*smooth(-.1,.5,b)
            col = mix(col,pal['fascia'],fascia*.7)
            bones = mark.get('bones')
            if bones == 'ribs':
                # Four oblique ribs with unequal exposed lengths and fleshed ends.
                ribmask = np.zeros_like(a)
                tone = np.zeros_like(a)
                for j, centre in enumerate([-.57,-.20,.17,.53]):
                    curve = centre+.17*b+.10*b*b
                    dd = a-curve
                    rib = smooth(.078,.043,np.abs(dd))*smooth(.67,.34,np.abs(b+.05+j*.035))
                    rib *= smooth(.87,.66,r)
                    take = rib > ribmask
                    tone[take] = smooth(-.065,.06,dd)[take]
                    ribmask = np.maximum(ribmask,rib)
                bone = mix(pal['bone_shadow'],pal['bone'],tone)
                col = mix(col,bone,ribmask*.92)
            elif bones in ('keel','shaft'):
                curve = -.13+.09*np.sin(a*4)
                bone = smooth(.16,.07,np.abs(b-curve))*smooth(.85,.40,np.abs(a))
                col = mix(col,mix(pal['bone_shadow'],pal['bone'],smooth(curve-.13,curve+.10,b)),bone*.9)
            bloom = smooth(.77,.94,r)*smooth(.2,.72,macro)
            col = mix(col,pal['bloom'],bloom*.65)
            arrival = np.maximum(arrival, np.where(bloom>.12, 2.05+0.60*r, 0))

        elif kind == 'plucked':
            col = np.broadcast_to(pal['skin'], (len(a),3)).copy()+fine[:,None]*10
            pores = np.sin(u*1500+seed)*np.sin(v*1300)*.5+.5
            col -= smooth(.80,1,pores)[:,None]*np.array([13,10,9])
            col = mix(col,pal['bloom'],smooth(.45,.8,macro)*smooth(.55,.95,r)*.55)

        elif kind == 'leather':
            col = mix(pal['dry_vein'],pal['dry_skin'],smooth(.04,.82,r))
            col += macro[:,None]*5+fine[:,None]*2
            # Fine open creases follow supply paths and the span's stretch.
            # No loops, light rims or cutouts exposing pale original vessels.
            split = np.zeros_like(a)
            x,z = -self.pos[:,0],self.pos[:,2]
            for path in mark['creases_xz_mm']:
                d = stroke(x,z,path)*(1+.12*fine)
                split = np.maximum(split,1-smooth(.25,1,d))
            if hasattr(self,'vein_distance'):
                split *= .45+.55*smooth(.003,.012,self.vein_distance)
            col = mix(col,pal['split']+fine[:,None]*2,split*.90)

        else:
            raise ValueError(kind)

        # A decay field starts just outside a wound's permanently reserved area.
        # It cannot replace any hurt texel, even a nearly transparent one.
        if layer == 'decay':
            mask &= self.out['hurt']['arrival'] >= 3
        target = self.out[layer]
        take = mask & (arrival < target['arrival'])
        target['arrival'][take] = arrival[take]
        target['rgb'][take] = np.clip(col[take],0,255)
        self.marks.append({'id':mark['id'], 'layer':layer, 'kind':kind,
                           'anchor':anchor, 'size_mm':mark['size'],
                           'reveal_start':mark['reveal'], 'painted_texels':int(take.sum())})

    def vessels(self, network):
        self.network_paths = {path['id']:path for path in network['paths']}
        x, z = -self.pos[:,0], self.pos[:,2]
        d = np.full(len(x),10,np.float32)
        for path in network['paths']:
            guides = path['guides']
            for start,end in zip(guides,guides[1:]):
                dx,dz = end[0]-start[0],end[1]-start[1]
                t = np.clip(((x-start[0])*dx+(z-start[1])*dz)/(dx*dx+dz*dz),0,1)
                dist = np.hypot(x-start[0]-t*dx,z-start[1]-t*dz)
                d = np.minimum(d,dist)
        self.vein_distance=d

    def save(self):
        images = {}
        manifest = {'marks':self.marks,'coverage':{}}
        distance, indices = distance_transform_edt(~self.covered,return_indices=True)
        gutter = (~self.covered)&(distance<=4)
        for layer, field in self.out.items():
            out = np.zeros((N,N,4),np.uint8)
            exists = field['arrival']<3
            alpha = np.where(exists, np.clip(np.rint(255*(1-field['arrival']/3)),1,255),0).astype(np.uint8)
            out[self.iy,self.ix,:3] = np.where(exists[:,None],np.rint(field['rgb']),0).astype(np.uint8)
            out[self.iy,self.ix,3] = alpha
            out[gutter] = out[indices[0][gutter],indices[1][gutter]]
            images[layer] = out
            weights = self.mm**2
            manifest['coverage'][layer] = [round(float(np.sum(weights*smooth(0,.25,s-3*(255-alpha.astype(float))/255))/weights.sum())*100,3) for s in [1,2,3]]
        # Independent nearest-surface dilation must still be strictly disjoint.
        images['decay'][images['hurt'][...,3]>0] = 0
        assert not np.any((images['hurt'][...,3]>0)&(images['decay'][...,3]>0))
        manifest['overlap_texels']=0
        manifest['files']={}
        for layer,out in images.items():
            info = PngImagePlugin.PngInfo()
            info.add(b'sRGB',b'\x00')
            path = TEX / f'{self.name}_{layer}.png'
            Image.fromarray(out).save(path,pnginfo=info,compress_level=9)
            manifest['files'][path.name]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                                         'mode':'RGBA','size':[N,N], 'nonzero_alpha':int((out[...,3]>0).sum()),
                                         'unique_alpha':int(len(np.unique(out[...,3])))}
        return manifest

    def pair_membrane_fringe(self):
        """Remove isolated subtexel fringe fragments missed by the other UV grid.

        The paint itself already shares the physical field. At its alpha-one
        fringe a tiny island can fit between samples of the other face. Remove
        only these unsupported specks; never invent a second independent mark.
        """
        removed = 0
        for field in self.out.values():
            for _ in range(8):
                changes=0
                for src,dst in [('membrane_upper','membrane_under'),('membrane_under','membrane_upper')]:
                    a=np.flatnonzero((self.p==self.ids[src])&(field['arrival']<3))
                    b=np.flatnonzero((self.p==self.ids[dst])&(field['arrival']<3))
                    if not len(a) or not len(b):continue
                    distances,_=cKDTree(self.pos[b][:,[0,2]]).query(self.pos[a][:,[0,2]],workers=1)
                    bad=a[distances>.010]
                    field['arrival'][bad]=4
                    field['rgb'][bad]=0
                    changes+=len(bad)
                removed+=changes
                if not changes:break
        return removed


def main():
    marks = data(HERE/'source/marks.json')
    palette = data(HERE/'source/palette.json')
    network = data(PAINT/'wing/source/network.json')
    read(Path(__file__))
    result = {}
    for key, name in [('body','pteranodon'),('wing','pteranodon_wing')]:
        atlas = Atlas(name)
        if key=='wing':
            atlas.vessels(network)
        for layer in ['hurt','decay']:
            for mark in marks[key]:
                if mark.get('layer','hurt')==layer:
                    atlas.paint(mark,palette)
        fringe=atlas.pair_membrane_fringe() if key=='wing' else 0
        result[name] = atlas.save()
        result[name]['unpaired_fringe_texels_removed']=fringe
        print(name,json.dumps(result[name]['coverage']))
    (HERE/'checks').mkdir(exist_ok=True)
    (HERE/'checks/manifest.json').write_text(json.dumps({'inputs':INPUTS,'materials':result},indent=2)+'\n')


if __name__=='__main__':
    main()
