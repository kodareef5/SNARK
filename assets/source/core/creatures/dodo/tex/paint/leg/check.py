#!/usr/bin/env python3
"""Check delivered leg layers and preview the composed maps using baked positions.

Run compose.py --out tex/paint/leg/checks/composed first. Point-splat views use
the actual baked surface positions and normals, not an invented foot proxy.
"""
from pathlib import Path
import hashlib
import json
import sys
sys.dont_write_bytecode=True
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import binary_erosion, distance_transform_edt
from scipy.spatial import cKDTree
import paint

HERE=Path(__file__).resolve().parent
OUT=HERE/'checks'
COMPOSED=OUT/'composed'
COLOURS={'ochre':'c49c58','slate':'65686f','olive':'867f4e','orange':'b0602c',
         'pink':'ed20a6','lime':'96e31d','near black':'171918','near white':'e9e8e4'}


def unit(x):
    return x/np.maximum(np.linalg.norm(x,axis=-1,keepdims=True),1e-10)


def font(size=15):
    for path in ['/System/Library/Fonts/Helvetica.ttc',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if Path(path).exists():return ImageFont.truetype(path,size)
    return ImageFont.load_default()


def label(im,text,xy=(10,8),size=15):
    ImageDraw.Draw(im).text(xy,text,font=font(size),fill=(36,36,33))


def load_material():
    meta,ids,p,regions,mm=paint.load_bakes()
    numbers={x['name']:x['number'] for x in meta['pieces']}
    own=np.isin(ids,[numbers[n] for n in paint.NAMES])
    base=paint.lin(np.asarray(Image.open(COMPOSED/'dodo_base.png').convert('RGB'),np.float32)/255)
    normal=np.asarray(Image.open(COMPOSED/'dodo_normal.png').convert('RGB'),np.float32)/127.5-1
    packed=np.asarray(Image.open(COMPOSED/'dodo_packed.png').convert('RGB'),np.float32)/255
    obj=unit(np.asarray(Image.open(paint.DODO/'ref/bakes/dodo_normal_object.png').convert('RGB'),np.float32)/127.5-1)
    def derivative(axis):
        f=np.roll(p,-1,axis); b=np.roll(p,1,axis)
        good_f=(np.roll(ids,-1,axis)==ids)[:,:,None]
        good_b=(np.roll(ids,1,axis)==ids)[:,:,None]
        return np.where(good_f & good_b,(f-b)/2,np.where(good_f,f-p,np.where(good_b,p-b,0)))
    dx=derivative(1); dy=-derivative(0)
    tangent=unit(dx-obj*np.sum(dx*obj,axis=2)[:,:,None])
    bitangent=unit(np.cross(obj,tangent))
    sign=np.where(np.sum(bitangent*dy,axis=2)>=0,1,-1)
    bitangent*=sign[:,:,None]
    bumped=unit(tangent*normal[:,:,0,None]+bitangent*normal[:,:,1,None]+obj*normal[:,:,2,None])
    return dict(meta=meta,ids=ids,p=p,regions=regions,mm=mm,own=own,base=base,
                packed=packed,n=bumped,obj=obj,numbers=numbers)


def dyed(data,dye):
    rgb=data['base'].copy()
    colour=paint.lin(np.array([int(COLOURS[dye][i:i+2],16) for i in (0,2,4)])/255)
    cyan=data['own'] & (data['regions'][:,:,1]==255)
    rgb[cyan]*=colour/.5
    return rgb


def render(data,view=(.8,.35,1.),ppm=3000,dye='ochre',pair=False,
           ymax=.101,light=(.5,.8,.7),unlit=False):
    m=data['own'] & (data['p'][:,:,1]<=ymax)
    p=data['p'][m].copy(); n=data['n'][m].copy(); obj=data['obj'][m].copy()
    rgb=dyed(data,dye)[m]; ao=data['packed'][m,0]; rough=data['packed'][m,1]
    if pair:
        # Display the second foot using the model's shared-UV symmetry. This
        # duplicates a preview foot; it does not correct the input bakes.
        mirrored=p.copy();mirrored[:,0]*=-1
        mn=n.copy();mn[:,0]*=-1
        mo=obj.copy();mo[:,0]*=-1
        p=np.r_[p,mirrored];n=np.r_[n,mn];obj=np.r_[obj,mo]
        rgb=np.r_[rgb,rgb];ao=np.r_[ao,ao];rough=np.r_[rough,rough]
    view=unit(np.array(view,float)); right=unit(np.cross([0,1,0],view)); up=unit(np.cross(view,right))
    facing=np.sum(obj*view,axis=1)>-.08
    p,n,rgb,ao,rough=[a[facing] for a in [p,n,rgb,ao,rough]]
    lx=unit(np.array(light,float)); half=unit(lx+view)
    diffuse=.38+.62*np.maximum(np.sum(n*lx,axis=1),0)
    power=np.clip(2/np.maximum(rough,.15)**2-2,2,90)
    spec=.035*(power+2)/8*np.maximum(np.sum(n*half,axis=1),0)**power
    colour=rgb if unlit else rgb*diffuse[:,None]*ao[:,None]+spec[:,None]
    colour=np.uint8(np.rint(paint.srgb(colour)*255))
    x=np.sum(p*right,axis=1)*ppm; y=-np.sum(p*up,axis=1)*ppm; z=np.sum(p*view,axis=1)
    margin=12
    x-=x.min()-margin;y-=y.min()-margin
    w=int(np.ceil(x.max()))+margin;h=int(np.ceil(y.max()))+margin
    # Draw far to near into four nearest screen pixels. Half-millimetre UV
    # sampling supports these views; this is a texture inspection, no remeshing.
    order=np.argsort(z,kind='stable');x=x[order];y=y[order];z=z[order];colour=colour[order]
    image=np.full((h*w,3),[215,214,207],np.uint8)
    depth=np.full(h*w,-np.inf)
    radius=max(1,int(np.ceil(ppm*.00024)))
    for oy in range(-radius+1,radius+1):
        for ox in range(-radius+1,radius+1):
            xx=np.floor(x).astype(int)+ox; yy=np.floor(y).astype(int)+oy
            ok=(xx>=0)&(xx<w)&(yy>=0)&(yy<h)
            target=yy[ok]*w+xx[ok]
            # Last sorted point for each pixel is the nearest one.
            _,reverse=np.unique(target[::-1],return_index=True)
            indices=np.flatnonzero(ok)[len(target)-1-reverse]
            dest=yy[indices]*w+xx[indices]
            take=z[indices]>depth[dest]
            dest=dest[take];indices=indices[take]
            depth[dest]=z[indices];image[dest]=colour[indices]
    return Image.fromarray(image.reshape(h,w,3))


def montage(images,labels,columns=3,pad=16):
    w=max(im.width for im in images)+pad*2
    h=max(im.height for im in images)+pad*2+25
    out=Image.new('RGB',(w*columns,h*((len(images)+columns-1)//columns)),(240,239,234))
    for i,(im,title) in enumerate(zip(images,labels)):
        x=(i%columns)*w; y=(i//columns)*h
        label(out,title,(x+pad,y+9))
        out.paste(im,(x+(w-im.width)//2,y+35))
    return out


def validation(data):
    own=data['own'];regions=data['regions'];ids=data['ids'];p=data['p']
    base=np.asarray(Image.open(HERE/'layers/dodo_base.png'))
    h=np.asarray(Image.open(HERE/'layers/dodo_height.png'),np.float32)/65535*paint.HEIGHT_MM
    rough=np.asarray(Image.open(HERE/'layers/dodo_rough.png'))/255
    occl=np.asarray(Image.open(HERE/'layers/dodo_occlusion.png'))/255
    rg=np.asarray(Image.open(HERE/'layers/dodo_regions.png'))
    lum=paint.lin(base[:,:,:3]/255).mean(axis=2)
    cyan=own & (regions[:,:,1]==255)
    failures=[]
    if not (base[own,3]==255).all() or (base[~own]!=0).any():failures.append('Ownership/coverage')
    if not (rg[own]==regions[own]).all() or rg[~own].any():failures.append('Region fidelity')
    if not (base[cyan,0]==base[cyan,1]).all() or not (base[cyan,0]==base[cyan,2]).all():failures.append('Neutrality')
    if abs(lum[cyan].mean()-.5)>.02:failures.append('Mean grey')
    for name in ['dodo_base','dodo_height','dodo_rough','dodo_occlusion','dodo_regions']:
        im=Image.open(HERE/'layers'/f'{name}.png')
        if im.size!=(2048,2048):failures.append(name+' size')
    header=(HERE/'layers/dodo_height.png').read_bytes()
    if header[24]!=16 or header[25]!=0:failures.append('Height bit depth')
    pieces=[]
    for name in paint.NAMES:
        m=ids==data['numbers'][name];dy=m&cyan;black=m&~cyan
        entry=dict(name=name,texels=int(m.sum()),linear_mean_cyan=float(lum[dy].mean()),
                   height_mm=[float(h[m].min()),float(h[m].max())],roughness=float(rough[m].mean()))
        if black.any():
            t,_,_,_,_=paint.toe_coordinates(p[black],name)
            entry['claw_root_rgb']=base[black,:3][t<.99].mean(axis=0).tolist()
            entry['claw_tip_rgb']=base[black,:3][t>1.16].mean(axis=0).tolist()
        edge=m&~binary_erosion(m)
        yy,xx=np.nonzero(edge);pp=p[edge];nn=data['obj'][edge]
        dist,index=cKDTree(pp).query(pp,k=12)
        a=np.arange(len(pp))[:,None]
        valid=(dist<.001)&(np.abs(yy[:,None]-yy[index])+np.abs(xx[:,None]-xx[index])>20)
        valid&=(nn[:,None,:]*nn[index]).sum(axis=2)>.8
        aa=np.broadcast_to(a,index.shape)[valid];bb=index[valid]
        if len(aa):
            entry['boundary_pairs_within_1mm']=len(aa)
            entry['boundary_neighbour_base_delta_p95']=float(np.percentile(np.abs(lum[edge][aa]-lum[edge][bb]),95))
            entry['boundary_neighbour_height_delta_mm_p95']=float(np.percentile(np.abs(h[edge][aa]-h[edge][bb]),95))
        pieces.append(entry)
    report=dict(passed=not failures,failures=failures,owned_texels=int(own.sum()),cyan_texels=int(cyan.sum()),
                claw_texels=int((own&~cyan).sum()),cyan_linear_mean=float(lum[cyan].mean()),
                height_mm=paint.HEIGHT_MM,pieces=pieces,
                output_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((HERE/'layers').glob('*'))})
    (OUT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ['output_sha256','pieces']},indent=2),flush=True)
    if failures:raise SystemExit('Validation failed')


def main():
    OUT.mkdir(exist_ok=True)
    data=load_material()
    validation(data)
    # Show each island at original atlas resolution; no pretty-up rescaling.
    crops=[];titles=[]; flat=dyed(data,'ochre')
    for rec in data['meta']['pieces']:
        if rec['name'] not in paint.NAMES:continue
        x0,y0,x1,y1=rec['box'];m=data['ids'][y0:y1,x0:x1]==rec['number']
        rgb=np.uint8(np.rint(paint.srgb(flat[y0:y1,x0:x1])*255))
        rgb[~m]=[230,229,222]
        crops.append(Image.fromarray(rgb));titles.append(rec['name']+' | unlit 1:1')
    montage(crops,titles,5).save(OUT/'islands_ochre.png')
    views=[(0,.10,1),(1,.12,0),(0,.10,-1),(.8,.42,1)]
    names=['Front','Outer side','Back','Three-quarter']
    images=[render(data,v,ppm=3300) for v in views]
    montage(images,names,2).save(OUT/'foot_views.png')
    render(data,(.8,.4,1),ppm=4200).save(OUT/'foot_ochre.png')
    render(data,(.1,-1,.35),ppm=3800,ymax=.026,light=(.5,-.8,.7)).save(OUT/'soles.png')
    ims=[render(data,(.8,.4,1),ppm=2300,dye=colour) for colour in COLOURS]
    montage(ims,list(COLOURS),4).save(OUT/'dyes.png')
    ims=[render(data,(.8,.4,1),ppm=2600,light=light) for light in [(1,.8,.5),(-.9,.3,.5),(.4,.3,-1)]]
    montage(ims,['Upper outside key','Opposite key','Rear key'],3).save(OUT/'relights.png')
    # Both reference and painted views are 1500 pixels/metre, without stretching.
    front=Image.open(paint.DODO/'ref/concept/front.png').convert('RGB').crop((460,978,800,1155))
    side=Image.open(paint.DODO/'ref/concept/side.png').convert('RGB').crop((475,978,750,1155))
    rf=render(data,(0,0,1),ppm=1500,pair=True)
    rs=render(data,(1,0,0),ppm=1500)
    comparison=montage([front,rf,side,rs],['Concept front | 1500 px/m','Painted front | 1500 px/m',
                        'Concept side | 1500 px/m','Painted side | 1500 px/m'],2)
    comparison.save(OUT/'concept_comparison.png')
    sizes=[render(data,(.8,.35,1),ppm=height/.65,pair=True) for height in [975,200,50]]
    montage(sizes,['975 px bird: concept scale','200 px bird','50 px bird'],3).save(OUT/'bird_sizes.png')
    print('Wrote atlas, actual-surface views, dyes, relights and concept-size comparison.',flush=True)


if __name__=='__main__':main()
