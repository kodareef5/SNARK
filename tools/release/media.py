"""Install the binary art and the prepared map kits that distribution/release.json pins.

    bun run media list              what this commit pins, and what is installed here
    bun run media art [NAME ...]    every art archive, or those whose name starts with NAME (core-creatures-dodo, core-sfx)
    bun run media kit CITY          one city's prepared kit; then bun tools/maps/city.ts CITY builds its map

Files come from this repository's releases through GitHub CLI, are checked against their SHA-256 and kept
under var/downloads. A second run fetches only what is missing or has changed since the last one.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
RELEASE = json.loads((ROOT / "distribution/release.json").read_text())
ART = RELEASE.get("art", {"files": []})
KITS = RELEASE.get("kits", {"files": []})
CACHE = ROOT / "var/downloads"
INSTALLED = ROOT / "assets/.art-archives.json"     # which archive of each asset is in the checkout
RECEIPT = ROOT / "assets/.art-installed"           # the manifest's art id, once every archive is in: builds read it


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def cached(item):
    path = CACHE / item["file"]
    return path.is_file() and path.stat().st_size == item["bytes"] and sha256(path) == item["sha256"]


def fetch(release, items):
    """Download what the cache lacks, a batch to each call, and hold every file to its digest."""
    CACHE.mkdir(parents=True, exist_ok=True)
    missing = [item for item in items if not cached(item)]
    for start in range(0, len(missing), 40):
        batch = missing[start:start + 40]
        with tempfile.TemporaryDirectory(dir=CACHE) as staging:
            command = ["gh", "release", "download", release, "--repo", RELEASE["repository"], "--dir", staging]
            for item in batch:
                command += ["--pattern", item["file"]]
            if subprocess.run(command).returncode:
                raise SystemExit(f'Could not download from the "{release}" release. A draft release is only open to the repository\'s owner.')
            for item in batch:
                part = Path(staging) / item["file"]
                if not part.is_file() or part.stat().st_size != item["bytes"] or sha256(part) != item["sha256"]:
                    raise SystemExit(f'Checksum mismatch for {item["file"]}.')
                part.replace(CACHE / item["file"])
        print(f"  fetched {min(start + 40, len(missing))} of {len(missing)}", flush=True)


def install_archive(item, replace):
    """Unpack beside the tracked recipes. A file that differs is replaced only where this installer put it."""
    with tempfile.TemporaryDirectory(dir=CACHE) as tmp:
        staging = Path(tmp)
        with subprocess.Popen(["zstd", "-qdc", CACHE / item["file"]], stdout=subprocess.PIPE) as decoder:
            subprocess.run(["tar", "-xf", "-", "-C", staging], stdin=decoder.stdout, check=True)
            decoder.stdout.close()
            if decoder.wait():
                raise SystemExit(f'Could not decode {item["file"]}.')
        for file in sorted(staging.rglob("*")):
            if file.is_dir():
                continue
            target = ROOT / file.relative_to(staging)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() and not replace:
                if target.is_symlink() or not target.is_file() or sha256(target) != sha256(file):
                    raise SystemExit(f"Existing file differs: {target}. Move it aside, or pass --force to replace it.")
                continue
            os.replace(file, target)


def install_art(names, force):
    wanted = [f for f in ART["files"] if not names or any(f["name"].startswith(n) for n in names)]
    if not wanted:
        raise SystemExit("No art archive has that name. Run list to see them.")
    state = json.loads(INSTALLED.read_text()) if INSTALLED.exists() else {}
    todo = [f for f in wanted if state.get(f["name"]) != f["sha256"]]
    print(f'{len(wanted) - len(todo)} of {len(wanted)} archives already installed; {sum(f["bytes"] for f in todo) / 2**20:.0f} MiB to install')
    fetch(ART["release"], todo)
    for item in todo:
        install_archive(item, force or item["name"] in state)
        state[item["name"]] = item["sha256"]
        INSTALLED.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
    if all(state.get(f["name"]) == f["sha256"] for f in ART["files"]):
        RECEIPT.write_text(ART["id"] + "\n")
        print("All art is installed. bun run build now builds the painted game.")
    else:
        left = sum(state.get(f["name"]) != f["sha256"] for f in ART["files"])
        print(f"{left} archives are not installed yet, so builds still use generated geometry.")


def install_kit(city):
    found = [f for f in KITS["files"] if f["city"] == city]
    if not found:
        raise SystemExit("No kit for that city. Run list to see them.")
    item = found[0]
    location = ROOT / "var/mapdata" / city
    marker = location / item["cut"] / ".installed-sha256"
    if (location / item["cut"]).exists():
        # Do not unpack over a running build, raw downloads or locally edited layers.
        if marker.exists() and marker.read_text().strip() == item["sha256"]:
            print(f"{city} kit already installed.")
            return
        raise SystemExit(f'Cut already exists at {location / item["cut"]}. Use a fresh checkout or move it aside.')
    fetch(KITS["release"], [item])
    # kit.ts reads the city and the cut from the file's name.
    named = CACHE / "kits" / item["sha256"][:12] / f'{city}-{item["cut"]}.tar.gz'
    named.parent.mkdir(parents=True, exist_ok=True)
    if not named.exists():
        shutil.copyfile(CACHE / item["file"], named)
    subprocess.run(["bun", "tools/maps/kit.ts", "unpack", named], cwd=ROOT, check=True)
    marker.write_text(item["sha256"] + "\n")


def show():
    state = json.loads(INSTALLED.read_text()) if INSTALLED.exists() else {}
    if not ART["files"] and not KITS["files"]:
        print("No media has been packed for this source yet.")
        return
    done = sum(state.get(f["name"]) == f["sha256"] for f in ART["files"])
    print(f'art: {len(ART["files"])} archives, {sum(f["bytes"] for f in ART["files"]) / 2**30:.2f} GiB, {done} installed')
    for f in ART["files"]:
        mark = "installed" if state.get(f["name"]) == f["sha256"] else "changed" if f["name"] in state else ""
        print(f'  {f["name"]:44} {f["bytes"] / 2**20:8.1f} MiB  {mark}')
    print(f'kits: {len(KITS["files"])}, {sum(f["bytes"] for f in KITS["files"]) / 2**20:.0f} MiB')
    for f in KITS["files"]:
        print(f'  {f["city"]:44} {f["bytes"] / 2**20:8.1f} MiB  cut {f["cut"]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", choices=["list", "art", "kit"])
    parser.add_argument("names", nargs="*")
    parser.add_argument("--force", action="store_true", help="replace files in the checkout that differ from the archive's")
    args = parser.parse_args()
    if args.kind == "list":
        show()
    elif args.kind == "art":
        install_art(args.names, args.force)
    elif len(args.names) != 1:
        parser.error("supply one city")
    else:
        install_kit(args.names[0])


if __name__ == "__main__":
    main()
