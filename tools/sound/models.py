"""The two sound models, pinned: where the code and weights come from, and their defaults.

Two backends: "mlx" on a Mac (the MLX ports) and "torch" elsewhere (the upstream PyTorch code on
CUDA). SOUND_BACKEND=mlx|torch chooses one by hand. A model's torch backend, where it has one, is
its "torch" entry; a take made by it is named <model>-pt-<seed> so it never meets an MLX take.
"""

import hashlib
import os
import sys
import tarfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / ".work"
SRC = WORK / "src"

STABLE_COMMIT = "790793b89ddceea612be9ce42ff6830d18f6fa57"
MOSS_TTS_COMMIT = "934d6826b084c46a0d033402174d5f8ac4ed2519"
MOSS_TTS_SHA256 = "1f89f0aa244feff7855b0e33dd36d5b7cf0c62c12713bdfa1b343075846672f3"

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
        "torch": {
            "name": "MOSS-SoundEffect v2.0 (upstream PyTorch on CUDA)",
            "repo": "OpenMOSS-Team/MOSS-SoundEffect-v2.0",
            "revision": "e35df4d82fbe87fcd5d14e5d100e349c0c3c076d",
            "files": None,
            "code": {
                "repo": "github.com/OpenMOSS/MOSS-TTS",
                "commit": MOSS_TTS_COMMIT,
                "path": "moss_soundeffect_v2",
                "package": "moss-soundeffect-v2 0.1.0",
                "licence": "Apache-2.0",
            },
            # MossSoundEffectPipeline as shipped: DiT weights fp32 under bf16 autocast, compiled with
            # Triton CUDA graphs, noise from a CPU generator over the full 30 s latent, CFG in fp32,
            # the full 30 s decoded in fp32 and cut to the asked seconds. Only the staging differs:
            # the pipeline's own CPU offload keeps one of text encoder, DiT and VAE on the GPU.
            "defaults": {"steps": 100, "cfg": 4.0, "sigma_shift": 5.0, "max_seconds": 30},
            "memory_gb": 10,
        },
    },
    "voice": {
        "name": "MOSS-VoiceGenerator",
        "repo": "OpenMOSS-Team/MOSS-VoiceGenerator",
        "revision": "97521ec2b6f3ec5026ac1f5751f8fc302d82c2d4",
        "licence": {
            "name": "Apache License 2.0",
            "link": "https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator",
            "terms": "commercial use, modification and distribution allowed; keep the licence and notices when redistributing the model; no trademark rights; no warranty. Outputs carry no licence condition. Voices are designed from text: no reference recording of anyone.",
        },
        "rate": 24000,
        "torch": {
            "name": "MOSS-VoiceGenerator (PyTorch on CUDA)",
            "repo": "OpenMOSS-Team/MOSS-VoiceGenerator",
            "revision": "97521ec2b6f3ec5026ac1f5751f8fc302d82c2d4",
            "codec": {"repo": "OpenMOSS-Team/MOSS-Audio-Tokenizer", "revision": "3cd226ba2947efa357ef453bcad111b6eafba782"},
            # Its code is written for transformers 5 (MOSS-SoundEffect's venv pins 4.57.1), so its worker runs in the
            # Stable Audio venv: torch 2.7.1+cu128, transformers 5.
            "python": ".venv-stable/bin/python",
            "files": None,
            "code": {"repo": "huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator", "commit": "97521ec2b6f3ec5026ac1f5751f8fc302d82c2d4",
                     "path": "modeling_moss_tts.py, processing_moss_tts.py (trust_remote_code, the pinned snapshot)", "licence": "Apache-2.0"},
            # The model card's recommended decoding (it is sensitive to these).
            "defaults": {"audio_temperature": 1.5, "audio_top_p": 0.6, "audio_top_k": 50, "audio_repetition_penalty": 1.1},
            "memory_gb": 14,
        },
    },
}


def backend():
    b = os.environ.get("SOUND_BACKEND") or ("mlx" if sys.platform == "darwin" else "torch")
    if b not in ("mlx", "torch"):
        raise SystemExit(f"SOUND_BACKEND={b}: mlx or torch")
    return b


def spec(model, back="mlx"):
    """What made a take: the model's own entry for MLX, its "torch" entry (with the shared licence) for torch."""
    m = MODELS[model]
    if back == "mlx":
        return m
    if "torch" not in m:
        raise SystemExit(f"{model} has no {back} backend in tools/sound yet")
    return {**m["torch"], "licence": m["licence"], "rate": m["rate"]}


def weights_dir(model, back="mlx"):
    from huggingface_hub import snapshot_download

    m = spec(model, back)
    kw = {"allow_patterns": m["files"]} if m["files"] else {}
    return Path(snapshot_download(m["repo"], revision=m["revision"], **kw))


def fetch_moss_code():
    """The pinned MOSS-TTS source; its root goes on sys.path so moss_soundeffect_v2 imports."""
    root = SRC / f"MOSS-TTS-{MOSS_TTS_COMMIT}"
    if root.exists():
        return root
    SRC.mkdir(parents=True, exist_ok=True)
    tgz = SRC / f"moss-tts-{MOSS_TTS_COMMIT}.tar.gz"
    if not tgz.exists():
        urllib.request.urlretrieve(f"https://codeload.github.com/OpenMOSS/MOSS-TTS/tar.gz/{MOSS_TTS_COMMIT}", tgz)
    got = hashlib.sha256(tgz.read_bytes()).hexdigest()
    if got != MOSS_TTS_SHA256:
        raise SystemExit(f"{tgz.name}: sha256 {got}, pinned {MOSS_TTS_SHA256}")
    with tarfile.open(tgz) as t:
        t.extractall(SRC, filter="data")
    return root


def stable_root():
    return SRC / f"stable-audio-3-{STABLE_COMMIT}" / "optimized" / "mlx"


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
    if backend() == "torch":
        print("moss code", fetch_moss_code())
        print("moss weights", weights_dir("moss", "torch"))
        return
    link_stable_weights()
    print("stable weights", weights_dir("stable"))
    print("moss weights", weights_dir("moss"))
    print("moss 4-bit DiT", moss_int4_dit())


if __name__ == "__main__":
    sys.exit(main())
