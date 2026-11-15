"""Audit the revision, preserve-original contract, paintings and their guides."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
import numpy as np,json,hashlib,math
R=Path(__file__).resolve().parents[1];OLD=R.parent;C=R/'checks';BG=(214,212,206)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
original=json.loads((C/'original_files.json').read_text());changes=[];external_transcripts=[]
for name,sha in original.items():
    p=OLD/name
    if 'transcript' in p.name and p.suffix=='.txt':
        external_transcripts.append(name);continue # live host transcript, not a delivered artifact
    if name=='REPORT.md':
        assert p.read_bytes().startswith((C/'original_REPORT.md').read_bytes()),'Original report text changed'
    elif not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest()!=sha:changes.append(name)
assert not changes,changes
geo=json.loads((C/'geometry.json').read_text());profile=geo['head_profiles']['hatchet'];outline=profile['outline']
def station(y):
    zs=[]
    for a,b in zip(outline,outline[1:]+outline[:1]):
        if min(a[0],b[0])<=y<=max(a[0],b[0]) and a[0]!=b[0]:
            f=(y-a[0])/(b[0]-a[0]);zs.append(a[1]+f*(b[1]-a[1]))
    return min(zs),max(zs)
def forward(z):
    ys=[]
    for a,b in zip(outline,outline[1:]+outline[:1]):
        if min(a[1],b[1])<=z<=max(a[1],b[1]) and a[1]!=b[1]:
            f=(z-a[1])/(b[1]-a[1]);ys.append(a[0]+f*(b[0]-a[0]))
    return max(ys)
root=station(0)
design={'root_Z_stations_m':list(root),'root_Z_span_m':root[1]-root[0],
    'head_Z_span_m':max(p[1] for p in outline)-min(p[1] for p in outline),
    'root_X_thickness_m':geo['components']['hatchet']['head']['dimensions_m'][0],
    'furthest_edge_Y_m':max(p[0] for p in outline),
    'furthest_edge_Z_m':max(outline,key=lambda p:p[0])[1],
    'upper_edge_Y_at_Z_0_340_m':forward(.340),'lower_edge_Y_at_Z_0_250_m':forward(.250),
    'broad_flake_polygons_per_face':profile['front_facet_count'],
    'outline_vertices':len(outline),
    'shoulder_notch_centres_YZ_m':[[.032,.348],[.065,.232]],
    'method':'Dimensions read from saved head profile/component geometry, root span by intersecting outline with y=0; lower and upper edge sweep by intersecting z stations.'}
assert abs(design['root_Z_span_m']-.08)<1e-6
assert abs(design['head_Z_span_m']-.14)<1e-6
assert abs(design['root_X_thickness_m']-.024)<1e-6
assert abs(design['furthest_edge_Y_m']-.115)<1e-6
assert design['lower_edge_Y_at_Z_0_250_m']>design['upper_edge_Y_at_Z_0_340_m']
result={'original_files_checked':len(original)-len(external_transcripts),'excluded_live_host_transcripts':external_transcripts,'original_file_changes_except_report_append':changes,
    'original_report_prefix_preserved':True,'hatchet_design':design,'paintings':{},'deliverables':{}}

# Compare painting silhouettes with the unchanged rendered drawing: no image
# registration, warping, or rescaling of one silhouette to force agreement.
for name in ['pick','hatchet','spear_head']:
    guide=Image.open(R/'guides'/f'{name}_rgba.png').convert('RGBA')
    raw=Image.open(R/'paint_sources'/f'{name}_paint_rgba.png').convert('RGBA')
    paint=Image.open(OLD/f'paint_{name}.png').convert('RGB')
    assert raw.size==guide.size==(1254,1254)
    ga=np.asarray(guide.getchannel('A'))>=128;pa=np.asarray(raw.getchannel('A'))>=128
    def bounds(a):
        yy,xx=np.where(a);return [int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
    gb,pb=bounds(ga),bounds(pa)
    iou=float(np.logical_and(ga,pa).sum()/np.logical_or(ga,pa).sum())
    a=np.asarray(raw.getchannel('A'));rgb=np.asarray(paint)
    cleared=a<=8
    exact=bool(np.all(rgb[cleared]==BG));assert exact
    result['paintings'][name]={'guide_bbox_px':gb,'paint_bbox_px':pb,
        'bbox_boundary_deltas_px':[b-a for a,b in zip(gb,pb)],'silhouette_intersection_over_union':iou,
        'background_exact_where_source_alpha_le_8':exact,
        'interpretation':'Appearance painting, not a dimensioned projection. Minor generative silhouette drift is recorded, not fitted away.'}
    sheet=Image.new('RGB',(1881,710),BG)
    flatguide=Image.new('RGBA',guide.size,BG+(255,));flatguide.alpha_composite(guide)
    overlay=paint.copy();edge=Image.fromarray((ga*255).astype('uint8')).filter(ImageFilter.MaxFilter(3))
    eroded=Image.fromarray((ga*255).astype('uint8')).filter(ImageFilter.MinFilter(3))
    line=np.asarray(edge)>np.asarray(eroded)
    arr=np.asarray(overlay).copy();arr[line]=[40,155,175];overlay=Image.fromarray(arr)
    for i,im in enumerate([flatguide.convert('RGB'),paint,overlay]):sheet.paste(im.resize((627,627),Image.Resampling.LANCZOS),(i*627,70))
    d=ImageDraw.Draw(sheet)
    for i,label in enumerate(['Rendered drawing','Finished painting','Drawing contour over paint']):d.text((i*627+20,15),name+' | '+label,font=font,fill=(30,40,45))
    d.text((1274,44),f'Silhouette IoU {iou:.3f}; no registration applied',font=small,fill=(30,40,45))
    sheet.save(C/f'{name}_paint_comparison.png')

files=[OLD/f'paint_{name}.png' for name in ['pick','hatchet','spear_head','first_person','sheet']]
files += [R/f'hatchet_{v}{s}.png' for v in ['side','edge','end'] for s in ['', '_mask']]
files += [R/'lineup.png',R/'read_sizes.png',R/'source/tool_masters.blend']
for p in files:
    rec={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
    if p.suffix=='.png':
        im=Image.open(p);rec['size_px']=list(im.size);rec['mode']=im.mode
    result['deliverables'][str(p.relative_to(OLD))]=rec
(C/'revision_audit.json').write_text(json.dumps(result,indent=2))
print(json.dumps({'original_files_preserved':result['original_files_checked'],'hatchet_design':design,'paint_silhouette_IoU':{k:v['silhouette_intersection_over_union'] for k,v in result['paintings'].items()}},indent=2))
