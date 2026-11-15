"""Run the supplied game renderer with the delivered, accepted maps.

The supplied look.sh recomposes missing intermediate wing layers as flat grey.
This Python wrapper freezes tex/* into a private temporary tree instead. It adapts
only shot lists / resolution in a temporary copy of the existing renderer; no
renderer implementation or repository TypeScript is edited.
"""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ASSET = HERE.parent.parent
ROOT = ASSET.parents[4]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['close','20m','60m','baseline'],default='close')
    parser.add_argument('--out',type=Path)
    args=parser.parse_args()
    out=(args.out or HERE/'look'/args.mode).resolve()
    out.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ptera-layers-') as temp:
        temp=Path(temp)
        tree=temp/'tree'
        target=tree/'core/creatures/pteranodon'
        shutil.copytree('/private/tmp/ptera-look/tree/core/creatures/pteranodon',target)
        for src in (ASSET/'tex').glob('pteranodon*.png'):
            shutil.copy2(src,target/'tex'/src.name)
        if args.mode=='baseline':
            for suffix in ['hurt','decay']:
                for src in (target/'tex').glob(f'*_{suffix}.png'):
                    src.unlink()
        code=(ASSET/'tex/paint/look_asset.ts').read_text().replace('../../../../../../../',str(ROOT)+'/')
        (target/'asset.ts').write_text(code)
        code=(ASSET/'tex/paint/look.ts').read_text().replace('../../../../../../../',str(ROOT)+'/')
        original='["three_quarter", "above", "side", "head", "rider", "inner_wing", "under_wing"]'
        if args.mode in ['close','baseline']:
            code=code.replace(original,'["three_quarter", "above", "below", "side", "head", "rider", "inner_wing", "under_wing", "feet", "carcass"]')
            code=code.replace('const SHOTS: Record<string, Shot> = {','const SHOTS: Record<string, Shot> = {\n  carcass: [[0, 0.70, -0.25], 0.67, 95, -65, false],')
        else:
            side=280 if args.mode=='20m' else 93
            code=code.replace('const side = 300;',f'const side = {side};')
            code=code.replace('const SS = 2;','const SS = 1;')
            code=code.replace(original,'["below", "above"]')
        (temp/'review.ts').write_text(code)
        subprocess.run(['bun',str(temp/'review.ts'),'--source',str(tree),'--out',str(out),'--stages'],cwd=ROOT,check=True)
    (out/'render.json').write_text(json.dumps({'mode':args.mode,'accepted_maps':True,
        'layer_storage':256,'native_span_px':{'20m':270,'60m':90}.get(args.mode),
        'renderer':'tex/paint/look.ts, same engine; adapted shots only'},indent=2)+'\n')


if __name__=='__main__':
    main()
