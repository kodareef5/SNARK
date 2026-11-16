"""Remake every accepted take of an asset from its recipes.json and compare with the kept file.

    tools/sound/.venv/bin/python tools/sound/remake.py <asset sound folder> [--only FILE]

Remade files go to tools/sound/.work/remake/, one per source file. Each take (cut.py) is cut from its
remade source as its recipe says and compared sample for sample. Exits non-zero if any take is not
identical. Takes from the torch backend are never identical (the compiled DiT varies between processes).
"""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import cut  # noqa: E402
import generate  # noqa: E402
import models  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--only", action="append")
    a = ap.parse_args()
    home = Path(a.folder).resolve()
    recipes = json.loads((home / "recipes.json").read_text())["takes"]
    out = models.WORK / "remake" / home.relative_to(HERE.parent.parent)
    jobs, kept_by_job = [], {}
    for rel, r in recipes.items():
        if a.only and rel not in a.only:
            continue
        back = r.get("backend", "mlx")
        if back != models.backend():
            print(f"skipped    {rel}  (made on {back}; this machine runs {models.backend()})")
            continue
        source = r["cut"]["source_file"]
        made = str(out / r["slot"] / source)
        if made not in kept_by_job:
            kept_by_job[made] = []
            jobs.append({"slot": r["slot"], "model": r["model"], "backend": back, "prompt_id": r["prompt_id"],
                         "prompt": r["prompt"], "negative": r["negative_prompt"], "seconds": r["seconds"],
                         "seed": r["seed"], "settings": r["settings"], "out": made})
        kept_by_job[made].append((rel, r))
        pinned = models.spec(r["model"], back)["revision"]
        if r["revision"] != pinned:
            print(f"warning: {rel} was made with {r['revision']}, tools/sound pins {pinned}")
    models.WORK.mkdir(parents=True, exist_ok=True)
    generate.run_jobs(jobs)
    bad = total = 0
    for made, kept_list in kept_by_job.items():
        for rel, r in kept_list:
            total += 1
            kept = home / rel
            same, c = cut.same_cut(made, kept, r["cut"])
            if generate.sha256(made) == r["source_sha256"] or same:
                print(f"identical  {rel}")
                continue
            bad += 1
            print(f"differs    {rel}  {json.dumps(c)}")
    print(f"{total - bad} of {total} identical")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
