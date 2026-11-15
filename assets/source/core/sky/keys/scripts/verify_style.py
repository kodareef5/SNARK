#!/usr/bin/env python3
"""Read the delivered PNGs, independently check their recorded measurements."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
def decode(v):
    v=np.asarray(v,dtype=float)/255
    return np.where(v<=.04045,v/12.92,((v+.055)/1.055)**2.4)
def eq(v):
    y=np.sum(decode(v)*[.2126,.7152,.0722])
    return float(255*(12.92*y if y<=.0031308 else 1.055*y**(1/2.4)-.055))

samples=json.loads((ROOT/'reports/samples.json').read_text())
palette=json.loads((ROOT/'style/palette.json').read_text())['keys']
checked=[]
for s in samples:
    im=Image.open(ROOT/s['sheet']);a=np.asarray(im)
    x,y=s['sheet_xy'];r=s['radius_px']
    actual=np.median(a[y-r:y+r+1,x-r:x+r+1],axis=(0,1)).astype(int).tolist()
    assert actual==s['rgb'],(s['key'],s['sample'],actual,s['rgb'])
    assert im.info.get('icc_profile'),'Missing sRGB profile'
    checked.append(actual)
errors=[];brightness=[]
for row in palette:
    for item,target in [('card_open',row['open_target']),('card_shade',row['shade_target']),('away_card_open',row['open_target']),('away_card_shade',row['shade_target'])]:
        errors.append(abs(eq(row[item])-target))
    z=eq(row['zenith']);ht=eq(row['horizon_toward']);ha=eq(row['horizon_away'])
    assert ht>z and ha>z,(row['key'],'horizon must be brighter than zenith')
    assert eq(row['cloud_lit'])>eq(row['cloud_shade']),(row['key'],'cloud lit must be brighter than cloud shade')
    brightness.append({'key':row['key'],'zenith':round(z,2),'horizon_toward':round(ht,2),'horizon_away':round(ha,2)})
assert max(errors)<1
assert palette[2]['sky30_away']==[150,190,230]
for direction in ['toward','away']:
    for row in palette:
        p=Image.open(ROOT/f"style/panels/{direction}/{row['key']}.png")
        assert p.size==(1024,512)
hero=Image.open(ROOT/'style/golden-hour-study.png')
assert hero.size==(2048,1024)
h=np.asarray(hero)
hero_cards=[]
for xy,target in [((.49,.896),64),((.635,.896),55)]:
    x,y=round(xy[0]*hero.width),round(xy[1]*hero.height)
    v=np.median(h[y-3:y+4,x-3:x+4],axis=(0,1)).astype(int)
    hero_cards.append({'rgb':v.tolist(),'neutral_equivalent':round(eq(v),2),'target':target})
    assert abs(eq(v)-target)<1
results={'result':'PASS','samples_verified_against_final_sheets':len(samples),'card_samples':len(errors),'max_card_error_srgb_levels':round(max(errors),4),'noon_30_away':[150,190,230],'noon_30_away_neutral_equivalent':round(eq([150,190,230]),2),'all_8_keys_horizons_brighter_than_zenith':True,'all_8_keys_lit_cloud_brighter_than_shade_cloud':True,'brightness':brightness,'hero_cards':hero_cards,'icc':'embedded sRGB','checks_scope':'Sampled painted regions; not a radiometric fit, horizon-wide monotonicity proof, or rendered scene validation.'}
(ROOT/'reports/verification.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
