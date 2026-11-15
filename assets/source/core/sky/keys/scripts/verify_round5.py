#!/usr/bin/env python3
"""Verify exact preservation, neutral table cards and the engine fitter."""
import site, sys, json, hashlib, re
site.addsitedir(site.getusersitepackages())
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import label
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT))
from build_keys import META, angle, read, dec, lum
from round5 import ARCHIVE, SKY_TARGETS, sky_weight, CARDS
from measure import oklab


def main():
    manifest = json.loads((ARCHIVE / 'manifest.json').read_text())['files']
    for path, digest in manifest.items():
        assert hashlib.sha256((ARCHIVE / path).read_bytes()).hexdigest() == digest, path
    for path in ('measure.py', 'physical.py', 'base/points.json', 'base/table.json'):
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == manifest[path], path
    ours = json.loads((ROOT / 'points.json').read_text())['keys']
    measured = json.loads((ROOT / 'points-read.json').read_text())['keys']
    table = json.loads((ROOT / 'base/table.json').read_text())['keys']
    build = json.loads((ROOT / 'reports/key-build.json').read_text())
    oldbuild = json.loads((ARCHIVE / 'reports/key-build.json').read_text())
    fit = {}
    for line in (ROOT / 'reports/round-5-fit.txt').read_text().splitlines():
        match = re.match(r'(\w+)\s+fitted at ([\d.-]+) degrees: (.*)', line)
        if match:
            fit[match[1]] = {p: float(v) for p, v in re.findall(r'(\w+) ([\d.]+)', match[3])}
    assert set(fit) == {k['name'] for k in META['keys']}
    evidence = {'archiveFilesVerified': len(manifest), 'suppliedInputsUnchanged': True,
                'verdict': 'Supplied engine fitter, with light and exposure fitted.', 'keys': {}}
    for k in META['keys']:
        n = k['name']
        im = Image.open(ROOT / k['file'])
        a = np.array(im, float)
        old = np.array(Image.open(ARCHIVE / k['file']), float)
        base = np.array(Image.open(ROOT / 'base' / k['file']).convert('RGB'))
        masks = np.load(ARCHIVE / 'reports' / f'{n}-surface-masks.npz')
        changed = np.any(a != old, axis=-1)
        solid = ~masks['background'] & ~masks['mixedEdge']
        assert im.mode == 'RGB' and im.size == (2048, 1024) and im.info.get('icc_profile')
        assert np.ptp(a[0], axis=0).max() == 0
        seam = float(np.max(np.abs(a[:505, 0] - a[:505, -1])))
        assert seam <= 2, (n, 'seam', seam)
        assert not np.any(changed[masks['water']]), (n, 'solid water')
        assert build[n]['bodies'] == oldbuild[n]['bodies'], (n, 'celestial definitions')
        assert build[n]['stars'] == oldbuild[n]['stars'], (n, 'stars')
        if n not in SKY_TARGETS:
            assert hashlib.sha256((ROOT / k['file']).read_bytes()).hexdigest() == manifest[k['file']]
        else:
            allowed = sky_weight(k) > 0
            assert not np.any(changed[masks['sky'] & ~allowed]), (n, 'unrequested sky')
            for p in ('zenith', 'high', 'toward', 'away'):
                if p != SKY_TARGETS[n][0]:
                    assert np.array_equal(read(a, k['points'][p]), read(old, k['points'][p])), (n, p)
        if n not in ('noon', 'afternoon'):
            assert not np.any(changed[solid]), (n, 'solid terrain')
        faces = {}
        for p in CARDS:
            pt = k['points'][p]
            labs, _ = label(np.all(base == base[pt['y'], pt['x']], axis=-1))
            region = labs == labs[pt['y'], pt['x']]
            if n in ('noon', 'afternoon'):
                assert np.all(a[region] == table[n][p]), (n, p, 'table colour')
            else:
                assert np.array_equal(a[region], old[region]), (n, p, 'preserved face')
            faces[p] = {'RGB': ours[n][p], 'pixels': int(region.sum())}
        for b in build[n]['bodies']:
            limit = 12 if b['body'] == 'sun' else (19 if n == 'night' else 3.5)
            protected = masks['sky'] & (angle(k[b['body']]) <= limit)
            assert not np.any(changed[protected]), (n, 'body or halo')
        for s in build[n]['stars']:
            assert not np.any(changed[masks['sky'] & (angle(s) < .4)]), (n, 'star pixels')
        max_fit = max(fit[n][p] for p in ('zenith', 'high', 'toward', 'away'))
        assert max_fit <= 6, (n, 'engine sky fit', max_fit)
        assert not measured[n]['notes'], (n, measured[n]['notes'])
        agreement = max(np.max(np.abs(np.array(ours[n][p]) - measured[n]['points'][p])) for p in ours[n])
        assert agreement < .051, (n, 'independent point reader')
        sky_change = np.linalg.norm(oklab(a[masks['sky']]) - oklab(old[masks['sky']]), axis=-1)
        record = {'engineFitDistances': fit[n], 'worstSkyDistance': max_fit,
                  'fixedLightMeasure': measured[n]['afterBestGrade'],
                  'changedPixels': int(changed.sum()), 'changedSolidWaterPixels': 0,
                  'changedSolidTerrainPixels': int(changed[solid].sum()),
                  'maxSkyRGBChange': float(np.abs(a[masks['sky']] - old[masks['sky']]).max()),
                  'maxSkyOKLabChange': round(float(sky_change.max()), 4),
                  'maxSkySeam': seam, 'sampleAgreementMax': round(float(agreement), 4),
                  'cards': faces, 'celestialPixelsPreserved': True, 'starPixelsPreserved': True}
        if n in SKY_TARGETS:
            p = SKY_TARGETS[n][0]
            record['adjustedSkyPoint'] = {'name': p, 'before': read(old, k['points'][p]).tolist(),
                                          'after': read(a, k['points'][p]).tolist()}
        if n == 'noon':
            ladder = [float(lum(dec(read(a, {'x': k['points']['high']['x'], 'y': round((90-e)/180*1024-.5)})))) for e in range(10,81)]
            assert 20 <= 10 + int(np.argmin(ladder)) <= 40
        for direction in ('toward', 'away'):
            view = Image.open(ROOT / 'views' / f'{n}-{direction}.jpg')
            assert view.size == (1280, 720) and view.mode == 'RGB'
        evidence['keys'][n] = record
    assert lum(dec(ours['dusk']['lit'])) > lum(dec(ours['dusk']['shaded']))
    evidence['pointsReadSHA256'] = hashlib.sha256((ROOT / 'points-read.json').read_bytes()).hexdigest()
    (ROOT / 'reports/keys-verification.json').write_text(json.dumps(evidence, indent=2) + '\n')
    (ROOT / 'reports/round-5-fit.json').write_text(json.dumps(fit, indent=2) + '\n')
    print('All round-five checks passed.')
    print(json.dumps({n: r['worstSkyDistance'] for n, r in evidence['keys'].items()}))


if __name__ == '__main__':
    main()
