"""Read-only material checks and Python previews of the painted card rectangles.
Opaque context is projected from the published position maps. Cards use the
modeller's frozen baked faces, including both surfaces; no Blender required.
"""
import sys,site
sys.dont_write_bytecode=True
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from scipy.ndimage import map_coordinates,distance_transform_edt,label,binary_erosion
sys.path.insert(0,str(Path(__file__).resolve().parent))
import paint
HERE=Path(__file__).resolve().parent
DODO=HERE.parents[2]
QA=HERE/'checks';QA.mkdir(exist_ok=True)
PAL=np.array([[107,115,122],[209,162,146],[139,145,102],[194,149,51],[49,45,42],[230,226,214]],float)/255
REG=np.array([[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255],[255,255,0]])
VIEWS={'front':(np.array([1.,0,0]),np.array([0.,0,1.])),
       'side':(np.array([0.,0,-1.]),np.array([1.,0,0])),
       'back':(np.array([-1.,0,0]),np.array([0.,0,-1.]))}


def font(n):return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',n)
def rgbimage(v):return Image.fromarray(np.rint(np.clip(v,0,1)*255).astype(np.uint8))
def array(path):
    im=Image.open(path);a=np.asarray(im)
    return a.astype(float)/(65535 if a.dtype==np.uint16 else 255)

def region_index(r):
    idx=np.full(r.shape[:2],-1)
    for i,c in enumerate(REG):idx[(r==c).all(-1)]=i
    return idx

def dye(base,regions,palette=PAL):
    idx=region_index(np.rint(regions*255).astype(np.uint8));out=paint.decode(base[...,:3])
    good=idx>=0;out[good]*=paint.decode(palette)[idx[good]]/.5
    return out

def panel(items,cell=(430,620),cols=2):
    w,h=cell;out=Image.new('RGB',(cols*w,((len(items)+cols-1)//cols)*(h+34)),(213,212,205));d=ImageDraw.Draw(out)
    for i,(title,im) in enumerate(items):
        im=im.copy();im.thumbnail((w-20,h-8),Image.Resampling.LANCZOS)
        x=i%cols*w;y=i//cols*(h+34)
        d.text((x+10,y+8),title,font=font(14),fill=(35,38,40));out.paste(im,(x+(w-im.width)//2,y+34+(h-im.height)//2))
    return out

def background(rgba):
    b=Image.new('RGBA',rgba.size,(213,212,205,255));b.alpha_composite(rgba);return b.convert('RGB')


def material_checks():
    info=json.loads((HERE/'layers/layers.json').read_text());data={k:array(HERE/'layers'/f'cards_{k}.png') for k in ['base','height','rough','occlusion','regions']}
    measured=json.loads((DODO/'tex/paint/pieces.json').read_text())['cards']
    b=data['base'];a=b[...,3]>=.5;regions=region_index(np.rint(data['regions']*255).astype(np.uint8));owner=np.zeros(a.shape,bool)
    results={'ownership':'tail and finger only; no opaque pieces','elements':{},'height_mm':info['cards_height_mm']}
    for name,cfg in info['card_rectangles'].items():
        assert cfg['card_mm']==measured[name]['card_mm']
        assert cfg['pixel_mm']==measured[name]['mm_per_texel']
        x0,y0,x1,y1=cfg['box_px'];owner[y0:y1,x0:x1]=True
        own=np.zeros_like(a);own[y0:y1,x0:x1]=True;m=a&own
        _,components=label(m[y0:y1,x0:x1],structure=np.ones((3,3)))
        assert components==1,'Detached cutout specks'
        vals=paint.decode(b[...,0]);ys,xs=np.where(m)
        assert ys.min()>y0 and ys.max()<y1-1 and xs.min()>x0 and xs.max()<x1-1,'Feather clipped to rectangle'
        record={'rectangle_px':cfg['box_px'],'covered_box_px':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)],'cutout_components':components,'region_means':{}}
        for rid in np.unique(regions[m]):
            v=vals[m&(regions==rid)];assert abs(v.mean()-.5)<.02
            record['region_means'][str(rid)]={'mean_linear':float(v.mean()),'std_linear':float(v.std())}
        assert set(np.unique(regions[m]))==({0,5} if name=='tail' else {5})
        # Trace the source shaft approximately through its unbent UV rectangle.
        x=int(round(cfg['root_px'][0]));line=(regions[y0:y1,x]==5)&a[y0:y1,x]
        changes=np.flatnonzero(np.diff(np.pad(line.astype(int),(1,1))))
        lengths=(changes[1::2]-changes[::2])*cfg['pixel_mm'][1]
        if name=='tail':assert len(lengths)==2 and np.all((lengths>4.4)&(lengths<5.5))
        record['yellow_intervals_mm']=lengths.tolist()
        # The composer now reads the same anisotropic texel sizes from pieces.json.
        sl=np.s_[y0:y1,x0:x1];h=data['height'][sl]*info['cards_height_mm'];n=paint.normal(h,*cfg['pixel_mm'])
        interior=binary_erosion(a[sl],iterations=3)
        corr=[]
        for l in [(-.75,.45,.5),(.75,.45,.5),(0,-.85,.5)]:
            light=np.array(l);light/=np.linalg.norm(light);shade=np.sum(n*light,-1)
            corr.append(float(np.corrcoef(vals[sl][interior],shade[interior])[0,1]))
        record['physical_base_light_correlations']=corr
        record['height_visible_mm']=[float(h[a[sl]].min()),float(h[a[sl]].max())]
        record['composer_texel_mm']=cfg['pixel_mm']
        record['card_mm']=cfg['card_mm']
        record['physical_texel_mm']=cfg['pixel_mm']
        results['elements'][name]=record
    assert np.all(b[~owner]==0)
    for k,v in data.items():assert np.all(v[~owner]==0),k
    for k in data:assert not np.any(array(HERE/'layers'/f'dodo_{k}.png'))
    assert np.max(np.ptp(np.rint(b[...,:3]*255),axis=-1)[a])==0
    assert set(map(tuple,np.unique(np.rint(data['regions']*255).astype(np.uint8).reshape(-1,3),axis=0)))=={(0,0,0),(255,0,0),(255,255,0)}
    results['neutral_channel_spread']=0;results['outside_ownership_nonzero_pixels']=0
    results['sha256']={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((HERE/'layers').iterdir())}
    (QA/'validation.json').write_text(json.dumps(results,indent=2)+'\n')
    return info,data,results


def flat_reviews(info,data):
    items=[]
    palettes=[('Slate / cream',PAL),('Pink / lime',PAL.copy()),('Near black / white',PAL.copy()),('Near white / charcoal',PAL.copy())]
    palettes[1][1][[0,5]]=np.array([[244,40,168],[184,246,44]])/255
    palettes[2][1][[0,5]]=np.array([[17,19,25],[242,243,239]])/255
    palettes[3][1][[0,5]]=np.array([[237,238,233],[36,38,42]])/255
    for title,pal in palettes:
        col=dye(data['base'],data['regions'],pal)
        for name,cfg in info['card_rectangles'].items():
            x0,y0,x1,y1=cfg['box_px'];sl=np.s_[y0:y1,x0:x1]
            h=data['height'][sl]*info['cards_height_mm'];n=paint.normal(h,*cfg['pixel_mm']);l=np.array([-.45,.5,.75]);l/=np.linalg.norm(l)
            shade=(.3+.75*np.maximum(np.sum(n*l,-1),0))*data['occlusion'][sl]
            source=np.dstack([paint.encode(col[sl]*shade[...,None]),data['base'][sl][...,3]])
            # Undo the taper compensation for a readable physical flat preview.
            # The model previews below retain the actual UV mapping and geometry.
            yy,xx=np.indices(source.shape[:2],dtype=float);hh,ww=source.shape[:2]
            tt,widths=np.array(cfg['surface_width_rows_t_mm']).T
            rowwidth=np.interp(1-(yy+.5)/hh,tt,widths)
            sx=(.5+((xx+.5)/ww-.5)*cfg['card_mm'][0]/rowwidth)*ww-.5
            flat=np.stack([map_coordinates(source[...,j],[yy,sx],order=1,mode='constant',cval=0,prefilter=False) for j in range(4)],-1)
            rgba=rgbimage(flat)
            # Correct physical aspect for the non-square UV texels.
            size=tuple(round(v*6) for v in cfg['card_mm'])
            rgba=rgba.resize(size,Image.Resampling.LANCZOS)
            if title=='Slate / cream':rgba.save(QA/f'{name}_physical_full.png')
            items.append((title+' | '+name,background(rgba)))
    panel(items,(260,750),2).save(QA/'physical_card_dyes.png')
    col=dye(data['base'],data['regions']);a=data['base'][...,3]
    yy,xx=np.indices(a.shape);bg=np.where(((xx//32+yy//32)%2)[...,None],.11,.14)
    im=rgbimage(paint.encode(col)*a[...,None]+bg*(1-a[...,None]))
    d=ImageDraw.Draw(im)
    for name,cfg in info['card_rectangles'].items():
        x0,y0,x1,y1=cfg['box_px'];d.rectangle((x0,y0,x1-1,y1-1),outline=(200,140,65),width=2);d.text((x0+12,y0+12),name+' | root down, tip up',font=font(20),fill=(255,255,255))
    im.save(QA/'layout_dyed.png')

    # The original and accepted material, registered at the same physical scale.
    source_items=[]
    for name,cfg in info['card_rectangles'].items():
        folder=paint.STUDY/'source'/cfg['element']
        e=next(e for e in json.loads((paint.STUDY/'study.json').read_text())['sets']['quills']['elements'] if e['id']==cfg['element'])
        size=tuple(round(v*6) for v in cfg['card_mm']);yy,xx=np.indices((size[1],size[0]),dtype=float)
        mm=e['master_span_m']*1000/1024
        px=(xx+.5)/6-cfg['card_mm'][0]/2
        along=cfg['card_mm'][1]-(yy+.5)/6-cfg['root_above_bottom_mm']
        coords=[e['master_root_px'][1]+along/(mm*cfg['scale']),e['master_root_px'][0]+px/(mm*cfg['scale']*cfg['width_scale'])]
        for label,file in [('Generated original','aligned_generated.png'),('Accepted neutral master','cutout.png')]:
            src=array(folder/file)
            if src.shape[-1]==3:src=np.dstack([src,array(folder/'cutout.png')[...,3]])
            out=np.stack([map_coordinates(src[...,j],coords,order=1,mode='constant',cval=0,prefilter=False) for j in range(4)],-1)
            source_items.append((name+' | '+label,background(rgbimage(out))))
        source_items.append((name+' | painted, dyed and relit',background(Image.open(QA/f'{name}_physical_full.png'))))
    panel(source_items,(250,750),3).save(QA/'source_comparison.png')


def composed_maps():
    p=QA/'composed'
    out={}
    for mat in ['dodo','dodo_cards']:
        out[mat]={k:array(p/f'{mat}_{k}.png') for k in ['base','normal','packed','regions']}
        out[mat]['colour']=dye(out[mat]['base'],out[mat]['regions'])
    return out


def game_checks(info,maps):
    mat=maps['dodo_cards'];base=mat['base'];reg=region_index(np.rint(mat['regions']*255).astype(np.uint8));records={};images=[]
    for name,cfg in info['card_rectangles'].items():
        x0,y0,x1,y1=[round(v/4) for v in cfg['box_px']]
        x=round(cfg['root_px'][0]/4);alpha=base[y0:y1,x,3]>=.5
        line=(reg[y0:y1,x]==5)&alpha;edges=np.flatnonzero(np.diff(np.pad(line.astype(int),(1,1))))
        runs=(edges[1::2]-edges[::2]).tolist()
        if name=='tail':
            assert len(runs)==2 and min(runs)>=8
            assert reg[y0+np.flatnonzero(alpha)[0],x]==0,'Body-coloured tip margin missing'
        cut=base[y0:y1,x0:x1,3]>=.5
        records[name]={'yellow_shaft_runs_game_pixels':runs,'cutout_covered_pixels':int(cut.sum()),'alpha_threshold':.5}
        colour=paint.encode(mat['colour'][y0:y1,x0:x1]);out=np.where(cut[...,None],colour,.14)
        im=rgbimage(out);im.save(QA/f'{name}_game_cutout.png')
        images.append((name+' | final 512 atlas / cut at 0.5 / 4x',im.resize((im.width*4,im.height*4),Image.Resampling.NEAREST)))
    panel(images,(520,1200),2).save(QA/'game_cutout_edges.png')
    (QA/'game_checks.json').write_text(json.dumps(records,indent=2)+'\n')


def opaque_points(maps):
    folder=DODO/'tex/paint';meta=json.loads((folder/'pieces.json').read_text())
    mask=np.array(Image.open(folder/'pieces.png'))[...,0]>0
    lo=np.array(meta['position_box']['min']);hi=np.array(meta['position_box']['max'])
    pos=np.stack([array(folder/f'position_{c}.png') for c in 'xyz'],-1)*(hi-lo)+lo
    nor=np.array(Image.open(DODO/'ref/bakes/dodo_normal_object.png').resize((2048,2048),Image.Resampling.BILINEAR))/127.5-1
    pos=pos[mask];nor=nor[mask];col=maps['dodo']['colour'][mask];ao=maps['dodo']['packed'][...,0][mask]
    p2=pos.copy();p2[:,0]*=-1;n2=nor.copy();n2[:,0]*=-1
    return np.concatenate([pos,p2]),np.concatenate([nor,n2]),np.concatenate([col,col]),np.concatenate([ao,ao])


def render(view,maps,points=None,pixels_per_m=1500,box=None,light=(-.45,.65,.75),palette=None):
    # At 1500 px/m the camera matches the supplied concept coordinates.
    right,eye=VIEWS[view];up=np.array([0.,1.,0.]);scale=pixels_per_m/1500
    if box is None:box=(0,0,1254,1254)
    x0,y0,x1,y1=box;w,h=round((x1-x0)*scale),round((y1-y0)*scale)
    zbuf=np.full((h,w),-np.inf);out=np.full((h,w,3),np.array([214,213,205])/255)
    coverage=np.zeros((h,w),bool)
    ll=np.array(light,float);ll/=np.linalg.norm(ll)
    def project(p):
        return np.stack([(627+np.einsum('...i,i->...',p,right)*1500-x0)*scale,(1150-p[...,1]*1500-y0)*scale,np.einsum('...i,i->...',p,eye)],-1)
    if points is not None:
        pos,nor,col,ao=points;proj=project(pos);px=np.floor(proj[:,0]).astype(int);py=np.floor(proj[:,1]).astype(int)
        n=nor/np.maximum(np.linalg.norm(nor,axis=-1,keepdims=True),1e-8)
        c=paint.encode(col*(.28+.75*np.maximum(np.einsum('ij,j->i',n,ll),0))[:,None]*ao[:,None])
        valid=(px>=0)&(py>=0)&(px<w)&(py<h)
        px,py,zz,cc=px[valid],py[valid],proj[valid,2],c[valid]
        index=py*w+px;order=np.lexsort((zz,index));ii=index[order]
        keep=np.r_[ii[1:]!=ii[:-1],True];sel=order[keep]
        zbuf[py[sel],px[sel]]=zz[sel];out[py[sel],px[sel]]=cc[sel]
        mask=np.isfinite(zbuf);dist,ix=distance_transform_edt(~mask,return_indices=True);fill=(~mask)&(dist<=1.5*scale)
        out[fill]=out[tuple(ix)][fill];zbuf[fill]=zbuf[tuple(ix)][fill]
    geom=json.loads((HERE/'source/cards_geometry.json').read_text());faces=geom['faces']
    # The model stores left fingers and mirrors them; tail already has all pairs.
    faces=faces+[dict(f,p=(np.array(f['p'])*[-1,1,1]).tolist(),n=(np.array(f['n'])*[-1,1,1]).tolist()) for f in faces if f['i'].startswith('fingers_l')]
    mat=maps['dodo_cards'];texture_size=mat['base'].shape[0]
    color=mat['colour'] if palette is None else dye(mat['base'],mat['regions'],palette)
    for f in faces:
        p=np.array(f['p']);uv=np.array(f['uv']);norm=np.array(f['n']);pr=project(p)
        for k in range(1,len(p)-1):
            ids=[0,k,k+1];tri=pr[ids];puv=uv[ids];pp=p[ids]
            bx0,by0=np.maximum(np.floor(tri[:,:2].min(0)).astype(int),0);bx1,by1=np.minimum(np.ceil(tri[:,:2].max(0)).astype(int),[w-1,h-1])
            if bx1<bx0 or by1<by0:continue
            y,x=np.mgrid[by0:by1+1,bx0:bx1+1];x=x+.5;y=y+.5
            den=(tri[1,1]-tri[2,1])*(tri[0,0]-tri[2,0])+(tri[2,0]-tri[1,0])*(tri[0,1]-tri[2,1])
            if abs(den)<1e-9:continue
            a=((tri[1,1]-tri[2,1])*(x-tri[2,0])+(tri[2,0]-tri[1,0])*(y-tri[2,1]))/den
            b=((tri[2,1]-tri[0,1])*(x-tri[2,0])+(tri[0,0]-tri[2,0])*(y-tri[2,1]))/den;c=1-a-b
            inside=(a>=0)&(b>=0)&(c>=0);zz=a*tri[0,2]+b*tri[1,2]+c*tri[2,2]
            sl=np.s_[by0:by1+1,bx0:bx1+1];inside&=zz>zbuf[sl]
            if not inside.any():continue
            weights=np.stack([a,b,c],-1);st=np.einsum('...i,ij->...j',weights,puv)
            coords=np.array([(1-st[...,1])*texture_size-.5,st[...,0]*texture_size-.5])
            def sample(arr):
                if arr.ndim==3:return np.stack([sample(arr[...,j]) for j in range(arr.shape[-1])],-1)
                return map_coordinates(arr,coords,order=1,mode='nearest',prefilter=False)
            alpha=sample(mat['base'][...,3]);inside&=alpha>=.5
            if not inside.any():continue
            nn=np.einsum('...i,ij->...j',weights,norm[ids]);nn/=np.maximum(np.linalg.norm(nn,axis=-1,keepdims=True),1e-9)
            duv=puv[1:]-puv[0];dp=pp[1:]-pp[0]
            if abs(np.linalg.det(duv))<1e-12:continue
            tangents=np.linalg.solve(duv,dp);t=tangents[0]-nn*np.sum(nn*tangents[0],-1)[...,None];t/=np.maximum(np.linalg.norm(t,axis=-1,keepdims=True),1e-9)
            bt=np.cross(nn,t);bt*=np.where(np.sum(bt*tangents[1],-1)>=0,1.,-1.)[...,None]
            bump=sample(mat['normal'])*2-1;world=t*bump[...,0,None]+bt*bump[...,1,None]+nn*bump[...,2,None]
            world/=np.maximum(np.linalg.norm(world,axis=-1,keepdims=True),1e-9)
            world*=np.where(np.sum(world*eye,-1)>=0,1.,-1.)[...,None]
            shade=(.28+.75*np.maximum(np.sum(world*ll,-1),0))*sample(mat['packed'][...,0])
            col=paint.encode(sample(color)*shade[...,None])
            out[sl][inside]=col[inside];zbuf[sl][inside]=zz[inside];coverage[sl][inside]=True
    return rgbimage(out),coverage


def run():
    info,data,result=material_checks();flat_reviews(info,data)
    maps=composed_maps();game_checks(info,maps);points=opaque_points(maps);items=[]
    for view in VIEWS:
        im,mask=render(view,maps,points);im.save(QA/f'bird_{view}.png');items.append((view+' | composed maps / baked card geometry',im))
    panel(items,(500,500),3).save(QA/'bird_views.png')
    concept=Image.open(DODO/'ref/concept/side.png');boxes={'tail':(800,450,1040,705),'finger':(685,665,845,810)};comparison=[]
    for kind,box in boxes.items():
        im,_=render('side',maps,points,box=box)
        comparison += [('Concept '+kind,concept.crop(box)),('Painted model '+kind,im)]
    panel(comparison,(280,280),2).save(QA/'concept_comparison.png')
    # Exact game maps in close-up: no alternate material painted for the review.
    close=[]
    for kind,box in boxes.items():
        im,_=render('side',maps,None,pixels_per_m=6000,box=box);im.save(QA/f'model_{kind}_close.png');close.append((kind+' | 512 atlas, enlarged on model',im))
    panel(close,(720,900),2).save(QA/'model_close.png')
    pal=PAL.copy();pal[[0,5]]=np.array([[244,40,168],[184,246,44]])/255
    dye_im,_=render('back',maps,None,pixels_per_m=3000,box=(480,430,775,660),palette=pal)
    dye_im.save(QA/'fan_pink_lime.png')
    relights=[]
    for name,l in [('upper left',(-.75,.45,.5)),('upper right',(.75,.45,.5)),('below',(0,-.85,.5))]:
        im,_=render('back',maps,None,pixels_per_m=3000,box=(480,430,775,660),light=l);relights.append((name,im))
    panel(relights,(480,440),3).save(QA/'fan_relighting.png')
    sizeitems=[]
    im=Image.open(QA/'bird_side.png')
    for height in [200,50,20]:
        # Bird height is 0.65 m in a 0.836 m square image.
        n=round(height/.65*(1254/1500));small=im.resize((n,n),Image.Resampling.LANCZOS);small.save(QA/f'bird_{height}px.png');sizeitems.append((f'Bird {height}px tall',small.resize((n*3,n*3),Image.Resampling.NEAREST)))
    panel(sizeitems,(540,600),3).save(QA/'size_checks.png')
    print(json.dumps(result,indent=2))

if __name__=='__main__':run()
