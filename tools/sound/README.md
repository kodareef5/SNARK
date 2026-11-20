# Sound tools

The game's sound effects, spoken lines and music are made by local audio models, then measured, picked by rule and
cut into the asset folders by the scripts here. This folder is how a take is made and how it can be made again.

**It is not part of the build.** `bun run build`, `bun run check` and the server never run anything here, and never
need a GPU, Python or a model. The build reads only what this folder has already written into `assets/source`
(`sounds.json` and the takes, installed from the `art` release). Everything after the model (cutting, levelling,
coding) is the repository's own code.

You need this folder only to **make or remake sounds**, on a machine with an NVIDIA GPU (or an Apple Silicon Mac).

- [Asking for a sound](#asking-for-a-sound): no GPU needed
- [Setting up a machine](#setting-up-a-machine)
- [Making sounds](#making-sounds): effects, spoken lines, music
- [Briefs](#briefs): what a run is asked to make
- [Listening](#listening)
- [Shipping takes](#shipping-takes): from the asset folder to the `art` release
- [Making a take again](#making-a-take-again)
- [The models](#the-models)
- [What has been learned](#what-has-been-learned)
- [Rules](#rules)

## Asking for a sound

Wanted, missing and replacement sounds are rows in [`assets/source/sound-requests.md`](../../assets/source/sound-requests.md).
Anyone can add a row in their own branch: one sound a row, named as the game looks it up (`<owner>/sound/<name>`,
such as `core:dodo/sound/chase`), with what fires it, its length, whether it loops, how many takes, and the nearest
sound that exists. A replacement names the sound it replaces and says why.

`bun run sounds` lists every occasion the game fires that no sound answers; `bun run sounds --all` lists every
occasion. Neither needs a GPU, but both read the cue sheets only once the whole `art` release is installed
(`bun run media art`, about 3.7 GiB, with GitHub CLI); before that they report every occasion silent.

Whoever makes the sound answers the row on a branch of their own (below), and deletes the row when that branch is on
`main`.

## Setting up a machine

### What it needs

| | Linux (CUDA) | Mac (MLX) |
| --- | --- | --- |
| GPU | NVIDIA, 8 GB or more (made on an RTX 4070 Laptop with 8 GB) | Apple Silicon (made on one with 24 GB) |
| Memory | 32 GB or more: a MOSS run starts once 10 GB is free, a voice run once 14 GB is | — |
| Python | 3.12; [uv](https://docs.astral.sh/uv/) if present, else `python3.12 -m venv` | 3.12 |
| Disk | about 15 GB of venvs and 35 GB of weights (the Hugging Face cache) | about 10 GB of weights |
| Also | `flock`, `ffmpeg` (music export); Bun and GitHub CLI (`gh`) to install the shipped takes and listen | `ffmpeg`, Bun, `gh` |

### Installing

```sh
tools/sound/setup.sh                     # PYTHON=... chooses the interpreter
```

On Linux this makes two venvs, because their pins conflict:

- `tools/sound/.venv` from `requirements-cuda.txt`: MOSS-SoundEffect (torch 2.9, transformers 4.57), Whisper, and the
  measuring and picking scripts.
- `tools/sound/.venv-stable` from `requirements-stable.txt`: Stable Audio 3 for music, and MOSS-VoiceGenerator, whose
  code needs transformers 5 (torch 2.7.1).

It then fetches the pinned MOSS-TTS and Stable Audio 3 source into `tools/sound/.work/src/` (MOSS-TTS is checked
against its SHA-256) and the MOSS-SoundEffect v2.0 weights at their pinned revision. Running it again changes nothing
that is already right. On a Mac it makes `.venv` from `requirements.txt` and fetches the MLX ports and their weights.

The other weights download the first time a model runs, each at the revision pinned in `models.py` or `music.py`.
**Stable Audio 3 is gated**: accept its terms on Hugging Face (`stabilityai/stable-audio-3-medium`, and
`stable-audio-3-small-sfx` for a Mac), then sign in once with `tools/sound/.venv/bin/hf auth login`.

### Keeping the heavy parts outside the clone

The venvs, the weights and `.work/` (every candidate a run makes) are large and never committed. A machine that makes
sounds for long should keep them in one place outside any clone, so a new clone or worktree costs nothing:

```sh
mkdir -p ~/.cache/snark-sound/work
ln -s ~/.cache/snark-sound/.venv        tools/sound/.venv
ln -s ~/.cache/snark-sound/.venv-stable tools/sound/.venv-stable
ln -s ~/.cache/snark-sound/work         tools/sound/.work
tools/sound/setup.sh
```

Git ignores the links as it ignores the folders. Weights stay in the Hugging Face cache (`HF_HOME`).

### Sharing the GPU

Every model run on Linux holds the render lock, `/tmp/snark-render.lock` (`flock`, waiting up to two hours), and
waits up to 30 minutes for the machine to have the memory free that its model needs. Any other GPU job on the machine should take the
same lock (`flock /tmp/snark-render.lock <command>`), so two jobs never share 8 GB. No process holds a model between
runs. A Mac runs without the lock, a few takes at a time.

## Making sounds

Every command runs from the root of the clone. A run is **make, measure, pick, accept**: candidates go to
`tools/sound/.work/<asset>/` and are never committed. Only what `accept.py` writes into the asset folder is kept.

On Linux, `generate.py` needs `--model moss` (effects) or `--model voice` (spoken lines). Stable Audio's effects model
runs only on a Mac; Stable Audio's music model runs on CUDA through `music.py`.

### Effects (MOSS-SoundEffect)

```sh
py=tools/sound/.venv/bin/python
$py -W ignore tools/sound/generate.py assets/source/core/creatures/dodo/sound/brief.json --model moss
$py -W ignore tools/sound/review.py assets/source/core/creatures/dodo/sound/brief.json --out tools/sound/.work/core/creatures/dodo/review
$py -W ignore tools/sound/pick.py assets/source/core/creatures/dodo/sound/brief.json
$py -W ignore tools/sound/accept.py assets/source/core/creatures/dodo/sound/brief.json tools/sound/.work/core/creatures/dodo/picks.json
bun run sounds
```

- **`generate.py`** makes each prompt's takes, seeds `seed`, `seed+1`, and so on, as
  `.work/<asset>/takes/<slot>/<model>-pt-<seed>.wav` with a recipe beside each (`<model>-<seed>.wav` on a Mac, so
  the two never meet). Takes already made are kept unless `--force`. `--slot` and `--prompt` narrow a run; several
  briefs can be given at once.
- **`review.py`** measures every candidate (`measures.json`) and draws a contact sheet of spectrograms per slot,
  with accepted takes framed green. Give `--out` under `.work`: without it the sheets replace the ones kept in the
  asset's review folder.
- **`pick.py`** chooses by measure, not by ear: the loudest clean events, one from each file first; a seamless
  stretch for a loop; the whole file for a slot that keeps whole. Clipped files, noisy floors and impacts over a
  steady tone are skipped. `--prefix` limits it to one model's candidates (default `moss-pt`).
- **`accept.py`** stores each pick as a cut (`cut.py`: the event plus 50 ms each side, mono, 24-bit or the brief's
  `bits`) under the asset's `sound/takes/<slot>/`, and writes `sounds.json` and `recipes.json`. Picks are added to
  the takes already accepted; `--replace` starts the picked slots afresh. Files under `takes/` that no take names
  are removed.

### Spoken lines (MOSS-VoiceGenerator)

```sh
py=tools/sound/.venv/bin/python
brief=assets/source/core/sfx/voices/sound/brief.json
$py -W ignore tools/sound/generate.py $brief --model voice      # its worker runs in .venv-stable
flock /tmp/snark-render.lock $py -W ignore tools/sound/transcribe.py $brief --cuda
$py -W ignore tools/sound/review.py $brief --out tools/sound/.work/core/sfx/voices/review
$py -W ignore tools/sound/pick.py $brief --prefix voice-pt
$py -W ignore tools/sound/accept.py $brief tools/sound/.work/core/sfx/voices/picks.json
```

A voice is designed from a description (`instruction`: an accent, an age, a mood) with no reference recording, and
says the prompt's `text`. `transcribe.py` runs Whisper over each take and writes `heard.json`: what it said, how well
its words match the line, and where the line is, because the model often opens with a mumble and a pause.
`pick.py` then cuts to that span, and in a slot marked `"words": true` drops a take that did not say its line.
Without `--cuda` Whisper runs on the CPU (about 15 s a take) and needs no lock.

### Music (Stable Audio 3 Medium)

```sh
py=tools/sound/.venv-stable/bin/python
brief=assets/source/core/music/sound/brief.json
$py tools/sound/music.py $brief            # then music_pick.py, again, until nothing waits
$py tools/sound/music_pick.py $brief
$py tools/sound/music_export.py $brief     # assets/source/core/music/<track>/<layer>.opus and music.json
```

A track is two minutes in layers by intensity (calm, tense, combat, climax). Its base layer comes from its prompt or
from another track's layer (`from`), and every further layer is made from the base as starting audio, so all keep
its tempo, bars and key and the game can cross between them on a bar. `music.py` makes `candidates` of each layer;
`music_pick.py` measures them (dropouts, steadiness, clipping, beats against the base, a rise in loudness and
brightness) and copies the one it keeps. A layer whose source is not chosen yet waits for the next round.
`music_export.py` encodes the chosen layers to Opus, cut to loop on a bar. `music_demo.py <brief> <track>` writes a
walk through the intensities to hear.

## Briefs

Each asset that has sounds has `sound/brief.json` beside its `sounds.json`. The music has one brief of its own
(`assets/source/core/music/sound/brief.json`, with `tracks` in place of `slots`).

| Field | Where | Says |
| --- | --- | --- |
| `asset` | top | the asset folder under `assets/source`, which names the work folder |
| `about`, `notes` | top | what the thing is and sounds like; what was learned making it |
| `bits` | top | 16 to store its cuts as 16-bit (the large libraries) |
| `slots` | top | one per sound the cue sheet names |
| `kind` | slot | `voice` (syllables merge into one call), `impact` or `step` (each hit apart) |
| `range`, `level`, `vary` | slot | metres heard, loudness in dB, how far each play varies; copied into `sounds.json` |
| `want` | slot | the sound asked for, in words |
| `keep`, `loop`, `whole`, `trim`, `words`, `space` | slot | how many takes to keep; cut to loop; keep the file whole; keep each clean take whole; check the words; `ear` for a sound not placed in the world |
| `prompts` | slot | each a prompt to run |
| `id`, `text`, `seconds`, `seed`, `takes` | prompt | its name, the text, the length, the first seed, how many takes |
| `models` | prompt | which models run it (default all) |
| `instruction` | prompt | the voice to design (voice model) |
| `takes_<m>`, `text_<m>`, `seconds_<m>`, `settings.<m>` | prompt | one model's own count, text, length or settings; a torch run reads `<model>-pt` |

## Listening

**The owner listens before anything merges.** The picks are measured, not heard.

```sh
bun install --frozen-lockfile
bun run media art          # every archive: the game reads the sound sheets only once all are installed
PORT=8790 bun tools/dev.ts
```

- `http://localhost:8790/sounds.html`, the sound board: every owner and every occasion it has, what sets it off in
  play, and how this build hears it (its own takes, a stand-in, a shared sound, or none), with each take playable
  with its file, length and recipe. It is an admin's page: open on a `--dev` server, as `tools/dev.ts` runs.
- `http://localhost:8790/`: open the console (backquote or Tab), `enablecheats`, then `spawn dodo 1 40` and walk
  among them. `sound` lists the sounds, `sound <name>` plays one three metres ahead.
- `assets/source/core/music/listen.html`, opened from its folder, plays a track's layers together and switches
  intensity on the bar.

## Shipping takes

Git carries no audio: `*.wav` and `*.opus` under `assets/` are ignored. What Git carries is each asset's `brief.json`,
`sounds.json` and `recipes.json`. The takes themselves travel in the public repository's **`art` release**, one
archive to an asset (`core-sfx-ui`, `core-creatures-dodo`, `core-music-dread`), each named for its own bytes and
pinned in `distribution/release.json`. `bun run media art` installs them.

A branch that adds sounds therefore carries two things: the changed `sounds.json` and `recipes.json` (and the brief),
and the takes. The release is updated from the owner's checkout, which has upload rights:

1. With every art archive installed (`bun run media art`) and the new takes in place, the inventory of binary
   inputs, `distribution/source-files.txt`, is written from what is installed.
2. `python3 tools/release/pack.py art OUT` packs one archive to an asset and pins them in `release.json`. An asset
   that did not change packs to the same file as before, so only changed assets have new files.
3. `gh release upload art OUT/<new files> --repo kodareef5/SNARK` uploads the new ones; the old files stay, so every
   commit still finds the files its manifest names.
4. `release.json` and `source-files.txt` are committed on the branch with the recipes.

A contributor without upload rights opens the branch with the recipes and sends the new takes beside it, as a
tarball of each asset's `sound/takes/` (or the music's Opus files).

## Making a take again

Every accepted take keeps beside it, in `recipes.json`: the prompt, seed, model, repository and revision, settings,
licence, the source file's SHA-256 and the cut in frames.

```sh
tools/sound/.venv/bin/python tools/sound/remake.py assets/source/core/creatures/dodo/sound
```

remakes each source once into `.work/remake/`, cuts it as the recipe says, and compares. Takes from the torch
backend come back **close, not identical**: the compiled DiT differs slightly from one process to the next (a sample
differs by 0.02 at most), so `remake.py` reports them as close. MLX takes come back identical on a Mac.
`assets/source/core/creatures/dodo/sound/make.sh` is the same for the dodo.

## The models

All are pinned by repository and revision in `models.py` (and `music.py`); a take's recipe names what really made it.

| Model | Makes | Runs on | Venv | Time on an 8 GB laptop GPU | Licence |
| --- | --- | --- | --- | --- | --- |
| MOSS-SoundEffect v2.0 | effects, steps, creature calls | CUDA (upstream PyTorch), Mac (MLX) | `.venv` | 32 s a take after a first that compiles (about 100 s); GPU peak 5.8 GB | Apache-2.0 |
| MOSS-VoiceGenerator, with MOSS-Audio-Tokenizer | spoken lines from a described voice | CUDA | `.venv-stable` | about 1.5 s a line; 4.3 GB sampling, 7.3 GB decoding | Apache-2.0 |
| Stable Audio 3 Medium | music | CUDA | `.venv-stable` | about 5 s for two minutes | Stability AI Community: free under US$1M annual revenue, registration for commercial use, outputs ours |
| Stable Audio 3 Small SFX | effects, foley, steps | Mac (MLX) only | `.venv` | about 1 s a take | Stability AI Community |
| Whisper large-v3-turbo | checks what a spoken take says | CPU or CUDA | `.venv` | 15 s a take on the CPU | MIT |

## What has been learned

- **MOSS always denoises 30 s**, whatever length is asked, so a prompt asks for several events with pauses ("three
  separate knocks ... with pauses between"), and `pick.py` takes the events apart.
- MOSS gives the cleaner, more animal calls and squawks; Stable Audio's effects model gives clean, fast foley and
  steps but little variety between seeds.
- Stable Audio effects: keep lengths to whole seconds (1.2, 1.5 and 2.5 s gave clipped noise on MLX). Any prompt with
  "animal vocalisation" gave broadband noise. Its prompts start "TrackType: SFX, ...".
- Prompts that missed: "mumble" (a rumble, or a human mumble), "chirrup" (small-bird chirps), a squawk with wing flaps
  (thumps only), "panic" on MOSS (buried in wing noise).
- On 8 GB: leave `torch.compile` on (eager mode keeps a bf16 copy of every fp32 weight under autocast and runs out of
  memory), and do not use upstream's CPU offload (it holds 17 GB of system memory and pushes other jobs into swap).
- The voice model often opens with a short mumble and a second of silence, or adds a word after the line; the cut
  from `heard.json` removes them.
- Music layers keep their track's bars but beats line up only loosely (onset correlation 0.0 to 0.13), so a change of
  layer can sound like a cross into a related passage. A lower `noise` keeps layers closer, at some cost in
  intensity.
- A cue sheet's bounds that start at 0.0 put the build's 3 ms fade on the onset. Landings with a strong sub-bass ring
  sound quiet when levelled on plain RMS (`loudness` in `tools/pack/sound.ts`).
- 16-bit cuts are a third smaller than 24-bit with nothing lost in the game's 16-bit pack; large libraries set
  `"bits": 16`.

## Rules

- Every accepted take keeps its full recipe, and a script here makes it again.
- Candidates stay in `.work/`; only accepted takes leave it.
- No outside encoder in `bun run build`. The models and ffmpeg are for making art only.
- No personal details in any prompt, and no game's audio as an input or reference.
- One heavy job on the GPU at a time, under the render lock; no process holds a model between jobs.
- Nothing merges until the owner has listened.
