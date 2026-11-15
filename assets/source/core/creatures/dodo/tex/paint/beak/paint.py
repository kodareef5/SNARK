"""Paint the five beak/mouth islands from accepted horn and bird-space bakes.

Run with python3 -I tex/paint/beak/paint.py. All writes stay beside this script.
Coordinates and relief below are millimetres; no image-space sizing of anatomy.
"""
from pathlib import Path
import hashlib
import json
import site
site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter, map_coordinates
from scipy.interpolate import PchipInterpolator

ROOT = Path(__file__).resolve().parent
PAINT = ROOT.parent
DODO = PAINT.parents[1]
STUDY = DODO/'tex/studies/beak'
BAKES = DODO/'ref/bakes'
N = 2048
HEIGHT_MM = 4.0
NAMES = ['beak', 'jaw', 'beak_palate', 'jaw_floor', 'tongue']

# Measured rest-space section landmarks, checked against the 16-bit bakes.
# y,z of the dorsal and cutting boundaries; width is the half breadth.
UPPER = np.array([
    [598,186,552,186,25], [609,205,548,205,25.5],
    [610.5,224,547,224,25], [610.5,244,546,244,24],
    [608,264,545,264,23], [603,284,545,285,21.5],
    [595,303,544,304,19.5], [582,327,541,313,17.2],
    [560,343,534,319,14.5], [538,349,526,322,11.8],
    [519,346,515,326,8.8], [507,340,506,328,5.8],
], dtype=np.float32)
JAW = np.array([
    [178,548,525,21], [200,547.5,522,21], [230,546.5,521.5,19.2],
    [260,545.5,522.5,17], [285,544.5,524.5,14.6],
    [302,543.5,527.5,11.8], [313,542.5,531,8.8], [320,541.2,534.5,5.6],
], dtype=np.float32)
FEATURES = {
    # Visible skin/sheath junction measured through the position maps. The
    # literal beak island root is inside the head and would hide the rings.
    'skin_edge_yz_mm': [[530,210],[548,214.75],[560,218.875],[572,226.625],
                       [580,229.5],[592,229.9],[604,229.25],[612,228]],
    'first_ring_offset_from_skin_mm': 4.0,
    'ring_offsets_mm': [0.0, 5.796875, 11.59375], 'band_width_mm': 5.796875,
    'band_height_mm': .65, 'channel_depth_mm': .15,
    'nostril_center_xyz_mm': [24, 553, 247],
    'nostril_half_length_mm': 11.5, 'nostril_half_height_mm': 1.5,
    'nostril_depth_mm': 1.2,
    'hook_tip_xyz_mm': [0, 498.5, 333.5],
    'palate_ridge_spacing_mm': 5.4, 'palate_ridge_height_mm': .27,
    'tongue_groove_sigma_mm': 1.1, 'tongue_groove_depth_mm': .24,
    'papillae_diameter_mm': [.35, .65],
}


def linear(a):
    return np.where(a <= .04045, a/12.92, ((a+.055)/1.055)**2.4)


def srgb(a):
    a=np.clip(a,0,1)
    return np.where(a<=.0031308,12.92*a,1.055*a**(1/2.4)-.055)


def smooth(a, b, x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def load_context():
    meta=json.loads((PAINT/'pieces.json').read_text())
    ids=np.asarray(Image.open(PAINT/'pieces.png'))[:,:,0]
    lo=np.array(meta['position_box']['min'],np.float32)*1000
    hi=np.array(meta['position_box']['max'],np.float32)*1000
    p=np.stack([np.asarray(Image.open(PAINT/f'position_{axis}.png'),np.float32)/65535*(hi[k]-lo[k])+lo[k]
                for k,axis in enumerate('xyz')],-1)
    pitch=np.asarray(Image.open(PAINT/'texel_mm.png'),np.float32)/1000
    specs={s['name']:s for s in meta['pieces']}
    return ids,p,pitch,specs


def distance_to_path(points, path):
    """Closest distance and longitudinal fraction on a physical polyline."""
    path=np.asarray(path,np.float32)
    distance=np.full(len(points),np.inf,np.float32)
    along=np.zeros(len(points),np.float32)
    lengths=np.linalg.norm(np.diff(path,axis=0),axis=1)
    cumulative=np.r_[0,np.cumsum(lengths)]
    for i,(a,b) in enumerate(zip(path[:-1],path[1:])):
        v=b-a
        t=np.clip(np.sum((points-a)*v,axis=-1)/np.dot(v,v),0,1)
        d=np.sum((points-(a+t[:,None]*v))**2,axis=-1)
        closer=d<distance
        along=np.where(closer,(cumulative[i]+t*lengths[i])/cumulative[-1],along)
        distance=np.minimum(distance,d)
    return np.sqrt(distance),along


def sample_tile(tile, u_mm, v_mm, pitch, tile_mm=256):
    """Periodic physical sampling, with continuous mip filtering by texel size."""
    coords=np.stack((v_mm*N/tile_mm,u_mm*N/tile_mm))
    lod=np.clip(np.log2(np.maximum(pitch/(tile_mm/N),1)),0,4)
    out=np.zeros(len(pitch),np.float32)
    for level in range(5):
        weight=np.maximum(1-np.abs(lod-level),0)
        take=weight>0
        if not take.any(): continue
        sigma=.5*np.sqrt(4**level-1)
        field=gaussian_filter(tile,sigma,mode='wrap') if level else tile
        out[take]+=weight[take]*map_coordinates(field,coords[:,take],order=1,mode='grid-wrap',prefilter=False)
    return out


def horn_material():
    b=linear(np.asarray(Image.open(STUDY/'horn_base.png'),np.float32)[:,:,0]/255)
    h=np.asarray(Image.open(STUDY/'horn_height.png'),np.float32)/65535*.8-.45
    r=np.asarray(Image.open(STUDY/'horn_packed.png'),np.float32)[:,:,1]/255
    return b,h,r


def scratch(points, pitch, controls, depth, width):
    t=np.linspace(0,1,65,dtype=np.float32)[:,None]
    a,c,b=np.asarray(controls,np.float32)
    curve=(1-t)**2*a+2*(1-t)*t*c+t*t*b
    distance,along=distance_to_path(points,curve)
    taper=np.maximum(np.sin(np.pi*along),0)**.7
    sigma=width*(.35+.65*taper)
    filtered=np.sqrt(sigma*sigma+(.40*pitch)**2)
    q=distance/filtered
    groove=depth*np.exp(-.5*q*q)*taper*sigma/filtered
    lip=.008*np.exp(-.5*((q-2)/.6)**2)*taper*sigma/filtered
    return groove,lip


def horn_piece(name, p, pitch, tiles):
    x=p[:,0]; y=p[:,1]; z=p[:,2]
    # Growth runs forward and bends down the hook. Cross-grain position follows
    # the side and rounded shoulder; the x² term is even at the mirror seam.
    u=z-186+.65*np.maximum(560-y,0)*smooth(305,330,z)
    v=610-y+.30*x*x/25
    base=sample_tile(tiles[0],u+23,v+47,pitch)
    micro=sample_tile(tiles[1],u+23,v+47,pitch)
    rough=sample_tile(tiles[2],u+23,v+47,pitch)
    root_calm=smooth(186,196,z) if name=='beak' else smooth(178,190,z)
    base=.5+(base-.5)*root_calm
    micro*=root_calm
    if name=='beak':
        dorsal=np.vstack((UPPER[:,:2],[[498.5,333.5]]))
        dorsal_distance,progress=distance_to_path(p[:,1:],dorsal)
        edge_path=np.column_stack((UPPER[:,4]*.80,UPPER[:,2:4]))
        edge_path=np.vstack((edge_path,[[0,498.5,333.5]]))
        edge_distance,_=distance_to_path(np.column_stack((x,y,z)),edge_path)
        curved_polish=.96*np.exp(-(dorsal_distance/16)**2)*smooth(.50,.83,progress)
        tip_polish=.96*(1-smooth(510,532,y))*smooth(315,330,z)
        edge_polish=.43*np.exp(-(edge_distance/1.10)**2)*root_calm
        wear=np.clip(np.maximum(curved_polish,tip_polish)+edge_polish,0,1)
    else:
        edge_path=np.column_stack((JAW[:,3]*.84,JAW[:,1],JAW[:,0]))
        edge_path=np.vstack((edge_path,[[0,538,324.5]]))
        edge_distance,_=distance_to_path(np.column_stack((x,y,z)),edge_path)
        tip_distance=np.linalg.norm(p-np.array([0,538,324.5]),axis=-1)
        wear=np.clip(.44*np.exp(-(edge_distance/1.15)**2)+.32*np.exp(-(tip_distance/5)**2),0,.8)*root_calm
    h=1.7+micro*(1-.55*wear)
    base=.5+(base-.5)*(1-.12*wear)+.43*wear
    rough-=.205*wear
    # A second sample contributes only crater concavities, concentrated near the
    # root and hook. Its value stays coupled to those pits, not to broad form.
    extra_h=sample_tile(tiles[1],u+99,v+118,pitch)
    extra_b=sample_tile(tiles[0],u+99,v+118,pitch)
    concentration=(.55*(1-smooth(224,252,z))+.7*smooth(303,333,z))*root_calm
    pits=np.maximum(-extra_h-.035,0)*concentration
    h-=pits*(1-.35*wear)
    base-=np.maximum(.49-extra_b,0)*smooth(.008,.035,pits)
    rough+=pits*.16
    bands=np.zeros_like(x); channels=np.zeros_like(x); nostril=np.zeros_like(x)
    scratches=np.zeros_like(x)
    if name=='beak':
        ridge=np.exp(-.5*(x/1.5)**2)*np.exp(-.5*(dorsal_distance/4)**2)*root_calm
        h+=.16*ridge
        skin=np.array(FEATURES['skin_edge_yz_mm'])
        skin_edge=PchipInterpolator(skin[:,0],skin[:,1])(np.clip(y,skin[0,0],skin[-1,0]))
        ring_start=skin_edge+FEATURES['first_ring_offset_from_skin_mm']
        for offset in FEATURES['ring_offsets_mm']:
            d=z-(ring_start+offset)
            roll=np.maximum(np.sin(np.pi*np.clip(d/5.796875,0,1)),0)
            band=roll**1.8; crest=roll**6
            wall=np.clip((np.abs(d)-.1640625)/.287109375,0,1)
            floor=1-wall*wall*(3-2*wall)
            sigma=np.sqrt(.095703125**2+(.4*pitch)**2)
            dirt=np.exp(-.5*(d/sigma)**2)*.095703125/sigma
            h+=.65*band-.15*floor
            base+=.060*band+.030*crest-.060*dirt
            rough+=.030*floor-.022*crest
            bands=np.maximum(bands,band); channels=np.maximum(channels,floor)
        # Low lateral opening: the gate prevents a slit appearing on the crest
        # or inside the hook. Reflecting the half creates the other nostril.
        q=np.sqrt(((z-247)/11.5)**2+((y-553+.06*(z-247))/1.5)**2)
        lateral=smooth(12,20,x)
        nostril=(.5-.5*np.tanh((q-.80)/.18))*lateral
        rim=np.exp(-((q-1.10)/.24)**2)*lateral
        h+=-1.20*nostril+.085*rim
        base-=.18*nostril
        rough+=.12*nostril-.018*rim
        for controls,depth,width in [([[584,251],[578,257],[572,265]],.070,.100),
                                      ([[573,277],[568,274],[562,267]],.055,.085),
                                      ([[565,305],[555,309],[548,311]],.050,.080)]:
            incision,lip=scratch(p[:,1:],pitch,controls,depth,width)
            incision*=lateral; lip*=lateral
            h+=-incision+lip; base+=-.42*incision+2*lip; rough+=.14*incision
            scratches+=incision
    return base,h,np.clip(rough,.235,.62),{'wear':wear,'bands':bands,'channels':channels,'nostril':nostril,'scratches':scratches}


def tissue_noise(p, pitch, seed, sigma_mm):
    # Fixed 64 mm square at four samples/mm; smooth sampling by local density.
    rng=np.random.default_rng(seed)
    tile=gaussian_filter(rng.standard_normal((256,256)).astype(np.float32),sigma_mm*4,mode='wrap')
    tile/=max(tile.std(),1e-8)
    coords=np.stack((p[:,2]*4,np.sqrt(p[:,0]**2+.25**2)*4))
    sigma_extra=max(float(np.median(pitch))*.4*4,0)
    tile=gaussian_filter(tile,sigma_extra,mode='wrap')
    return map_coordinates(tile,coords,order=1,mode='grid-wrap',prefilter=False)


def mouth_piece(name,p,pitch):
    x=p[:,0]; z=p[:,2]
    pigment=tissue_noise(p,pitch,481,.9)
    micro=tissue_noise(p,pitch,924,.13)
    colors={'beak_palate':[137,111,114],'jaw_floor':[144,117,120],'tongue':[177,137,143]}
    base=np.broadcast_to(linear(np.array(colors[name],np.float32)/255),(len(p),3)).copy()
    base+=pigment[:,None]*np.array([.008,.005,.005])
    h=np.full(len(p),1.7,np.float32)
    if name=='beak_palate':
        phase=(z-192+.006*x*x)/5.4
        d=(phase-np.floor(phase+.5))*5.4
        gate=smooth(187,197,z)*(1-smooth(303,319,z))
        width=.80*np.interp(z,UPPER[:,3],UPPER[:,4])
        gate*=smooth(0,2.5,width-x)
        ridge=np.exp(-.5*(d/.68)**2)*gate
        valley=np.exp(-.5*((np.abs(d)-1.65)/.43)**2)*gate
        h+=.27*ridge+.008*micro
        base+=.015*ridge[:,None]-.007*valley[:,None]
        rough=.29+.015*pigment-.015*ridge
    elif name=='jaw_floor':
        h+=.006*micro
        rough=.265+.010*pigment
    else:
        top=smooth(543.5,546.5,p[:,1])
        gate=smooth(193,202,z)*(1-smooth(265,277,z))
        groove=np.exp(-.5*(x/1.1)**2)*gate*top
        h+=.022*micro-.24*groove
        base-=groove[:,None]*np.array([.060,.047,.047])
        base+=micro[:,None]*.003
        rough=.325+.018*micro-.020*groove
    return np.clip(base,.03,.8),h,np.clip(rough,.20,.38)


def fine_occlusion(height,pitch,ids,own):
    """Eight undirected height horizons. No baked form occlusion here."""
    occ=np.zeros_like(height)
    for dy,dx in [(0,1),(0,-1),(1,0),(-1,0),(1,1),(1,-1),(-1,1),(-1,-1)]:
        horizon=np.zeros_like(height)
        for radius in [1,2,4,8,16]:
            other=np.roll(height,(-dy*radius,-dx*radius),(0,1))
            same=np.roll(ids,(-dy*radius,-dx*radius),(0,1))==ids
            slope=np.maximum(other-height-.004,0)/np.maximum(radius*pitch*np.hypot(dx,dy),.001)
            horizon=np.maximum(horizon,np.where(same,slope/np.sqrt(1+slope*slope),0))
        occ+=horizon/8
    return np.where(own,np.clip(1-.58*occ,.48,1),0)


def save(path, data, color=False, sixteen=False):
    info=PngImagePlugin.PngInfo()
    info.add(b'gAMA',(45455 if color else 100000).to_bytes(4,'big'))
    if color: info.add(b'sRGB',b'\x00')
    if data.dtype!=np.uint8:
        maximum=65535 if sixteen else 255
        data=np.clip(np.rint(data*maximum),0,maximum).astype(np.uint16 if sixteen else np.uint8)
    Image.fromarray(data).save(path,pnginfo=info)


def main():
    out=ROOT/'layers'; out.mkdir(exist_ok=True)
    ids,p,pitch,specs=load_context()
    own=np.isin(ids,[specs[n]['number'] for n in NAMES])
    horn=np.isin(ids,[specs[n]['number'] for n in ['beak','jaw']])
    base=np.zeros((N,N,3),np.float32); h=np.zeros((N,N),np.float32); rough=np.zeros_like(h)
    tiles=horn_material(); masks={k:np.zeros_like(h) for k in ['wear','bands','channels','nostril','scratches']}
    for name in NAMES:
        m=ids==specs[name]['number']
        if name in ['beak','jaw']:
            value,height,r,semantic=horn_piece(name,p[m],pitch[m],tiles)
            base[m]=value[:,None]
            for k,v in semantic.items(): masks[k][m]=v
        else:
            value,height,r=mouth_piece(name,p[m],pitch[m]); base[m]=value
        h[m]=height; rough[m]=r
    # Only a global value correction. The pale hook remains intrinsic wear;
    # no spatial balancing or form-shaped compensation is introduced.
    for _ in range(4):
        base[horn]+= .5-float(base[horn].mean())
        base[horn]=np.clip(base[horn],.035,.98)
    assert h[own].min()>0 and h[own].max()<HEIGHT_MM
    occlusion=fine_occlusion(h,pitch,ids,own)
    encoded=np.uint8(np.rint(srgb(base)*255))
    save(out/'dodo_base.png',np.dstack((encoded,np.uint8(own)*255)),color=True)
    save(out/'dodo_height.png',h/HEIGHT_MM,sixteen=True)
    save(out/'dodo_rough.png',rough)
    save(out/'dodo_occlusion.png',occlusion)
    regions=np.asarray(Image.open(BAKES/'dodo_regions.png').convert('RGB')).copy()
    regions[~own]=0; save(out/'dodo_regions.png',regions)
    for name,m in masks.items():
        save(out/f'{name}_mask.png',np.clip(m/(.15 if name=='scratches' else 1),0,1))
    source_paths=[STUDY/'horn_base.png',STUDY/'horn_height.png',STUDY/'horn_packed.png']
    meta={'group':'beak','height_mm':HEIGHT_MM,'pieces':NAMES,'features':FEATURES,
          'coordinate_units':'millimetres in corrected left-side rest-space bakes; x is positive outward',
          'study_inputs':{str(f.relative_to(DODO)):hashlib.sha256(f.read_bytes()).hexdigest() for f in source_paths},
          'mean_region_2_linear':float(linear(encoded[horn].astype(np.float32)/255).mean()),
          'texels':{n:int(np.count_nonzero(ids==specs[n]['number'])) for n in NAMES},
          'notes':['Fine AO only; compose.py supplies form AO and physical normals.',
                   'Horn sampled at 256 mm per tile with filtering by local texel size.',
                   'Mouth colors are intrinsic and undyed; papillae are filtered at the coarse tongue density.']}
    (out/'layers.json').write_text(json.dumps(meta,indent=2)+'\n')
    print(json.dumps({'painted_texels':int(own.sum()),'region_2_mean':meta['mean_region_2_linear'],
                      'height_used_mm':[float(h[own].min()),float(h[own].max())]},indent=2))


if __name__=='__main__':
    main()
