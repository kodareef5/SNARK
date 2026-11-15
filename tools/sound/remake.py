"""Remake every accepted take of an asset from its recipes.json and compare with the kept file.

    tools/sound/.venv/bin/python tools/sound/remake.py <asset sound folder> [--only FILE]

Remade files go to tools/sound/.work/remake/. Each take is reported as identical (same bytes,
or same samples: float WAVs from soundfile carry a PEAK chunk stamped with the write time) or,
if not, by how close it is: largest sample difference, correlation, and the mean difference of
the two log-mel spectrograms in dB. Exits non-zero if any take is not identical.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import generate  # noqa: E402
import models  # noqa: E402
import measure  # noqa: E402
import review  # noqa: E402


def compare(a, b):
    xa, sra = measure.load(a)
    xb, srb = measure.load(b)
    if sra != srb or xa.shape != xb.shape:
        return {"same_shape": False}
    ma, mb = xa.mean(axis=1), xb.mean(axis=1)
    corr = float(np.corrcoef(ma, mb)[0, 1]) if ma.std() > 0 and mb.std() > 0 else 0.0
    Ma, _, _ = review.melspec(ma, sra)
    Mb, _, _ = review.melspec(mb, srb)
    top = max(Ma.max(), Mb.max())
    Ma, Mb = np.maximum(Ma, top - 80), np.maximum(Mb, top - 80)
    return {"same_shape": True, "max_abs": float(np.abs(xa - xb).max()), "corr": round(corr, 6),
            "mel_db": round(float(np.abs(Ma - Mb).mean()), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--only", action="append")
    a = ap.parse_args()
    home = Path(a.folder).resolve()
    recipes = json.loads((home / "recipes.json").read_text())["takes"]
    out = models.WORK / "remake" / home.relative_to(HERE.parent.parent)
    jobs = []
    for rel, r in recipes.items():
        if a.only and rel not in a.only:
            continue
        jobs.append({"slot": r["slot"], "model": r["model"], "prompt_id": r["prompt_id"], "prompt": r["prompt"],
                     "negative": r["negative_prompt"], "seconds": r["seconds"], "seed": r["seed"],
                     "settings": r["settings"], "out": str(out / rel)})
        if r["revision"] != models.MODELS[r["model"]]["revision"]:
            print(f"warning: {rel} was made with {r['revision']}, tools/sound pins {models.MODELS[r['model']]['revision']}")
    models.WORK.mkdir(parents=True, exist_ok=True)
    generate.run_jobs(jobs)
    bad = 0
    for job in jobs:
        rel = str(Path(job["out"]).relative_to(out))
        kept, made = home / rel, Path(job["out"])
        if generate.sha256(kept) == generate.sha256(made):
            print(f"identical  {rel}")
            continue
        c = compare(kept, made)
        if c.get("same_shape") and c["max_abs"] == 0.0:
            # float WAVs carry a PEAK chunk with a write time; the samples are what matter
            print(f"identical  {rel}  (same samples; header time differs)")
            continue
        bad += 1
        print(f"differs    {rel}  {json.dumps(c)}")
    print(f"{len(jobs) - bad} of {len(jobs)} identical")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
