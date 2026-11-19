"""Install versioned media from a GitHub release into this checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RELEASE = json.loads((ROOT / "distribution/release.json").read_text())
CACHE = ROOT / "var/downloads" / RELEASE["tag"]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(item):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / item["file"]
    if path.is_file() and path.stat().st_size == item["bytes"] and sha256(path) == item["sha256"]:
        return path
    with tempfile.TemporaryDirectory(dir=CACHE) as staging:
        subprocess.run(["gh", "release", "download", RELEASE["tag"], "--repo", RELEASE["repository"],
                        "--pattern", path.name, "--dir", staging], check=True)
        part = Path(staging) / path.name
        if part.stat().st_size != item["bytes"] or sha256(part) != item["sha256"]:
            raise SystemExit(f"Checksum mismatch for {path.name}.")
        part.replace(path)
    return path


def extract(path, directory):
    with subprocess.Popen(["zstd", "-qdc", path], stdout=subprocess.PIPE) as decoder:
        subprocess.run(["tar", "-xf", "-", "-C", directory], stdin=decoder.stdout, check=True)
        decoder.stdout.close()
        if decoder.wait():
            raise SystemExit(f"Could not decode {path.name}.")


def install_files(archive):
    # Every release archive has a pinned digest and paths relative to the checkout.
    with tempfile.TemporaryDirectory(dir=CACHE) as tmp:
        staging = Path(tmp)
        extract(archive, staging)
        for file in staging.rglob("*"):
            if file.is_dir():
                continue
            target = ROOT / file.relative_to(staging)
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(file, target)
            except FileExistsError:
                if target.is_symlink() or not target.is_file() or sha256(target) != sha256(file):
                    raise SystemExit(f"Existing file differs: {target}. Back it up before installing this version.")


def install_kit(path, city):
    cut = path.name[len(city) + 1:-len(".tar.gz")]
    location = ROOT / "var/mapdata" / city
    if (location / cut).exists():
        # Do not unpack over a running build, raw downloads or locally edited layers.
        marker = location / cut / ".installed-sha256"
        if marker.exists() and marker.read_text().strip() == sha256(path) and (location / "current").resolve() == (location / cut / city).resolve():
            print(f"{city} kit already installed.")
            return
        raise SystemExit(f"Cut already exists at {location / cut}. Use a fresh checkout or move it aside.")
    subprocess.run(["bun", "tools/maps/kit.ts", "unpack", path], cwd=ROOT, check=True)
    (location / cut / ".installed-sha256").write_text(sha256(path) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["list", "art", "client", "map", "kit"])
    parser.add_argument("city", nargs="?")
    args = parser.parse_args()
    if (args.kind in ("map", "kit")) != bool(args.city):
        parser.error("supply one city for map or kit")
    for_list = args.kind == "list"
    if not for_list and RELEASE.get("status") == "draft":
        parser.exit(1, "The media release is a draft. Use list to review its contents.\n")
    selected = [item for item in RELEASE["assets"] if for_list or
                (item["kind"] == args.kind and item.get("city") == args.city)]
    if for_list and not RELEASE["assets"]:
        parser.exit(0, "No media has been packed for this source yet.\n")
    if not selected:
        parser.error("no match in this release; use list to see the available cities")
    for item in selected:
        print(f'{item["file"]}  {item["bytes"] / 2**20:.1f} MiB', flush=True)
        if for_list:
            if RELEASE.get("status") == "draft":
                print("  uploaded to draft" if item.get("uploaded") else "  pending upload")
            continue
        path = download(item)
        if args.kind == "kit":
            install_kit(path, args.city)
        else:
            install_files(path)
    if args.kind == "art":
        (ROOT / "assets/.art-installed").write_text(RELEASE["tag"] + "\n")


if __name__ == "__main__":
    main()
