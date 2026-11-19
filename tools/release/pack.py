"""Pack the binary art and the map kits as release files and pin them in distribution/release.json.

    python3 tools/release/pack.py art OUTPUT [--root ROOT]
    python3 tools/release/pack.py kits OUTPUT [--from var/kits]

Art is packed one archive to an asset: a creature, a vehicle, a set of sounds. A kit is one file to a city.
Each file is named for its own bytes (NAME.<12 hex of its SHA-256>.tar.zst), so a release can hold old files
beside new ones, an asset that did not change is never uploaded again, and a clone at any commit finds
exactly the files its manifest names. Packing the same files twice gives the same archive.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "distribution/release.json"


def asset(path):
    """The archive a binary input belongs to: assets/source/core/creatures/dodo/... is core-creatures-dodo."""
    folders = path.split("/")[1:-1]
    if folders[0] == "raw":
        return "-".join(folders[:2])
    folders = folders[1:]
    return "-".join(folders[:3] if folders[:1] == ["core"] else folders[:2])


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_manifest(update):
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    manifest.update(update)
    # One file to a line, so a change to one asset is a change to one line.
    lines = ["{"]
    keys = list(manifest)
    for key in keys:
        value = manifest[key]
        comma = "," if key != keys[-1] else ""
        if isinstance(value, dict) and "files" in value:
            lines.append(f"  {json.dumps(key)}: {{")
            for k, v in value.items():
                if k != "files":
                    lines.append(f"    {json.dumps(k)}: {json.dumps(v)},")
            lines.append('    "files": [')
            lines += [f"      {json.dumps(f)}{',' if f is not value['files'][-1] else ''}" for f in value["files"]]
            lines.append(f"    ]\n  }}{comma}")
        else:
            lines.append(f"  {json.dumps(key)}: {json.dumps(value)}{comma}")
    MANIFEST.write_text("\n".join(lines) + "\n}\n")


def pack_art(output, root):
    groups = defaultdict(list)
    for path in (ROOT / "distribution/source-files.txt").read_text().splitlines():
        groups[asset(path)].append(path)
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for name, paths in sorted(groups.items()):
        part = output / (name + ".partial")
        with part.open("wb") as dest:
            # One thread and fixed tar fields: the same files give the same bytes.
            with subprocess.Popen(["zstd", "-q", "-T1", "-3", "-c"], stdin=subprocess.PIPE, stdout=dest) as proc:
                with tarfile.open(fileobj=proc.stdin, mode="w|", format=tarfile.GNU_FORMAT) as tar:
                    for path in sorted(paths):
                        info = tarfile.TarInfo(path)
                        info.size = (root / path).stat().st_size
                        info.mode = 0o644
                        with (root / path).open("rb") as source:
                            tar.addfile(info, source)
                proc.stdin.close()
                if proc.wait():
                    raise SystemExit(f"Compression failed for {name}")
        digest = sha256(part)
        target = output / f"{name}.{digest[:12]}.tar.zst"
        part.replace(target)
        files.append({"name": name, "file": target.name, "bytes": target.stat().st_size, "sha256": digest})
    listing = "\n".join(f'{f["name"]} {f["sha256"]}' for f in files)
    # The id names this exact set of archives. The installer leaves it in assets/.art-installed once all are in place.
    write_manifest({"art": {"release": "art", "id": hashlib.sha256(listing.encode()).hexdigest()[:16], "files": files}})
    print(f'{len(files)} art archives, {sum(f["bytes"] for f in files) / 2**30:.2f} GiB, in {output}')


def pack_kits(output, source):
    output.mkdir(parents=True, exist_ok=True)
    files = []
    for record in sorted(source.glob("*-*.json")):
        kit = json.loads(record.read_text())
        if "cut" not in kit:
            continue
        packed = record.with_name(f'{kit["city"]}-{kit["cut"]}.tar.gz')
        digest = sha256(packed)
        target = output / f'{kit["city"]}-{kit["cut"]}.{digest[:12]}.tar.gz'
        shutil.copyfile(packed, target)
        files.append({"city": kit["city"], "cut": kit["cut"], "file": target.name, "bytes": target.stat().st_size,
                      "sha256": digest, "made": kit["made"]})
    write_manifest({"kits": {"release": "map-kits", "files": files}})
    print(f'{len(files)} kits, {sum(f["bytes"] for f in files) / 2**20:.0f} MiB, in {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", choices=["art", "kits"])
    parser.add_argument("output", type=Path)
    parser.add_argument("--root", type=Path, default=ROOT, help="where the binary inputs are installed (art)")
    parser.add_argument("--from", dest="source", type=Path, default=ROOT / "var/kits", help="where kit.ts packed the kits")
    args = parser.parse_args()
    if args.kind == "art":
        pack_art(args.output, args.root)
    else:
        pack_kits(args.output, args.source)


if __name__ == "__main__":
    main()
