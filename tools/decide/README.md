# The decider's lab

The lab finds the smallest scorer that answers one kind of small game question well, and trains it on this machine
from the game itself. The engine it trains for is `shared/decide`: a question is a table (a few state numbers, K
candidates of W numbers, a bias and a mask each), the answer is K probabilities, a profile names the columns, and a
scorer is a line of weights or one hidden layer. The engine and most of the lab import nothing from the game.

## The loop

1. **Declare a profile** in `shared/decide/profiles.ts` (or your engine's own), with a hand rule in `rules.ts`. The rule
   decides until a trained scorer beats it.
2. **Declare a point** in the game (`server/decide`): it fills the profile's tables for a mover, asks, and acts on the
   pick. The lab finds it by name on a host's decider. The game's are the stuck ladder's, `nav.snag` and `nav.ring`
   (`server/decide/nav.ts`), always decided together. A point of several passes, as `nav.ring` is, says in the
   catalogue (`catalog.ts`) how it adds them, from the constants nav.ts exports, so the trainer adds them the same way.
   The stand-in `lab.ring` (`standin.ts`) is only for the pipeline's own tests.
3. **Write a setup**: a family of seeded scenes in `random.ts`, each with a mover, a goal and a horizon, every measure
   drawn from its seed. `setups.ts` builds a scene on the lab world (`world.ts`) and plays it. Before a scene is
   played, an oracle (a search over the whole path grid that swims) must find a way short enough for its horizon, from
   the start and goal drawn or from others drawn from its seed; a scene with none is not played. The oracle also prices
   the way at real pace: the best dry way, and the best that swims, each leg walked or swum at the body's own pace. A
   scene's horizon is three times that, or as drawn where that is longer. `audit.ts` says, by family, how many have no
   way, how many today's code solves without the ladder ever asking, and who arrives; `--against` an earlier audit lists
   each scene gained and lost, by family and creature, which every change to scenes, columns, rules or movement is
   measured by.
4. **Make situations** that teach, beside the families (`SITUATIONS` in `catalog.ts`), which leave what the families
   draw as it was:
   - Pairs: one layout played twice with one fact changed, so the right way flips. `ford` is a U with a flooded gap in
     its closed end and a dry way out of its mouth; the fact is the body (one that swims faster than it walks against
     one slower), the depth (a wade against a swim), or the dry way's length. `gap` is a gap a raptor fits through and a
     rex does not. Seeds 2n - 1 and 2n are pair n. The oracle says which way wins on each side, and the audit keeps only
     pairs whose sides differ by a tenth at least, then counts those where the rule takes the oracle's way on both.
   - Intents: `intentU` and `intentTrees` put a U or a wood in front of a walk, a chase (of a dodo standing at the
     goal, arriving at the first bite) and an escape (from a threat that comes after the mover; arriving once clear,
     ending if caught), with the same body. Seeds 3n - 2, 3n - 1 and 3n are layout n. Costs follow the intent.
5. **Generate and label.** Each scene is played with the chooser, one of its answers is drawn, and the scene is replayed
   from its start once for each open candidate and each of three seeds, that candidate forced there, the mover's luck
   reseeded (`Behavior.reseed`). Today's code is the same replay with the answer spared (`SPARE`): nothing is done for
   it. A candidate's target is how often it was best. A replay whose world differs at the decision is thrown away. A
   "yes" point costs no replay: its label is what was observed after its answer (the point's `outcome`, or the lab's own
   observer in `setups.ts` where the point reads none), and `--yeses` takes several answers of each scene.
6. **Look at the headroom**: how far the best candidate beats the rule at one decision, as a share of the median cost.
   It is information, never a reason not to train: gains compound over an episode. The toy's was 0.036 while training
   took its arrivals from 36 to 150 of 150.
7. **Fit** a line and a hidden layer for each profile of the point, and **score** them against uniform, today's code and
   the rule. A pass is scored with the others added as the point adds them, by their rule.
8. **Pass the gate**, then copy the weights to `server/decide/weights/<profile>.json` and commit them.

## Commands

```
bun tools/decide/audit.ts --scenes 30                   each family: no way, trivial, who arrives
bun tools/decide/audit.ts --scenes 40 --first 500001 --out <new.json> --against <old.json>
                                                       what a change gained and lost, scene by scene
bun tools/decide/audit.ts --families ford,gap,intentU,intentTrees --scenes 120
                                                       the pairs and the intents
bun tools/decide/generate.ts --point nav.ring --families water --scenes 600 --workers 9
bun tools/decide/generate.ts --point nav.snag --scenes 150 --yeses 30
bun tools/decide/generate.ts --point nav.ring --first 100001 --under <weights.json>[,<more.json>]
                                                       more, from states trained scorers get into themselves
bun tools/decide/score.ts --headroom nav.ring          how far the best candidate beats the rule
bun tools/decide/fit.ts --point nav.ring --profile ring.mid --kind linear [--reading 5s] [--seed 1]
bun tools/decide/fit.ts --point nav.ring --profile ring.mid --kind hidden --hidden 16
bun tools/decide/score.ts [--layouts 75] [--fresh 20] [--workers 8]
                                                       the board
bun tools/decide/score.ts --root .cache/decide/versus/volume --held-families trees,...,intentTrees --held-first 900001 --layouts 24
                                                       a second dataset's board, on layouts named before anything was played
bun tools/decide/toy.ts                                the whole loop on the toy world, in seconds
bun tools/decide/world.ts --cost                       what a lab world and a tick cost
```

`generate.ts`, `fit.ts` and `score.ts` take `--root` for a dataset kept apart from the main one, and `score.ts --held-data
<root>` reads single decisions from another root, all of it held out, so two datasets are judged on the same decisions.
Twelve scorers judged on the same layouts will clear the whole-episode marks by luck now and then: name the one that
did before playing it again on layouts nobody has looked at (a new seed range), and refit it from other seeds.

Wrap long runs in `systemd-run --user --scope -q -p MemoryMax=22G -p MemorySwapMax=0`. Workers are separate
processes, at most 20, each kept for 300 scenes or until it holds 2 GB. Each holds about 1.7 GB once the content is
loaded, so 9 fit under a 22 GB cap. Where the cap kills a run (exit 137 or 143), halve the workers.

## Where files go

| Path | What |
| --- | --- |
| `.cache/decide/data/<point>/manifest.json` | The point and its kind; each profile's name, hash and widths; the families, maps and scenes; each run's revision, chooser and counts |
| `.cache/decide/data/<point>/rows.bin` | The decisions (below) |
| `.cache/decide/models/<point>/<profile>.<kind>.s<seed>.json` | A `ModelFile`; its `about.score` is on validation from `fit`, then on what is held out from `score` |
| `.cache/decide/scoreboard.json`, `.html` | The board. The page loads nothing from outside itself |
| `.cache/decide/status.json` | What a run is doing (`LabStatus`), every few seconds |
| `.cache/decide/toy/` | The toy's own data, models and board |

A dataset of 2,000 decisions of 12 candidates is a few megabytes.

## The dataset

`rows.bin` is records one after another, little-endian. Each is: its length; the scene's seed, family and map; which
answer of the point it was and its tick; the chooser's pick; the tables as served (state, rows, bias, mask); then the
cost of each candidate at each seed and each reading, and of leaving the point alone at each seed ("today"). NaN marks
what was not run. The readings are one second after the decision, five, and at arrival or the horizon. The full layout
is at the top of `dataset.ts`.

A cost is ticks to arrive, plus a price for health lost and for path cells searched; a mover not there at the horizon
costs two horizons and the straight way left. The prices and horizons are guesses in `setups.ts` and `random.ts`.

## Splits and the gate

Splits are by family and by map, never by row. The `pen` family and the Miami slice are held out and read only by the
board; `blocker` stops training and fits the temperature. Intervals are by bootstrap over scenes.

The board's headline is whole episodes on the held-out layouts, fixed before anything is played: seeds 1 to
`--layouts` of each held-out family and map, whatever happens in them. Each policy (every point off, the rule, each
trained scorer loaded alone with the points set to `model`, the other passes by their rule) plays every one from start to
finish, and each layout is listed: its way, whether it arrived, its time and health lost, and how many of the ladder's
headings were acted on. `--fresh` adds new scenes of every family, trained-on ones too, as a look at the scenes, not the
gate. A trained scorer passes only if, held out:

- in whole episodes it arrives at least as often as the rule overall and in every family, and as today's code; it
  loses no more of the rule's arrivals than it gains, layout by layout; and its mean cost is under the rule's, the
  interval of its cost less the rule's (by bootstrap over layouts) wholly under 0;
- its regret is at most 0.75 of the rule's, and the interval's top under 0.9;
- no held-out family is worse than 1.1 of the rule's;
- its ECE is at most 0.05, for a point whose probability is read (`nav.snag`, `nav.sure`, `nav.reach`); a ring pass is
  never read as a probability, so it has no ECE bar;
- hiding the state costs it at least a tenth of its gain in log loss over uniform;
- one answer's 99th percentile is at most 25 µs on a fast core, and its file at most 64 KB;
- and there are at least 2,000 decisions from 200 scenes, or it is not measurable.

Every number about a point of passes is of the answer as the server made it: the trainer and the board add the passes
with `combine` (shared/decide/combine.ts), each by its mix over its scorer's temperature, with the held heading's stick,
and calibration is of the summed probabilities, not of one pass. A survey makes each answer again from its passes and
counts those that come out as the server's; generation fails under the rule if any does not, and the board checks every
stored decision again.

For a "yes" point, regret is read as log loss. The rule itself is marked as failing where it arrives in fewer whole
episodes than today's code: then turning the point on loses episodes, whatever a scorer does.

## Another engine

`toy.ts` is the first example: a grid world with its own profile, rule and split, labelled, fitted and scored by the same
code. It loads nothing outside `shared/decide` and `tools/decide` but `shared/rng.ts`, which loads nothing. To use the pipeline elsewhere, write a `Replayer` (`label.ts`) for your world and a `Catalog` (`fit.ts`).
