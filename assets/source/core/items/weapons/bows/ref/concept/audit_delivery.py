"""Check final canvases, alpha masks, background and expected deliverable inventory."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image,ImageOps

ROOT=Path(__file__).resolve().parent
spec=json.loads((ROOT/'checks'/'projection_spec.json').read_text())
names=[n+s+'.png' for n in spec['views'] for s in ['', '_mask']]+['lineup.png','hero.png','read_sizes.png']
manifest={}
for name in names:
    p=ROOT/name
    with Image.open(p) as im:
        assert im.size==(1254,1254),(name,im.size)
        manifest[name]={'size':list(im.size),'mode':im.mode,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
for name,cfg in spec['views'].items():
    rgb=np.asarray(Image.open(ROOT/(name+'.png')).convert('RGB'))
    a=np.asarray(Image.open(ROOT/(name+'_mask.png')))
    assert np.all(rgb[a==0]==[214,212,206]),'Non-flat background: '+name
    source=Image.open(ROOT/'checks'/'render_sources'/(name+'.png')).convert('RGBA')
    if cfg['mirror_x']:source=ImageOps.mirror(source)
    rgba=np.array(source)
    if name.startswith('bow_grip') or name=='bow_ear_side':rgba[:237,:,3]=0;rgba[1017:,:,3]=0
    assert np.array_equal(rgba[:,:,3],a),'Mask mismatch: '+name
    src=Image.fromarray(rgba);expected=Image.new('RGB',(1254,1254),(214,212,206));expected.paste(src,(0,0),src.getchannel('A'))
    assert np.array_equal(rgb,np.asarray(expected)),'Colour/coverage mismatch: '+name
for name in ['REPORT.md','build_concepts.py','finish_sheets.py','check_model.py','finish_validation.py','audit_delivery.py','rebuild.py','concept_models.blend']:
    p=ROOT/name;assert p.is_file(),name
    manifest[name]={'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
(ROOT/'checks'/'delivery_manifest.json').write_text(json.dumps({'passed':True,'final_png_count':len(names),'files':manifest},indent=2))
print('PASS: 21 final PNGs, 1254-square canvases, exact background, matching colour and mask coverage, all rebuild sources present.')
