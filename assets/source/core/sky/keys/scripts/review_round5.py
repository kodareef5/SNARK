#!/usr/bin/env python3
"""Review round five against its immutable source, with no image regeneration."""
import site, sys
site.addsitedir(site.getusersitepackages())
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
from PIL import Image
from build_keys import ROOT, META, perspective, ICC, contact


def main():
    dest = ROOT / 'reports/round-5-review'
    dest.mkdir(exist_ok=True)
    paths = []
    for name in ('noon', 'afternoon', 'dusk'):
        for version, folder in [('round four', ROOT / 'rounds/round-4'), ('round five', ROOT)]:
            paths.append((name + ' / ' + version, folder / f'{name}.png'))
    contact(paths, dest / 'before-after.png', 1024, 512, 2, 'ROUND FIVE / BEFORE AND AFTER')
    k = next(k for k in META['keys'] if k['name'] == 'noon')
    a = np.array(Image.open(ROOT / k['file']), float)
    v = Image.fromarray(np.rint(perspective(a, k['sun']['heading'], k['sun']['elevation'])).clip(0, 255).astype('uint8'))
    v.save(ROOT / 'views/noon-sun.jpg', quality=95, subsampling=0, icc_profile=ICC)
    for name in ('noon', 'afternoon', 'dusk'):
        Image.open(ROOT / f'{name}.png').crop((0, 450, 2048, 610)).save(dest / f'{name}-horizon.png')
    print('Round-five review sheet, native horizon crops and noon sun view refreshed.')


if __name__ == '__main__':
    main()
