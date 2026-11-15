"""Validate the beak layers and review them through the baked positions.

Run after paint.py and compose.py --out tex/paint/beak/checks/composed.
These are orthographic point projections, not a substitute for the game renderer.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import site
site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('beak_paint', ROOT/'paint.py')
paint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(paint)
CHECKS = ROOT/'checks'
COMPOSED = CHECKS/'composed'
REGIONS = [(255,0,0),(0,255,0),(0,0,255),(0,255,255),(255,0,255),(255,255,0)]
DEFAULTS = ['6B737A','D1A292','8B9166','C29533','312D2A','E6E2D6']
DYES = {'olive':'8B9166','pale horn':'BBA27B','slate':'5B6369','charcoal':'313639',
        'umber':'54412E','moss':'5D6A39','oxblood':'723B2B','lime':'91E42D',
        'near white':'E9E6DD','near black':'17191C'}


def normalize(a):
    return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-8)


def dot(a,b):
    # Avoid platform BLAS floating-point-status warnings for skinny matrices.
    return np.sum(a*b,axis=-1)


def rgb(hex_color):
    return paint.linear(np.array([int(hex_color[i:i+2],16) for i in [0,2,4]],np.float32)/255)


def font(size=19):
    for path in ['/System/Library/Fonts/Supplemental/Arial.ttf',
                 '/System/Library/Fonts/Helvetica.ttc']:
        if Path(path).exists(): return ImageFont.truetype(path,size)
    return ImageFont.load_default()


def labeled(im,title):
    out=Image.new('RGB',(im.width,im.height+36),(27,29,29))
    out.paste(im,(0,36)); ImageDraw.Draw(out).text((10,7),title,font=font(),fill=(230,228,220))
    return out


def sheet(images,cols,path):
    w=max(x.width for x in images); h=max(x.height for x in images)
    out=Image.new('RGB',(cols*w,((len(images)+cols-1)//cols)*h),(27,29,29))
    for k,im in enumerate(images): out.paste(im,((k%cols)*w,(k//cols)*h))
    out.save(path)


def validate(ids,p,pitch,specs):
    folder=ROOT/'layers'
    own=np.isin(ids,[specs[n]['number'] for n in paint.NAMES])
    horn=np.isin(ids,[specs[n]['number'] for n in ['beak','jaw']])
    mouth=own&~horn
    assert p[own,0].min()>=-.01, 'Expected corrected left-side positions'
    b=np.asarray(Image.open(folder/'dodo_base.png'))
    h=np.asarray(Image.open(folder/'dodo_height.png'))
    r=np.asarray(Image.open(folder/'dodo_rough.png'))
    ao=np.asarray(Image.open(folder/'dodo_occlusion.png'))
    regions=np.asarray(Image.open(folder/'dodo_regions.png'))
    expected=np.asarray(Image.open(paint.BAKES/'dodo_regions.png').convert('RGB'))
    assert b.shape==(2048,2048,4) and h.shape==r.shape==ao.shape==(2048,2048)
    assert h.dtype==np.uint16 and b.dtype==r.dtype==ao.dtype==np.uint8
    assert np.array_equal(b[:,:,3],own.astype(np.uint8)*255)
    assert not b[~own].any() and not h[~own].any() and not r[~own].any() and not ao[~own].any()
    assert np.array_equal(regions[own],expected[own]) and not regions[~own].any()
    assert (regions[horn]==[0,0,255]).all() and not regions[mouth].any()
    assert (b[horn,0]==b[horn,1]).all() and (b[horn,1]==b[horn,2]).all()
    linear=paint.linear(b[:,:,:3].astype(np.float32)/255)
    mean=float(linear[horn].mean()); assert abs(mean-.5)<.002
    assert h[own].min()>0 and h[own].max()<65535
    assert r[mouth].mean()<r[horn].mean()
    meta=json.loads((folder/'layers.json').read_text())
    for file,sha in meta['study_inputs'].items():
        assert hashlib.sha256((paint.DODO/file).read_bytes()).hexdigest()==sha
    wear=np.asarray(Image.open(folder/'wear_mask.png'),np.float32)/255
    assert linear[horn&(wear>.8)].mean()>linear[horn&(wear<.05)].mean()+.20
    assert r[horn&(wear>.8)].mean()<r[horn&(wear<.05)].mean()-25
    result={'passed':True,'coverage_texels':int(own.sum()),'neutral_rgb':True,
            'mean_blue_linear':mean,'regions_equal_bake':True,'outside_owned_pieces_zero':True,
            'height_mm':paint.HEIGHT_MM,'pieces':{},
            'wear_value_linear':[float(linear[horn&(wear<.05)].mean()),float(linear[horn&(wear>.8)].mean())],
            'wear_roughness':[float(r[horn&(wear<.05)].mean()/255),float(r[horn&(wear>.8)].mean()/255)]}
    for name in paint.NAMES:
        m=ids==specs[name]['number']
        result['pieces'][name]={'texels':int(m.sum()),'median_texel_mm':float(np.median(pitch[m])),
            'height_mm_min_max':[float(h[m].min()/65535*paint.HEIGHT_MM),float(h[m].max()/65535*paint.HEIGHT_MM)],
            'roughness_mean':float(r[m].mean()/255),'fine_ao_mean':float(ao[m].mean()/255),
            'base_srgb_mean':np.mean(b[m,:3],axis=0).tolist()}
    # The compositor owns normal generation. Independently reconstruct from our
    # delivered quantized height to catch a stale compose or a scale mismatch.
    hh=h.astype(np.float32)/65535*paint.HEIGHT_MM
    derivatives=[]
    for axis in [1,0]:
        a=np.roll(hh,-1,axis); c=np.roll(hh,1,axis)
        ok_a=np.roll(ids,-1,axis)==ids; ok_c=np.roll(ids,1,axis)==ids
        d=np.where(ok_a&ok_c,(a-c)*.5,np.where(ok_a,a-hh,np.where(ok_c,hh-c,0)))
        derivatives.append(d/np.maximum(pitch,.001))
    normal=normalize(np.stack((-derivatives[0],derivatives[1],np.ones_like(hh)),-1))[own]
    actual=np.asarray(Image.open(COMPOSED/'dodo_normal.png'),np.float32)[own]/127.5-1
    correlations=[float(np.corrcoef(normal[:,k],actual[:,k])[0,1]) for k in [0,1]]
    assert min(correlations)>.99
    max_error=float(np.max(np.abs(np.linalg.norm(actual,axis=-1)-1)))
    assert max_error<.008
    result['composed_normal_xy_correlation']=correlations
    result['composed_normal_max_unit_error']=max_error
    (CHECKS/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


def source_review(ids,p,pitch,specs):
    """The same 25 mm patch, through source, study and exported bird texture."""
    candidate=(ids==specs['beak']['number'])&(p[:,:,2]>250)&(p[:,:,2]<295)&(p[:,:,1]>550)&(p[:,:,1]<595)&(p[:,:,0]>15)
    ij=np.column_stack(np.nonzero(candidate)); xyz=p[candidate]
    y,z=np.meshgrid(np.linspace(585,560,200),np.linspace(260,285,200),indexing='ij')
    _,nearest=cKDTree(xyz[:,1:]).query(np.column_stack((y.ravel(),z.ravel())))
    yy,xx=ij[nearest].T; q=p[yy,xx]
    u=q[:,2]-163; v=657-q[:,1]+.30*q[:,0]**2/25
    original=np.asarray(Image.open(paint.STUDY/'source/horn_r2b_generated.png').convert('RGB'),np.float32)/255
    period=int(min(original.shape[:2])*.80)
    coords=np.stack((v*period/256,u*period/256))
    raw=np.stack([map_coordinates(original[:,:,k],coords,order=1,mode='wrap') for k in range(3)],-1)
    tile=paint.horn_material()[0]
    study=paint.sample_tile(tile,u,v,np.full(len(u),.125))
    study=paint.srgb(np.repeat(study[:,None],3,-1))
    delivered=np.asarray(Image.open(ROOT/'layers/dodo_base.png'))[yy,xx,:3]/255
    images=[]
    for data,title in [(raw,'Original / same 25 mm fine drawing'),
                       (study,'Accepted horn / 25 mm, unlit'),
                       (delivered,'Painted map / same patch, unlit')]:
        im=Image.fromarray(np.uint8(np.rint(np.clip(data.reshape(200,200,3),0,1)*255)))
        images.append(labeled(im.resize((600,600),Image.Resampling.NEAREST),title))
    sheet(images,3,CHECKS/'source_preservation.png')


class Cloud:
    def __init__(self,ids,p,specs):
        mask=ids>0
        self.ids=ids[mask]; self.p=p[mask].copy(); self.specs=specs
        self.base=paint.linear(np.asarray(Image.open(COMPOSED/'dodo_base.png'),np.float32)[mask]/255)
        self.region=np.asarray(Image.open(COMPOSED/'dodo_regions.png'))[mask]
        packed=np.asarray(Image.open(COMPOSED/'dodo_packed.png'),np.float32)[mask]/255
        self.ao=packed[:,0]; self.rough=packed[:,1]
        obj=np.asarray(Image.open(paint.BAKES/'dodo_normal_object.png'),np.float32)/127.5-1
        # Corrected positions and object normals both describe the +x left half.
        obj=normalize(obj)
        # Tangent directions from the very same baked coordinates. Edges use a
        # one-sided derivative, and no derivative crosses an island boundary.
        def derivative(axis):
            forward=np.roll(p,-1,axis); backward=np.roll(p,1,axis)
            a=np.roll(ids,-1,axis)==ids; b=np.roll(ids,1,axis)==ids
            return np.where((a&b)[:,:,None],(forward-backward)*.5,
                   np.where(a[:,:,None],forward-p,np.where(b[:,:,None],p-backward,0)))
        du=derivative(1)[mask]; dv=-derivative(0)[mask]; n=obj[mask]
        tangent=normalize(du-n*np.sum(du*n,-1,keepdims=True))
        bitangent=normalize(np.cross(n,tangent))
        bitangent*=np.where(np.sum(bitangent*dv,-1,keepdims=True)<0,-1,1)
        detail=np.asarray(Image.open(COMPOSED/'dodo_normal.png'),np.float32)[mask]/127.5-1
        self.n=normalize(tangent*detail[:,0:1]+bitangent*detail[:,1:2]+n*detail[:,2:3])
        self.form_n=n
        self.own=np.isin(self.ids,[specs[name]['number'] for name in paint.NAMES])
        self.horn=np.isin(self.ids,[specs[name]['number'] for name in ['beak','jaw']])
        self.mouth=self.own&~self.horn
        self.moving=np.isin(self.ids,[specs[name]['number'] for name in ['jaw','jaw_floor','tongue']])
        self.fine=np.asarray(Image.open(ROOT/'layers/dodo_occlusion.png'),np.float32)[mask]/255

    def dyed(self,dye):
        a=self.base.copy()
        for i,color in enumerate(DEFAULTS):
            m=np.all(self.region==REGIONS[i],-1)
            a[m]*=rgb(DYES[dye] if i==2 else color)/.5
        return a

    def render(self,camera=(-1,0,0),dye='olive',size=(800,600),bounds=None,
               only=None,unlit=False,open_mouth=False,light=(.6,.7,.6),mirror=True):
        view=normalize(np.array(camera,np.float32))
        right=normalize(np.cross([0,1,0],view)); up=normalize(np.cross(view,right))
        if only=='beak': select=self.own
        elif only=='mouth': select=self.mouth
        else: select=np.ones(len(self.ids),bool)
        pos=self.p[select].copy(); normal=self.n[select].copy(); form=self.form_n[select].copy()
        color=self.dyed(dye)[select]; rough=self.rough[select]; ao=self.ao[select].copy()
        if open_mouth:
            a=np.deg2rad(38); c=np.cos(a); s=np.sin(a)
            rot=np.array([[1,0,0],[0,c,-s],[0,s,c]],np.float32)
            move=self.moving[select]
            hinge=np.array([0,548,195],np.float32)
            pos[move]=np.einsum('ij,kj->ik',pos[move]-hinge,rot)+hinge
            normal[move]=np.einsum('ij,kj->ik',normal[move],rot)
            form[move]=np.einsum('ij,kj->ik',form[move],rot)
            # Rest-pose form AO cannot describe an opened mouth; only intrinsic
            # material AO is meaningful on these articulated review surfaces.
            take=self.own[select]; ao[take]=self.fine[select][take]
        if mirror:
            flip=np.array([-1,1,1],np.float32)
            pos=np.concatenate((pos,pos*flip)); normal=np.concatenate((normal,normal*flip))
            form=np.concatenate((form,form*flip))
            color=np.tile(color,(2,1)); rough=np.tile(rough,2); ao=np.tile(ao,2)
        screen=np.column_stack((dot(pos,right),dot(pos,up))); depth=dot(pos,view)
        if bounds is None:
            lo=screen.min(0)-5; hi=screen.max(0)+5
        else: lo=np.array(bounds[:2]); hi=np.array(bounds[2:])
        w,h=size; scale=min((w-12)/(hi[0]-lo[0]),(h-12)/(hi[1]-lo[1]))
        center=(lo+hi)*.5
        sx=np.rint((screen[:,0]-center[0])*scale+w/2).astype(np.int32)
        sy=np.rint(h/2-(screen[:,1]-center[1])*scale).astype(np.int32)
        keep=(sx>=1)&(sx<w-1)&(sy>=1)&(sy<h-1)&(dot(form,view)>-.1)
        ix=np.flatnonzero(keep); cell=sy[keep]*w+sx[keep]
        # Three-pixel splats close the gaps between samples BEFORE resolving
        # visibility, so hidden palate samples cannot shine through the horn.
        zbuf=np.full(w*h,-np.inf,np.float32)
        for offset in [-w-1,-w,-w+1,-1,0,1,w-1,w,w+1]:
            np.maximum.at(zbuf,cell+offset,depth[keep])
        winners=np.full(w*h,-1,np.int32)
        for offset in [-w-1,-w,-w+1,-1,0,1,w-1,w,w+1]:
            visible=depth[keep]>=zbuf[cell+offset]-1e-5
            winners[cell[visible]+offset]=ix[visible]
        cover=winners.reshape(h,w)>=0
        dist,near=distance_transform_edt(~cover,return_indices=True)
        winners=winners.reshape(h,w)[tuple(near)]; cover=dist<=1.45
        if only=='visible_beak':
            owned=np.tile(self.own,2) if mirror else self.own
            cover &= owned[winners]
        selected=winners[cover]
        c=color[selected]
        if not unlit:
            n=normal[selected]; r=rough[selected]; a=ao[selected]
            l=normalize(right*light[0]+up*light[1]+view*light[2])
            fill=normalize(right*.6+up*.15+view*.7)
            nl=np.maximum(dot(n,l),0); nf=np.maximum(dot(n,fill),0); nv=np.maximum(dot(n,view),.001)
            half=normalize(l+view); nh=np.maximum(dot(n,half),0)
            alpha=np.maximum(r*r,.02); a2=alpha*alpha
            D=a2/(np.pi*np.maximum((nh*nh*(a2-1)+1)**2,1e-7))
            k=(r+1)**2/8
            g=(nl/(nl*(1-k)+k))*(nv/(nv*(1-k)+k))
            fresnel=.04+.96*(1-max(float(dot(view,half)),0))**5
            spec=D*g*fresnel/np.maximum(4*nl*nv,.001)*nl
            c=c*(.29+.70*nl[:,None]+.18*nf[:,None])*(.55+.45*a[:,None])+spec[:,None]*.75
        out=np.empty((h,w,3),np.uint8); out[:]=[213,212,204]
        out[cover]=np.uint8(np.rint(paint.srgb(c)*255))
        return Image.fromarray(out)


def main():
    CHECKS.mkdir(exist_ok=True)
    ids,p,pitch,specs=paint.load_context()
    result=validate(ids,p,pitch,specs)
    source_review(ids,p,pitch,specs)
    cloud=Cloud(ids,p,specs)
    # Exact own UV pixels, then a material review at each piece's native density.
    base=np.asarray(Image.open(ROOT/'layers/dodo_base.png'))
    layout=np.full((2048,2048,3),34,np.uint8)
    own=base[:,:,3]>0
    dyefull=paint.linear(base[:,:,:3].astype(np.float32)/255)
    horn=np.isin(ids,[specs[x]['number'] for x in ['beak','jaw']])
    dyefull[horn]*=rgb(DYES['olive'])/.5
    layout[own]=np.uint8(np.rint(paint.srgb(dyefull[own])*255))
    im=Image.fromarray(layout); draw=ImageDraw.Draw(im)
    for name in paint.NAMES:
        yy,xx=np.nonzero(ids==specs[name]['number'])
        draw.text((int(xx.min()),max(0,int(yy.min())-25)),name,font=font(23),fill=(238,234,225))
    im.save(CHECKS/'layout.png')
    sheet([labeled(cloud.render(camera=(-1,0,0),size=(700,760)),'Side / composed opaque surfaces'),
           labeled(cloud.render(camera=(0,0,1),size=(700,760)),'Front / mirrored half'),
           labeled(cloud.render(camera=(0,0,-1),size=(700,760)),'Back / mirrored half')],3,CHECKS/'views.png')
    # Camera coordinates for left profile: right = +z. Face is on the left.
    bounds=(177,490,355,615)
    sheet([labeled(cloud.render(size=(850,610),bounds=bounds,only='visible_beak',unlit=True),'Olive / unlit base'),
           labeled(cloud.render(size=(850,610),bounds=bounds,only='visible_beak'),'Olive / upper front light'),
           labeled(cloud.render(size=(850,610),bounds=bounds,only='visible_beak',light=(-.7,-.3,.5)),'Olive / lower opposite light')],3,CHECKS/'beak_close.png')
    sheet([labeled(cloud.render(size=(520,380),bounds=bounds,only='visible_beak',dye=dye),dye)
           for dye in DYES],5,CHECKS/'dyes.png')
    sheet([labeled(cloud.render(camera=(-.8,-.08,.6),size=(850,650),open_mouth=True,
                               only='beak'),'Open 38 degrees / three-quarter projection'),
           labeled(cloud.render(camera=(0,-.35,1),size=(850,650),open_mouth=True,
                               only='beak'),'Open / underside and tongue, fine AO only')],2,CHECKS/'mouth_open.png')
    # Head with neighbouring pieces. These can remain grey while other painters work.
    headbounds=(70,475,360,655)
    im=cloud.render(size=(1000,650),bounds=headbounds)
    labeled(im,'Head context / composed opaque surfaces, cards not projected').save(CHECKS/'head_context.png')
    # Match apparent beak width, preserving the actual mesh's silhouette.
    reference=Image.open(paint.DODO/'ref/concept/head_side.png').convert('RGB')
    reference=reference.crop((118,322,795,807)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    close=[]
    for unlit in [True,False]:
        im=cloud.render(size=(1000,850),bounds=(170,490,356,618),only='visible_beak',unlit=unlit)
        a=np.asarray(im); yy,xx=np.nonzero(np.any(a!=[213,212,204],axis=-1))
        im=im.crop((xx.min(),yy.min(),xx.max()+1,yy.max()+1))
        im=im.resize((677,round(im.height*677/im.width)),Image.Resampling.LANCZOS)
        close.append(im)
    sheet([labeled(reference,'Concept / reflected, 677 px wide'),
           labeled(close[0],'Paint / olive unlit, 677 px wide'),
           labeled(close[1],'Paint / relit actual form, 677 px wide')],3,CHECKS/'concept_comparison.png')
    tiny=[]
    whole=cloud.render(size=(1000,1000),camera=(-1,0,0))
    for size in [200,128,50]:
        im=whole.resize((size,size),Image.Resampling.LANCZOS)
        tiny.append(labeled(im.resize((600,600),Image.Resampling.NEAREST),f'Whole bird {size} pixels / enlarged nearest'))
    sheet(tiny,3,CHECKS/'read_sizes.png')
    crops=[]
    for name in ['beak_palate','jaw_floor','tongue']:
        yy,xx=np.nonzero(ids==specs[name]['number']); box=(xx.min()-3,yy.min()-3,xx.max()+4,yy.max()+4)
        crop=Image.fromarray(layout).crop(box)
        crop=crop.resize((crop.width*4,crop.height*4),Image.Resampling.NEAREST)
        crops.append(labeled(crop,f'{name} / intrinsic base, 4x native pixels'))
    sheet(crops,1,CHECKS/'mouth_layout.png')
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
