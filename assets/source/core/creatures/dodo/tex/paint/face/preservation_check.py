"""Compare against the accepted treatments rebuilt on the same current bakes."""
import site
site.addsitedir(site.getusersitepackages())
import sys
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import argparse,json
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
import paint

ROOT=Path(__file__).resolve().parent
QA=ROOT/'checks'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--build-baseline',action='store_true');args=parser.parse_args()
    baseline=QA/'skin_on_current_bakes'
    if args.build_baseline:
        baseline.mkdir(exist_ok=True)
        paint.ROOT=baseline
        paint.margin.apply=lambda *a:(a[4],[],{'disabled_for_preservation_check':True})
        paint.paint()
        paint.ROOT=ROOT
    before=baseline/'layers';after=ROOT/'layers'
    old=json.loads((before/'layers.json').read_text());new=json.loads((after/'layers.json').read_text())
    assert all(new['inputs_sha256'][k]==v for k,v in old['inputs_sha256'].items())
    _,piece,pos,ids,regions,mm=paint.load_geometry()
    own=np.isin(piece,[ids[k] for k in paint.NAMES])
    changed=own&np.any(np.asarray(Image.open(after/'dodo_regions.png'))!=regions,axis=-1)
    untouched=own&(distance_transform_edt(~changed)>26)
    fixed=np.isin(piece,[ids['brow_l'],ids['pouch_in']])
    results={}
    for key in ['base','height','rough','occlusion','regions']:
        a=np.asarray(Image.open(after/f'dodo_{key}.png'));b=np.asarray(Image.open(before/f'dodo_{key}.png'))
        same=bool(np.array_equal(a[untouched],b[untouched]))
        fixed_same=bool(np.array_equal(a[fixed],b[fixed]))
        assert same and fixed_same,(key,same,fixed_same)
        results[key]=dict(outside_margin_and_local_filter_exact=same,brow_and_inner_pouch_exact=fixed_same)
    report=dict(passed=True,reference='Accepted treatments recomputed on identical current bakes, margin disabled.',
                compared_unchanged_texels=int(untouched.sum()),filter_exclusion_texels=26,maps=results)
    (QA/'preservation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

if __name__=='__main__':main()
