#!/usr/bin/env python3
"""Validate the saved deliverables independently of the build's arrays."""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
NAMES = ('contour', 'contour_plain', 'down', 'flight', 'tail')
ALLOWED = {(255, 0, 0), (255, 0, 255), (255, 255, 0), (0, 0, 0)}

for name in NAMES:
    with Image.open(ROOT / (name + '.png')) as base, Image.open(ROOT / (name + '_regions.png')) as regions:
        assert base.mode == regions.mode == 'RGBA', name
        assert base.size == regions.size == (1024, 1024), name
        b, r = np.array(base), np.array(regions)
    alpha = b[..., 3]
    assert np.array_equal(alpha, r[..., 3]), name
    assert np.array_equal(b[..., 0], b[..., 1]), name
    assert np.array_equal(b[..., 1], b[..., 2]), name
    assert not any(np.any(edge) for edge in (
        alpha[:64], alpha[-64:], alpha[:, :64], alpha[:, -64:])), name
    codes = {tuple(map(int, v)) for v in np.unique(r[..., :3].reshape(-1, 3), axis=0)}
    assert codes <= ALLOWED, (name, codes)
    assert len(codes - {(0, 0, 0)}) <= 2, name
    assert np.count_nonzero(alpha == 255) > 100000, name
    assert np.any((alpha > 0) & (alpha < 255)), name
    for suffix in ('', '_regions'):
        with Image.open(ROOT / (name + suffix + '.png')) as image:
            image.verify()
    if name in ('contour', 'tail'):
        # Ignore nearly invisible separated tip filaments when counting bands.
        cream = np.all(r[:, 512, :3] == [255, 255, 0], axis=1)
        ys = np.flatnonzero(cream & (alpha[:, 512] > 32))
        runs = np.split(ys, np.flatnonzero(np.diff(ys) > 1) + 1)
        assert len(runs) == (1 if name == 'contour' else 2), name
        print(name, 'cream spans:', [(int(v[0]), int(v[-1])) for v in runs])
    print(name, 'PASS')

for filename in ('preview.png', 'preview_game.png', 'preview_alternate_dyes.png'):
    with Image.open(ROOT / filename) as image:
        print(filename, image.size, image.mode)
        image.verify()
for filename in ('REPORT.md', 'build_feathers.py', 'generation_prompts.json', 'validation.json'):
    assert (ROOT / filename).is_file(), filename
print('PASS: ten texture exports, three previews, and supporting files.')
