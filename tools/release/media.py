"""Install the binary art and the prepared map kits that distribution/release.json pins.

    bun run media list              what this commit pins, and what is installed here
    bun run media art [NAME ...]    every art archive, or those whose name starts with NAME (core-creatures-dodo, core-sfx)
    bun run media kit CITY          one city's prepared kit; then bun tools/maps/city.ts CITY builds its map

Files come from this repository's releases through GitHub CLI and are checked against their SHA-256. Every checkout
on the machine shares them, under ~/.cache/snark or SNARK_CACHE: the downloads, and one unpacked copy of each art
archive, whose files a checkout hard-links. Those files are read-only, so writing into one fails; a tool that writes
a new file and renames it over one changes this checkout alone. `art NAME --copy` gives this checkout writable
copies of an asset it will rebuild. A second run fetches only what is missing or has changed since the last one.
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
SHARED = Path(os.environ.get("SNARK_CACHE") or Path.home() / ".cache/snark")
CACHE = SHARED / "downloads"
STORE = SHARED / "art"                             # each art archive unpacked once, its files read-only
INSTALLED = ROOT / "assets/.art-archives.json"     # which archive of each asset is in the checkout
RECEIPT = ROOT / "assets/.art-installed"           # the manifest's art id, once every archive is in


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def place(source, target, copy=False):
    """Put source at target whole: a hard link, or a copy where one is asked for or no link can be made."""
    part = target.with_name(f"{target.name}.{os.getpid()}.part")
    try:
        if copy:
            raise OSError
        os.link(source, part)
    except OSError:
        shutil.copyfile(source, part)
    os.replace(part, target)


def cached(item):
    path = CACHE / item["file"]
    before = ROOT / "var/downloads" / item["file"]     # where a checkout kept its own downloads
    if not path.exists() and before.is_file():
        CACHE.mkdir(parents=True, exist_ok=True)
        place(before, path)
    return path.is_file() and path.stat().st_size == item["bytes"] and sha256(path) == item["sha256"]


def fetch(release, items):
    """Download what the cache lacks, a batch to each call, and hold every file to its digest. An archive is in the
    manifest's repository unless its own entry names another (art kept private until it is published)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    missing = [item for item in items if not cached(item)]
    where = lambda item: item.get("repository", RELEASE["repository"])
    batches = [(repo, group[start:start + 40])
               for repo in sorted({where(item) for item in missing})
               for group in [[item for item in missing if where(item) == repo]]
               for start in range(0, len(group), 40)]
    done = 0
    for repo, batch in batches:
        with tempfile.TemporaryDirectory(dir=CACHE) as staging:
            command = ["gh", "release", "download", release, "--repo", repo, "--dir", staging]
            for item in batch:
                command += ["--pattern", item["file"]]
            if subprocess.run(command).returncode:
                raise SystemExit(f'Could not download from the "{release}" release of {repo}. A private repository or a draft '
                                 "release is only open to those it is shared with.")
            for item in batch:
                part = Path(staging) / item["file"]
                if not part.is_file() or part.stat().st_size != item["bytes"] or sha256(part) != item["sha256"]:
                    raise SystemExit(f'Checksum mismatch for {item["file"]}.')
                part.replace(CACHE / item["file"])
        done += len(batch)
        print(f"  fetched {done} of {len(missing)}", flush=True)


def home(name, digest):
    """Where the store keeps an archive's unpacked files."""
    return STORE / f"{name}.{digest[:12]}"


def unpack(item):
    """Unpack the archive into the store, unless it is there. The folder appears whole, under its final name."""
    folder = home(item["name"], item["sha256"])
    if folder.is_dir():
        return
    STORE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=STORE) as tmp:
        staging = Path(tmp) / "files"
        staging.mkdir()
        with subprocess.Popen(["zstd", "-qdc", CACHE / item["file"]], stdout=subprocess.PIPE) as decoder:
            subprocess.run(["tar", "-xf", "-", "-C", staging], stdin=decoder.stdout, check=True)
            decoder.stdout.close()
            if decoder.wait():
                raise SystemExit(f'Could not decode {item["file"]}.')
        for file in staging.rglob("*"):
            if file.is_file():
                file.chmod(0o444)
        try:
            staging.rename(folder)
        except OSError:
            # Another checkout's run unpacked it first.
            if not folder.is_dir():
                raise


def install_archive(item, replace, copy, before):
    """Link the archive's files beside the tracked recipes. A file that differs is replaced only where it is still
    the link this installer made to `before`, the folder of the archive installed until now."""
    folder = home(item["name"], item["sha256"])
    for file in sorted(folder.rglob("*")):
        if file.is_dir():
            continue
        if file.stat().st_mode & 0o222:
            raise SystemExit(f"{file} was made writable, so it may have been written through a link. "
                             f"Remove {folder} and run this again.")
        path = file.relative_to(folder)
        target = ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if os.path.lexists(target):
            plain = target.is_file() and not target.is_symlink()
            if plain and os.path.samefile(target, file):
                if not copy:
                    continue
            elif not replace and not (plain and before and (before / path).is_file() and os.path.samefile(target, before / path)):
                if not plain or sha256(target) != sha256(file):
                    raise SystemExit(f"Existing file differs: {target}. Move it aside, or pass --force to replace it.")
                if copy:
                    continue
        place(file, target, copy)


def install_art(names, force, offline=False, copy=False):
    wanted = [f for f in ART["files"] if not names or any(f["name"].startswith(n) for n in names)]
    if not wanted:
        raise SystemExit("No art archive has that name. Run list to see them.")
    state = json.loads(INSTALLED.read_text()) if INSTALLED.exists() else {}
    todo = [f for f in wanted if force or copy or state.get(f["name"]) != f["sha256"]]
    print(f'{len(wanted) - len(todo)} of {len(wanted)} archives already installed; {sum(f["bytes"] for f in todo) / 2**20:.0f} MiB to install')
    packed = [f for f in todo if not home(f["name"], f["sha256"]).is_dir()]
    if not offline:
        fetch(ART["release"], packed)
    elif not all(cached(f) for f in packed):
        raise SystemExit("Art this commit pins is not on this machine yet. Run: bun run media art")
    for item in todo:
        unpack(item)
        was = state.get(item["name"])
        # An offline run is the check's own: of an older archive's files it replaces only its untouched links.
        install_archive(item, force or (not offline and was not in (None, item["sha256"])), copy, was and home(item["name"], was))
        state[item["name"]] = item["sha256"]
        part = INSTALLED.with_name(f"{INSTALLED.name}.{os.getpid()}.part")
        part.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
        os.replace(part, INSTALLED)
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
    print(f"shared by every checkout: {SHARED}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", choices=["list", "art", "kit"])
    parser.add_argument("names", nargs="*")
    parser.add_argument("--force", action="store_true", help="install again, replacing files in the checkout that differ from the archive's")
    parser.add_argument("--offline", action="store_true", help="install only from what this machine already holds (art)")
    parser.add_argument("--copy", action="store_true", help="writable copies of this checkout's own in place of links (art)")
    args = parser.parse_args()
    if args.kind == "list":
        show()
    elif args.kind == "art":
        install_art(args.names, args.force, args.offline, args.copy)
    elif len(args.names) != 1:
        parser.error("supply one city")
    else:
        install_kit(args.names[0])


if __name__ == "__main__":
    main()
