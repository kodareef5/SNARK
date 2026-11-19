"""Recreate the editable-art and review archives from an installed source tree."""
import argparse
from collections import defaultdict
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]


def group(path):
    if path.startswith("planning/"):
        return "review-media"
    for name in ("nodes", "vehicles", "creatures", "structures", "sfx", "world"):
        if path.startswith(f"assets/source/core/{name}/"):
            return "art-" + name
    return "art-other"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    groups = defaultdict(list)
    for path in (ROOT / "distribution/source-files.txt").read_text().splitlines():
        groups[group(path)].append(path)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, paths in sorted(groups.items()):
        target = args.output / (name + ".tar.zst")
        with target.with_suffix(".partial").open("wb") as dest:
            with subprocess.Popen(["zstd", "-q", "-T2", "-3", "-c"], stdin=subprocess.PIPE, stdout=dest) as proc:
                with tarfile.open(fileobj=proc.stdin, mode="w|") as tar:
                    for path in paths:
                        tar.add(args.root / path, arcname=path, recursive=False)
                proc.stdin.close()
                if proc.wait():
                    raise SystemExit(f"Compression failed for {name}")
        target.with_suffix(".partial").replace(target)
        print(target)


if __name__ == "__main__":
    main()
