"""The two sound models, pinned: where the code and weights come from, and their defaults."""

import hashlib
import sys
import tarfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / ".work"
SRC = WORK / "src"

STABLE_COMMIT = "790793b89ddceea612be9ce42ff6830d18f6fa57"

MODELS = {
    "stable": {
        "name": "Stable Audio 3.0 Small SFX",
        "repo": "stabilityai/stable-audio-3-optimized",
        "revision": "30cb2644da54bfa63275d1bc7f1fa67fc718680f",
        "files": [
            "MLX/t5gemma_f16.npz",
            "MLX/dit_sm-sfx_f16.npz",
            "MLX/same_s_decoder_f32.npz",
            "LICENSE.md",
            "LICENSE_GEMMA.md",
            "NOTICE",
        ],
        "code": {
            "repo": "github.com/Stability-AI/stable-audio-3",
            "commit": STABLE_COMMIT,
            "path": "optimized/mlx/scripts/sa3_mlx.py",
            "licence": "MIT",
        },
        "licence": {
            "name": "Stability AI Community License (last updated 2024-07-05)",
            "link": "https://huggingface.co/stabilityai/stable-audio-3-optimized/blob/30cb2644da54bfa63275d1bc7f1fa67fc718680f/LICENSE.md",
            "terms": "free for research, non-commercial use, and commercial use by people or organisations under US$1M annual revenue; above that a separate licence from Stability AI is needed; commercial users must register with Stability AI; distributors show 'Powered by Stability AI' and keep a notice file; you own the outputs; outputs may not be used to train other foundation generative models; the T5Gemma text encoder is under the Gemma Terms of Use.",
        },
        "rate": 44100,
        "defaults": {"steps": 8, "cfg": 1.0, "apg": 1.0, "dit": "sm-sfx", "decoder": "same-s", "dit_dtype": "fp16"},
    },
    "moss": {
        "name": "MOSS-SoundEffect v2.0 (MLX bf16 conversion)",
        "repo": "mlx-community/MOSS-SoundEffect-v2.0-bf16",
        "revision": "71a08a420dcac61b73fc1f721d56ac41078973bf",
        "files": None,
        "upstream": {
            "repo": "OpenMOSS-Team/MOSS-SoundEffect-v2.0",
            "revision": "e35df4d82fbe87fcd5d14e5d100e349c0c3c076d",
        },
        "dit_int4": {
            "repo": "mlx-community/MOSS-SoundEffect-v2.0-4bit",
            "revision": "51d53e8b51bb5f7eff1ac28ca6faf8d14557dfcb",
            "file": "mlx/dit.safetensors",
            "bits": 4,
            "group_size": 64,
        },
        "code": {
            "repo": "github.com/xocialize/moss-soundeffect-mlx",
            "commit": "4e8e3e36d4d9c991d16a3e65a4b7099d406b9ed8",
            "package": "moss-sfx-mlx 0.1.0",
            "licence": "Apache-2.0",
        },
        "licence": {
            "name": "Apache License 2.0",
            "link": "https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0",
            "terms": "commercial use, modification and distribution allowed; keep the licence and notices when redistributing the model; no trademark rights; no warranty. Outputs carry no licence condition.",
        },
        "rate": 48000,
        "defaults": {"steps": 100, "cfg": 4.0, "sigma_shift": 5.0, "max_seconds": 30, "dtype": "bf16",
                     "dit": "int4", "decode_margin": 1.0},
    },
}


def stable_root():
    return SRC / f"stable-audio-3-{STABLE_COMMIT}" / "optimized" / "mlx"


def weights_dir(model):
    from huggingface_hub import snapshot_download

    m = MODELS[model]
    kw = {"allow_patterns": m["files"]} if m["files"] else {}
    return Path(snapshot_download(m["repo"], revision=m["revision"], **kw))


def moss_int4_dit():
    from huggingface_hub import hf_hub_download

    d = MODELS["moss"]["dit_int4"]
    return Path(hf_hub_download(d["repo"], d["file"], revision=d["revision"]))


def fetch_stable_code():
    root = stable_root()
    if root.exists():
        return root
    SRC.mkdir(parents=True, exist_ok=True)
    tgz = SRC / f"stable-audio-3-{STABLE_COMMIT}.tar.gz"
    url = f"https://codeload.github.com/Stability-AI/stable-audio-3/tar.gz/{STABLE_COMMIT}"
    urllib.request.urlretrieve(url, tgz)
    with tarfile.open(tgz) as t:
        t.extractall(SRC, filter="data")
    print(f"stable code {STABLE_COMMIT} sha256 {hashlib.sha256(tgz.read_bytes()).hexdigest()}")
    return root


def link_stable_weights():
    """Point the official MLX code's models/mlx/ at the pinned snapshot, so it never fetches main."""
    root = fetch_stable_code()
    snap = weights_dir("stable")
    dest = root / "models" / "mlx"
    dest.mkdir(parents=True, exist_ok=True)
    for f in MODELS["stable"]["files"]:
        if not f.startswith("MLX/"):
            continue
        link = dest / Path(f).name
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(snap / f)
    return root


def main():
    link_stable_weights()
    print("stable weights", weights_dir("stable"))
    print("moss weights", weights_dir("moss"))
    print("moss 4-bit DiT", moss_int4_dit())


if __name__ == "__main__":
    sys.exit(main())
