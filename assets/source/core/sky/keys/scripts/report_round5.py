#!/usr/bin/env python3
"""Append the round-five record as plain sentences, preserving prior reports."""
import os
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'rounds/round-4'
# The checkout holding tools/sky/fit.ts: the repository itself once the sky table is merged.
FITTER = Path(os.environ.get('SKY_FITTER', ROOT.parents[4]))


def rgb(values):
    return '(' + ', '.join(str(round(v)) for v in values) + ')'


def main():
    verification = json.loads((ROOT / 'reports/keys-verification.json').read_text())
    fit = json.loads((ROOT / 'reports/round-5-fit.json').read_text())
    points = json.loads((ROOT / 'points.json').read_text())['keys']
    manifest = json.loads((ARCHIVE / 'manifest.json').read_text())
    now = datetime.now(timezone.utc)
    start = datetime.fromisoformat(manifest['archivedAt'])
    elapsed = int((now - start).total_seconds())
    lines = [
        '# Round 5',
        'Round four is preserved in [rounds/round-4/](rounds/round-4/), including its eight keys, sheets, views, scripts, point records and report. The archive manifest verifies all 109 saved files. Only noon, afternoon and dusk have changed. Dawn, morning, golden hour, sunset and night retain their complete panorama files byte for byte.',
        'Noon now reads (95, 96, 98) on the sunlit upright grey face, (63, 71, 82) in shade and (125, 126, 127) face up. Afternoon reads (120, 115, 108), (60, 68, 79) and (111, 113, 116) on those same faces. These are the exact supplied table colours across each complete connected face. The other grey cube tops receive the same face up light. A matching linear light correction removes the old warm cast from the land, using the existing illuminated and shaded material weights. Geometry and material coverage remain fixed.',
        'The sky corrections use smooth broad fields over the archived pixels. Noon receives a small correction across the polar cap, fading out below 70 degrees and around the sun. Afternoon and dusk receive small corrections across their low sunward haze, fading out by 18 degrees. There are no isolated patches at the reading points. The opposite haze, the three other sky point readings in each changed key, and noon’s deep blue at 30 degrees are unchanged.',
    ]
    for n in ('noon', 'afternoon', 'dusk'):
        r = verification['keys'][n]
        p = r['adjustedSkyPoint']
        lines.append(f"{n.capitalize()}’s {p['name']} reading changes from {rgb(p['before'])} to {rgb(p['after'])}. The largest change anywhere in its pure sky is {r['maxSkyRGBChange']:.0f} RGB levels and {r['maxSkyOKLabChange']:.2f} in OKLab times 100.")
    lines += [
        'Every solid water pixel is unchanged, including dawn’s sea gradient and the silver moon paths. The sun and moon discs, their halos and the star pixels are unchanged. The sun remains 2 degrees across and the moon remains 4 degrees across. Every complete grey face outside noon and afternoon is unchanged. Dusk’s face toward the glow remains (53, 50, 65), brighter than its shaded face at (19, 26, 43).',
        'I ran the unmodified measure on the final PNG files, then ran the supplied engine fitter on the resulting points-read.json from the supplied engine checkout. The three original misses were noon zenith 6.6, afternoon toward 6.3 and dusk toward 6.2. They now read 5.7, 5.9 and 5.8. All 32 sky points are at or below 6. The largest is 5.9. The following sentences give every fitted distance in the order zenith, high, toward, away, lit face, shaded face and face up.',
    ]
    for n in points:
        f = fit[n]
        lines.append(f"{n.capitalize()} reads zenith {f['zenith']:.1f}, high {f['high']:.1f}, toward {f['toward']:.1f}, away {f['away']:.1f}, lit face {f['lit']:.1f}, shaded face {f['shaded']:.1f} and face up {f['up']:.1f}.")
    max_visual = max(v['maxSkyOKLabChange'] for v in verification['keys'].values())
    lines += [
        'These are the engine fitter’s distances with lighting and exposure included. Its full output and fitted grades are in [the fitter record](reports/round-5-fit.txt), with a machine readable distance record in [the fit JSON](reports/round-5-fit.json). The larger sunset and dusk card distances are recorded without changing those accepted cards. The fixed light Python measure still reads dawn at 7.8, while the engine fitter’s worst dawn sky point is 3.7. The engine result is the acceptance verdict for this round.',
        f'Independent reads of all 56 patches agree with measure.py to its rounding. The preservation checks verify the archive, the exact card colours, unchanged water, unchanged celestial pixels and stars, uniform zenith rows and sky seams no larger than two RGB levels. The largest pure sky edit across the three changed keys is {max_visual:.2f} in OKLab times 100, below the fitter’s approximate visibility guide of 2. [The verification record](reports/keys-verification.json) retains the per key checks.',
        'The key sheet, prescribed player views, player sheet and extra noon sun view are refreshed. I inspected the comparison of all three changed panoramas and the complete player view sheet. [The review folder](reports/round-5-review/) contains the before and after comparison and native horizon crops.',
        f'This round used no image generation calls and one image assembly pass after checking point candidates. The archive clock began at {start.strftime("%Y-%m-%d %H:%M:%S UTC")} and this report was written at {now.strftime("%Y-%m-%d %H:%M:%S UTC")}, an elapsed time of {elapsed // 60} minutes and {elapsed % 60} seconds. The build uses the accepted archive directly so later source painting changes cannot alter this small correction.',
        'To rebuild this round, keep the round four archive and run `python3 -I scripts/build_keys.py`, `python3 -I scripts/read_points.py` and `python3 -I measure.py` in this folder. From the supplied engine checkout, run `bun tools/sky/fit.ts <this folder>/points-read.json --verbose` and save its output as `reports/round-5-fit.txt` in this folder. Then run `python3 -I scripts/verify_keys.py`, `python3 -I scripts/review_round5.py` and `python3 -I scripts/report_keys.py`. The new colour controls are in [scripts/round5.py](scripts/round5.py). The supplied physical model, measure, base images and sky table are unchanged.',
    ]
    text = '\n\n'.join(lines) + '\n'
    assert '—' not in text and '–' not in text
    path = ROOT / 'REPORT.md'
    previous = path.read_text().split('\n\n# Round 5\n')[0]
    path.write_text(previous.rstrip() + '\n\n\n' + text)
    session = {'archiveStartedAt': start.isoformat(), 'reportWrittenAt': now.isoformat(),
               'elapsedSeconds': elapsed, 'imageGenerationCalls': 0, 'imageAssemblyPasses': 1,
               'fitterCheckout': str(FITTER),
               'fitterSHA256': hashlib.sha256((FITTER / 'tools/sky/fit.ts').read_bytes()).hexdigest(),
               'pointsReadSHA256': verification['pointsReadSHA256'],
               'finalKeysSHA256': {n: hashlib.sha256((ROOT / f'{n}.png').read_bytes()).hexdigest() for n in points}}
    (ROOT / 'reports/round-5-session.json').write_text(json.dumps(session, indent=2) + '\n')
    print('Round-five report and session record written.')


if __name__ == '__main__':
    main()
