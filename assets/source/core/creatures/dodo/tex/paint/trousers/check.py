"""Check scope/materials and preview the trouser cards, without writing outside this group.

Run paint.py, then compose.py --out <this folder>/checks/composed, then this script.
The optional existing bake-surface JSON supplies actual card geometry for previews;
painting itself needs only the accepted study elements and bakes.json.
"""
from pathlib import Path
import argparse
import hashlib
import json
import site
import tempfile

site.addsitedir(site.getusersitepackages())
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, map_coordinates

ROOT = Path(__file__).resolve().parent
DODO = ROOT.parents[2]
LAYERS = ROOT/'layers'
QA = ROOT/'checks'
REGIONS = np.array([[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255],[255,255,0]])
PALETTE = np.array([[107,115,122],[209,162,146],[139,145,102],[194,149,51],[49,45,42],[230,226,214]])/255
DYES = [('slate',[107,115,122]),('near white',[238,235,228]),('near black',[24,25,27]),
        ('hot pink',[255,24,171]),('lime',[167,246,26])]
LIGHTS = [('unlit',None),('upper left',[-.60,.70,.65]),('lower right',[.65,-.65,.70])]


def lin(a): return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def srgb(a):
    a=np.clip(a,0,1)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)
def unit(a): return a/np.maximum(np.linalg.norm(a,axis=-1,keepdims=True),1e-12)
def image(a): return Image.fromarray(np.uint8(np.rint(np.clip(a,0,1)*255)))
def read(path):
    im=Image.open(path);a=np.asarray(im)
    return a.astype(float)/(65535 if a.dtype==np.uint16 or im.mode.startswith('I') else 255)
def box_mean(a,f=4):
    h,w=a.shape[:2]
    return a.reshape(h//f,f,w//f,f,*a.shape[2:]).mean((1,3))
def normals(h,dx,dy):
    x=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*dx)
    y=np.gradient(h,dy,axis=0)
    return unit(np.stack([-x,y,np.ones_like(h)],-1))


def shade(base,alpha,n,oc,dye,light=None,bg=(.15,.17,.18)):
    c=base*lin(np.array(dye)/255)/.5
    if light is not None:
        ll=unit(np.array(light));dot=np.sum(n*ll,axis=-1)
        c*=((.60+.62*np.maximum(dot,0))*oc)[...,None]
    return np.where((alpha>=.5)[...,None],srgb(c),bg)


def material_checks(info,b,h,rough,oc,rg):
    width_mm,depth_mm=info['card_size_mm']
    l,t,r,bot=info['card_box_px'];a=b[...,3];valid=a>=.5
    issues=[];outside=np.ones(a.shape,bool);outside[t:bot,l:r]=False
    for name in ['base','height','rough','occlusion','regions']:
        cards=np.asarray(Image.open(LAYERS/f'cards_{name}.png'))
        opaque=np.asarray(Image.open(LAYERS/f'dodo_{name}.png'))
        if cards.shape[:2]!=(2048,2048):issues.append(f'cards_{name}: wrong size')
        if np.any(cards[outside]):issues.append(f'cards_{name}: paints outside its rectangle')
        if np.any(opaque):issues.append(f'dodo_{name}: paints unowned opaque texels')
    if Image.open(LAYERS/'cards_base.png').mode!='RGBA':issues.append('base is not RGBA')
    if np.asarray(Image.open(LAYERS/'cards_height.png')).dtype!=np.uint16:issues.append('height is not uint16')
    if not np.all(rg[t:bot,l:r]==[255,0,0]):issues.append('region is not pure red throughout the rectangle')
    crop=b[t:bot,l:r];v=crop[...,3]>=.5;base=lin(crop[...,:3]);ch=h[t:bot,l:r]
    mean=float(base[v].mean());spread=float(np.ptp(crop[...,:3][v],axis=1).max()*255)
    if abs(mean-.5)>.02:issues.append('mean grey differs from 0.5')
    if spread>2:issues.append('dyed base is not neutral')
    small=box_mean(crop);sm=small[...,3]>=.5
    edge=np.where(sm,np.arange(sm.shape[0])[:,None]+.5,0).max(0)*depth_mm/sm.shape[0]
    if not sm[:8].all():issues.append('open holes at the card root after 512 reduction')
    if not sm.any(0).all():issues.append('a cut along the strip is entirely empty')
    if sm[-1].any():issues.append('tips reach the rectangle bottom')
    if edge.std()<1.5:issues.append('lower edge has too little length variation')
    n=normals(ch,width_mm/(r-l),depth_mm/(bot-t))
    quarter=[]
    for yy in np.array_split(np.arange(bot-t),2):
        for xx in np.array_split(np.arange(r-l),2):
            m=v[np.ix_(yy,xx)];quarter.append(float(base[np.ix_(yy,xx)][m].mean()))
    if np.ptp(quarter)/mean>.02:issues.append('quarter means differ by more than 2%')
    correlations=[float(np.corrcoef(base[...,0][v],n[...,k][v])[0,1]) for k in range(3)]
    if max(abs(c) for c in correlations)>.08:issues.append('broad lighting remains in the base')
    jumps={}
    for name,field in [('base',base[...,0]),('height',ch),('alpha',crop[...,3])]:
        jumps[name]=float(np.abs(field[:,0]-field[:,-1]).mean()/max(np.abs(np.diff(field,axis=1)).mean(),1e-12))
        if jumps[name]>1.3:issues.append(name+': large horizontal seam')
    result=dict(passed=not issues,issues=issues,ownership='Only trousers card rectangle; all opaque layers empty',
                rectangle_px=info['card_box_px'],size_mm=info['card_size_mm'],
                mean_grey_linear=mean,channel_spread_bytes=spread,quarter_means_linear=quarter,
                base_normal_correlations=correlations,
                height_mm=dict(min=float(ch[v].min()),max=float(ch[v].max()),std=float(ch[v].std())),
                occlusion=dict(mean=float(oc[t:bot,l:r][v].mean()),min=float(oc[t:bot,l:r][v].min())),
                roughness=dict(min=float(rough[t:bot,l:r][v].min()),max=float(rough[t:bot,l:r][v].max())),
                seam_jump_ratios=jumps,game_512=dict(root_8_rows_solid=bool(sm[:8].all()),
                tip_depth_mm=[float(edge.min()),float(edge.max())],tip_depth_std_mm=float(edge.std()),
                all_columns_have_feathers=bool(sm.any(0).all()),bottom_row_clear=bool(~sm[-1].any())),
                source_hashes_match=all(hashlib.sha256((DODO/p).read_bytes()).hexdigest()==digest
                                        for p,digest in info['source_sha256'].items()))
    assert result['source_hashes_match']
    return result


def strip_previews(b,h,oc,info):
    width_mm,depth_mm=info['card_size_mm']
    l,t,r,bot=info['card_box_px'];b=b[t:bot,l:r];h=h[t:bot,l:r];oc=oc[t:bot,l:r]
    base=lin(b[...,:3]);alpha=b[...,3];n=normals(h,width_mm/(r-l),depth_mm/(bot-t))
    preview_height=round(512*depth_mm/width_mm);row_height=preview_height+35
    canvas=Image.new('RGB',(1536,5*row_height),(28,31,34));draw=ImageDraw.Draw(canvas)
    for row,(dye_name,dye) in enumerate(DYES):
        for col,(light_name,light) in enumerate(LIGHTS):
            im=image(shade(base,alpha,n,oc,dye,light)).resize((512,preview_height),Image.Resampling.LANCZOS)
            draw.text((col*512+10,row*row_height+8),dye_name+' / '+light_name,fill='white')
            canvas.paste(im,(col*512,row*row_height+30))
    canvas.save(QA/'dyes_relighting.png')
    slate=image(shade(base,alpha,n,oc,DYES[0][1],LIGHTS[1][1]));slate.save(QA/'strip_slate_full.png')
    slate.resize((1536,round(1536*depth_mm/width_mm)),Image.Resampling.LANCZOS).save(QA/'strip_physical.png')
    game=ROOT/'checks/composed/dodo_cards_base.png'
    if game.exists():
        gb=read(game)[:82];gn=unit(read(game.with_name('dodo_cards_normal.png'))[:82]*2-1)
        go=read(game.with_name('dodo_cards_packed.png'))[:82,:,0]
        small=image(shade(lin(gb[...,:3]),gb[...,3],gn,go,DYES[0][1],LIGHTS[1][1]))
    else:
        gb=box_mean(b);gn=unit(box_mean(n));go=box_mean(oc)
        small=image(shade(box_mean(base),gb[...,3],gn,go,DYES[0][1],LIGHTS[1][1]))
    sheet=Image.new('RGB',(1120,640),(29,32,35));d=ImageDraw.Draw(sheet)
    d.text((16,12),'Composed 512 atlas: strip at 1:1, then alpha cut at 0.5 enlarged 2x',fill='white')
    sheet.paste(small,(16,40));sheet.paste(small.resize((1024,164),Image.Resampling.NEAREST),(16,144))
    bird_wh=(round(width_mm/650*200),round(depth_mm/650*200))
    tiny_wh=(max(1,round(width_mm/650*50)),max(1,round(depth_mm/650*50)))
    d.text((16,330),f'128 atlas / 4x enlarged | Bird 200 px: {bird_wh[0]} x {bird_wh[1]} px strip / 4x enlarged',fill='white')
    # Rows 320:328 contain only clear gutter; the 128 atlas has 20 full rows.
    c=box_mean(b[:320],16);nn=unit(box_mean(n[:320],16));oo=box_mean(oc[:320],16)
    mini=image(shade(box_mean(base[:320],16),c[...,3],nn,oo,DYES[0][1],LIGHTS[1][1]))
    sheet.paste(mini.resize((512,80),Image.Resampling.NEAREST),(16,360))
    bird=small.resize(bird_wh,Image.Resampling.LANCZOS)
    sheet.paste(bird.resize(tuple(v*4 for v in bird_wh),Image.Resampling.NEAREST),(620,360))
    d.text((16,470),f'Bird 50 px: {tiny_wh[0]} x {tiny_wh[1]} px strip / 8x enlarged',fill='white')
    sheet.paste(small.resize(tiny_wh,Image.Resampling.LANCZOS).resize(tuple(v*8 for v in tiny_wh),Image.Resampling.NEAREST),(16,500))
    sheet.save(QA/'read_sizes.png')
    repeat=Image.new('RGB',(1536,285),(29,32,35));dd=ImageDraw.Draw(repeat)
    for i in range(2):repeat.paste(slate.resize((768,round(768*depth_mm/width_mm)),Image.Resampling.LANCZOS),(i*768,35))
    dd.text((16,10),'Two periods; the atlas wraps around each leg',fill='white');dd.text((750,18),'join',fill='white')
    repeat.save(QA/'strip_repeat.png')
    # Atlas footprint, with transparent areas shown over a checker.
    yy,xx=np.mgrid[:2048,:2048];check=(.19+.035*((xx//32+yy//32)%2))[...,None]
    full=read(LAYERS/'cards_base.png');display=full[...,:3]*full[...,3,None]+check*(1-full[...,3,None])
    layout=image(display).resize((1024,1024),Image.Resampling.LANCZOS);ld=ImageDraw.Draw(layout)
    ld.rectangle((0,0,1023,163),outline=(255,90,70),width=1)
    ld.text((16,185),'TROUSERS ONLY  /  rows 0:328 at 2048  /  body region 0',fill='white')
    layout.save(QA/'atlas_ownership.png')


def concept_compare(info):
    study=DODO/'tex/studies/trousers'
    b=read(study/'trousers_base.png');h=read(study/'trousers_height.png')*4
    n=normals(h,427/2048,427/2048);oc=read(study/'trousers_packed.png')[...,0]
    tile=image(shade(lin(b),np.ones(h.shape),n,oc,DYES[0][1],LIGHTS[1][1])).resize((640,640),Image.Resampling.LANCZOS)
    concept=Image.open(DODO/'ref/concept/side.png').convert('RGB').crop((380,770,870,1060))
    strip=read(LAYERS/'cards_base.png')[:328];a=strip[...,3]
    rgb=lin(strip[...,:3])*lin(np.array(DYES[0][1])/255)/.5
    physical=tuple(round(mm*1.5) for mm in info['card_size_mm'])
    rgba=image(np.dstack([srgb(rgb),a])).resize(physical,Image.Resampling.LANCZOS)
    swatch=Image.new('RGB',(490,290),(42,45,48));swatch.paste(tile.crop((90,280,580,475)),(0,0))
    # A material transition swatch, not a claim about final mesh placement.
    swatch.paste(rgba,((490-physical[0])//2,174),rgba)
    out=Image.new('RGB',(1020,345),(28,31,34));d=ImageDraw.Draw(out)
    d.text((10,12),'Concept lower body / 1500 px per metre',fill='white')
    d.text((520,12),'Accepted trouser tile + card / same physical scale',fill='white')
    out.paste(concept,(10,42));out.paste(swatch,(520,42));out.save(QA/'concept_scale.png')


def dyed_rgb(base,regions):
    c=lin(base[...,:3]).copy()
    for i,colour in enumerate(REGIONS):
        mask=np.all(regions==colour,axis=-1);c[mask]*=lin(PALETTE[i])/.5
    return c


def position_views(surface):
    """Opaque context from the 16-bit position bakes; cards from existing bake faces."""
    composed=QA/'composed'
    if not (composed/'dodo_base.png').exists():return {'available':False,'reason':'Run compose.py first.'}
    meta=json.loads((DODO/'tex/paint/pieces.json').read_text())
    lo=np.array(meta['position_box']['min']);hi=np.array(meta['position_box']['max'])
    mask=np.asarray(Image.open(DODO/'tex/paint/pieces.png'))[...,0]>0
    pos=np.stack([read(DODO/f'tex/paint/position_{axis}.png') for axis in 'xyz'],-1)*(hi-lo)+lo
    # Each texel describes the left side; mirror it to review the full bird.
    p=pos[mask][::2]
    object_n=np.asarray(Image.open(DODO/'ref/bakes/dodo_normal_object.png').resize((2048,2048),Image.Resampling.BILINEAR),float)/127.5-1
    no=unit(object_n[mask][::2])
    rgb=dyed_rgb(read(composed/'dodo_base.png'),np.asarray(Image.open(composed/'dodo_regions.png')))[mask][::2]
    occ=read(composed/'dodo_packed.png')[...,0][mask][::2]
    p=np.concatenate([p,p*np.array([-1,1,1])]);no=np.concatenate([no,no*np.array([-1,1,1])])
    rgb=np.concatenate([rgb,rgb]);occ=np.concatenate([occ,occ])
    faces=[]
    if surface.exists():
        raw=json.loads(surface.read_text())
        faces=[f for f in raw['faces'] if f['m']==1 and f['i'].startswith('trousers')]
        if surface!=QA/'card_surface.json':
            (QA/'card_surface.json').write_text(json.dumps({'source':'Existing ref/bakes/bake.py export; preview only.','faces':faces}))
    cards=read(composed/'dodo_cards_base.png');cn=read(composed/'dodo_cards_normal.png')*2-1
    co=read(composed/'dodo_cards_packed.png')[...,0]
    cb=lin(cards[...,:3])*lin(PALETTE[0])/.5
    W,H=500,620;scale=800;L=unit(np.array([.45,.8,.65]))
    colours=srgb(rgb*((.55+.65*np.maximum(np.sum(no*L,-1),0))*occ)[...,None])
    views=[];counts={}
    for name,haxis,hsign,daxis,dsign,center in [('front',0,-1,2,1,0),('side',2,-1,0,1,-.065),('back',0,1,2,-1,0)]:
        canvas=np.full((H,W,3),[.19,.21,.22]);depth=np.full((H,W),-np.inf)
        px=np.rint(W/2+(hsign*p[:,haxis]-center)*scale).astype(int)
        py=np.rint(580-p[:,1]*scale).astype(int);dep=dsign*p[:,daxis]
        ok=(px>=0)&(px<W)&(py>=0)&(py<H)
        px,py,dep,col=px[ok],py[ok],dep[ok],colours[ok]
        index=py*W+px;order=np.lexsort((dep,index));ordered=index[order]
        chosen=order[np.r_[ordered[1:]!=ordered[:-1],True]]
        canvas.reshape(-1,3)[index[chosen]]=col[chosen];depth.ravel()[index[chosen]]=dep[chosen]
        # Close only one-pixel gaps in the point projection, before drawing cards.
        occupied=np.isfinite(depth);dist,ix=distance_transform_edt(~occupied,return_indices=True)
        fill=(dist<=1)&~occupied;canvas[fill]=canvas[tuple(ix)][fill];depth[fill]=depth[tuple(ix)][fill]
        painted=np.zeros((H,W),bool)
        for f in faces:
            # The bake stores both sides and both legs; do not mirror these faces.
            for k in range(1,len(f['p'])-1):
                pp=np.array(f['p'])[[0,k,k+1]];uv=np.array(f['uv'])[[0,k,k+1]];nn=np.array(f['n'])[[0,k,k+1]]
                screen=np.column_stack([W/2+(hsign*pp[:,haxis]-center)*scale,580-pp[:,1]*scale])
                low=np.maximum(np.floor(screen.min(0)).astype(int),0);high=np.minimum(np.ceil(screen.max(0)).astype(int),[W-1,H-1])
                x0,y0=low;x1,y1=high
                if x1<x0 or y1<y0:continue
                yy,xx=np.mgrid[y0:y1+1,x0:x1+1];xx=xx+.5;yy=yy+.5
                p0,p1,p2=screen
                den=(p1[1]-p2[1])*(p0[0]-p2[0])+(p2[0]-p1[0])*(p0[1]-p2[1])
                if abs(den)<1e-9:continue
                w0=((p1[1]-p2[1])*(xx-p2[0])+(p2[0]-p1[0])*(yy-p2[1]))/den
                w1=((p2[1]-p0[1])*(xx-p2[0])+(p0[0]-p2[0])*(yy-p2[1]))/den;w2=1-w0-w1
                weights=[w0,w1,w2];inside=(w0>=0)&(w1>=0)&(w2>=0)
                uvp=sum(w[...,None]*v for w,v in zip(weights,uv));dd=sum(w*v for w,v in zip(weights,dsign*pp[:,daxis]))
                coords=[(1-uvp[...,1])*512-.5,uvp[...,0]*512-.5]
                aa=map_coordinates(cards[...,3],coords,order=1,mode='nearest')
                sl=np.s_[y0:y1+1,x0:x1+1];hit=inside&(aa>=.5)&(dd>depth[sl])
                if not hit.any():continue
                normal=unit(sum(w[...,None]*v for w,v in zip(weights,nn)))
                delta=uv[1:]-uv[0];delta_p=pp[1:]-pp[0]
                det=delta[0,0]*delta[1,1]-delta[0,1]*delta[1,0]
                if abs(det)>1e-14:
                    tu=(delta_p[0]*delta[1,1]-delta_p[1]*delta[0,1])/det
                    tv=(-delta_p[0]*delta[1,0]+delta_p[1]*delta[0,0])/det
                    tangent=unit(tu-normal*np.sum(normal*tu,-1)[...,None]);bitangent=unit(np.cross(normal,tangent))
                    bitangent*=np.where(np.sum(bitangent*tv,-1)>=0,1,-1)[...,None]
                    nm=np.stack([map_coordinates(cn[...,i],coords,order=1,mode='nearest') for i in range(3)],-1)
                    normal=unit(tangent*nm[...,0,None]+bitangent*nm[...,1,None]+normal*nm[...,2,None])
                colour=np.stack([map_coordinates(cb[...,i],coords,order=1,mode='nearest') for i in range(3)],-1)
                ao=map_coordinates(co,coords,order=1,mode='nearest')
                colour=srgb(colour*((.55+.65*np.maximum(np.sum(normal*L,-1),0))*ao)[...,None])
                canvas[sl][hit]=colour[hit];depth[sl][hit]=dd[hit];painted[sl][hit]=True
        im=image(canvas);draw=ImageDraw.Draw(im);draw.text((14,14),name+' / position maps + actual trouser cards',fill='white')
        im.save(QA/f'position_{name}.png');views.append(im);counts[name]=int(painted.sum())
    out=Image.new('RGB',(W*3,H),(30,33,35))
    for i,im in enumerate(views):out.paste(im,(i*W,0))
    out.save(QA/'position_views.png')
    # Leg-area enlargement, where the card coverage and the underlying body meet.
    detail=Image.new('RGB',(1500,500),(30,33,35))
    for i,im in enumerate(views):detail.paste(im.crop((125,425,375,600)).resize((500,350),Image.Resampling.LANCZOS),(500*i,35))
    ImageDraw.Draw(detail).text((16,12),'Same projection, leg-area detail; unavailable groups remain plain material',fill='white')
    detail.save(QA/'leg_closeups.png')
    return dict(available=True,card_faces=len(faces),visible_card_pixels=counts,
                body_paint_available=(DODO/'tex/paint/body/layers/dodo_base.png').exists(),
                method='Opaque surface: 16-bit position bakes, mirrored; trousers: existing bake triangles, composed 512 atlas, alpha >= 0.5.')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--surface',type=Path)
    args=parser.parse_args();QA.mkdir(exist_ok=True)
    surface=args.surface or QA/'card_surface.json'
    if not surface.exists():surface=Path(tempfile.gettempdir())/'dodo_surface.json'
    info=json.loads((LAYERS/'layers.json').read_text())
    b=read(LAYERS/'cards_base.png');h=read(LAYERS/'cards_height.png')*info['cards_height_mm']
    rough=read(LAYERS/'cards_rough.png');oc=read(LAYERS/'cards_occlusion.png');rg=np.asarray(Image.open(LAYERS/'cards_regions.png'))
    results=material_checks(info,b,h,rough,oc,rg)
    strip_previews(b,h,oc,info);concept_compare(info);results['position_views']=position_views(surface)
    (QA/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(results,indent=2))
    if not results['passed']:raise SystemExit(1)


if __name__=='__main__':main()
