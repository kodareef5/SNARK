from pathlib import Path
from PIL import Image
import numpy as np,json,hashlib
R=Path(__file__).resolve().parent
from export_images import SOURCES,ORTHO
results=[]
for n in SOURCES:
 p=R/f'{n}.png';a=np.array(Image.open(p));m=np.array(Image.open(R/'checks'/f'{n}_matte.png'))
 expected=(3200,1600) if n in ['top','underside','front'] else ((1600,1600) if n in ORTHO+['saddled_side','saddled_folded_side'] else None)
 checks={'file':p.name,'exists':p.is_file(),'rgb_png':Image.open(p).mode=='RGB','canvas_correct':expected is None or Image.open(p).size==expected,'flat_background':bool(np.all(a[m==0]==[214,212,206])),'no_cropping':bool(not np.any(m[[0,-1],:]) and not np.any(m[:,[0,-1]])) if n in ORTHO else None}
 if n in ORTHO:checks['matching_mask']=bool(np.array_equal(m,np.array(Image.open(R/f'{n}_mask.png'))))
 results.append(checks)
 assert all(v is not False for k,v in checks.items()),checks
manifest=json.load(open(R/'checks'/'generation_manifest.json'))
for c in manifest['calls']:
 for f in [c['prompt'],c['original'],*c['references']]:assert (R/f).is_file(),f
m=json.load(open(R/'checks'/'measurements.json'))
assert m['summary']['required_comparisons_pass']
assert m['summary']['span_comparison_pass']
# Direct 2D contour chord lengths: avoid treating nominal geometry as measurements.
a=np.array(Image.open(R/'top_mask.png'))>=128
chords={}
for name,x in [('inner_membrane',1740),('wrist_section',2004),('mid_finger_section',2597)]:
 ys=np.where(a[:,x])[0];chords[name]={'column':x,'first_foreground_row':int(ys.min()),'last_foreground_row':int(ys.max()),'projected_depth_m':round((int(ys.max())-int(ys.min()))/400,4)}
(R/'checks'/'surface_dimensions.json').write_text(json.dumps({'wing_chords':chords,'notes':'Column chord includes leading-edge thickness; wrist claws may enlarge a chord. These are projected depths, not surface arc lengths. Bare side chest is visibly leaner than original 0.42m target, around0.30m; foot including hooked claws around0.22-0.26m.'},indent=2))
output={'passed':True,'deliverable_images':19,'paintings':13,'masks':6,'file_checks':results,'landmark_summary':m['summary'],'generation_calls':len(manifest['calls'])}
(R/'checks'/'delivery_validation.json').write_text(json.dumps(output,indent=2))
print(json.dumps({'passed':True,'paintings':13,'masks':6,'all_backgrounds_exact':True,'canvases_and_masks_correct':True,'visible_landmark_comparisons':m['summary']['required_comparisons'],'wing_chords':chords},indent=2))
