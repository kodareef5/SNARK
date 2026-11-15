"""Run the supplied game renderer with the delivered, accepted maps.

The supplied look.sh recomposes missing intermediate wing layers as flat grey.
This Python wrapper freezes tex/* into a private temporary tree instead. It adapts
only shot lists / resolution in a temporary copy of the existing renderer; no
renderer implementation or repository TypeScript is edited.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ASSET = HERE.parent.parent
ROOT = ASSET.parents[4]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['close','marks','20m','60m','baseline'],default='close')
    parser.add_argument('--out',type=Path)
    parser.add_argument('--storage',type=int,choices=[256,512],default=256,
                        help='Temporary asset layer budget; production files stay unchanged')
    args=parser.parse_args()
    out=(args.out or HERE/'look'/args.mode).resolve()
    out.mkdir(parents=True,exist_ok=True)
    input_hashes={}
    with tempfile.TemporaryDirectory(prefix='ptera-layers-') as temp:
        temp=Path(temp)
        tree=temp/'tree'
        target=tree/'core/creatures/pteranodon'
        shutil.copytree('/private/tmp/ptera-look/tree/core/creatures/pteranodon',target)
        for src in (ASSET/'tex').glob('pteranodon*.png'):
            shutil.copy2(src,target/'tex'/src.name)
            input_hashes[src.name]=hashlib.sha256((target/'tex'/src.name).read_bytes()).hexdigest()
        if args.mode=='baseline':
            for suffix in ['hurt','decay']:
                for src in (target/'tex').glob(f'*_{suffix}.png'):
                    src.unlink()
        code=(ASSET/'tex/paint/look_asset.ts').read_text().replace('../../../../../../../',str(ROOT)+'/')
        code=code.replace('layer: 256',f'layer: {args.storage}')
        (target/'asset.ts').write_text(code)
        code=(ASSET/'tex/paint/look.ts').read_text().replace('../../../../../../../',str(ROOT)+'/')
        original='["three_quarter", "above", "side", "head", "rider", "inner_wing", "under_wing"]'
        if args.mode in ['close','baseline']:
            code=code.replace(original,'["three_quarter", "above", "below", "side", "head", "rider", "inner_wing", "under_wing", "feet", "carcass"]')
            code=code.replace('const SHOTS: Record<string, Shot> = {','const SHOTS: Record<string, Shot> = {\n  carcass: [[0, 0.70, -0.25], 0.67, 95, -65, false],')
        elif args.mode=='marks':
            code=code.replace(original,'["tear_upper", "tear_under", "puncture_upper", "puncture_under", "leather_upper"]')
            code=code.replace('const SHOTS: Record<string, Shot> = {','''const SHOTS: Record<string, Shot> = {
  tear_upper: [[0.61, 0.80, -0.67], 0.34, 180, 75, false],
  tear_under: [[0.61, 0.80, -0.67], 0.34, 0, -75, true],
  puncture_upper: [[1.07, 0.85, -0.36], 0.21, 180, 75, false],
  puncture_under: [[1.07, 0.85, -0.36], 0.21, 0, -75, true],
  leather_upper: [[1.47, 0.85, -0.32], 0.51, 180, 75, false],''')
        else:
            side=280 if args.mode=='20m' else 93
            code=code.replace('const side = 300;',f'const side = {side};')
            code=code.replace('const SS = 2;','const SS = 1;')
            code=code.replace(original,'["below", "above"]')
        (temp/'review.ts').write_text(code)
        subprocess.run(['bun',str(temp/'review.ts'),'--source',str(tree),'--out',str(out),'--stages'],cwd=ROOT,check=True)
    (out/'render.json').write_text(json.dumps({'mode':args.mode,'accepted_maps':True,
        'layer_storage':args.storage,'native_span_px':{'20m':270,'60m':90}.get(args.mode),
        'texture_sha256':input_hashes,
        'renderer':'tex/paint/look.ts, same engine; adapted shots only'},indent=2)+'\n')


if __name__=='__main__':
    main()
