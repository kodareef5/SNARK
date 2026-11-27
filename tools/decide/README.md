# The decider's lab

The lab finds the smallest scorer that answers one kind of small game question well, and trains it on this machine
from the game itself. The engine it trains for is `shared/decide`: a question is a table (a few state numbers, K
candidates of W numbers, a bias and a mask each), the answer is K probabilities, a profile names the columns, and a
scorer is a line of weights or one hidden layer. The engine and most of the lab import nothing from the game.

## The loop

1. **Declare a profile** in `shared/decide/profiles.ts` (or your engine's own), with a hand rule in `rules.ts`. The rule
   decides until a trained scorer beats it.
2. **Declare a point** in the game (`server/decide`): it fills the profile's tables for a mover, asks, and acts on the
   pick. Until the game has its points, the lab has a stand-in, `lab.ring` (`standin.ts`).
3. **Write a setup**: a family of seeded scenes in `random.ts`, each with a mover, a goal and a horizon, every measure
   drawn from its seed. `setups.ts` builds a scene on the lab world (`world.ts`) and plays it.
4. **Generate and label.** Each scene is played with the chooser, one of its answers is drawn, and the scene is replayed
   from its start once for each open candidate and each of three seeds, that candidate forced there. A candidate's
   target is how often it was best. A replay whose world differs at the decision is thrown away.
5. **Look at the headroom.** If the best candidate beats the rule by under 0.05 of the median cost, no model is worth
   training for that point.
6. **Fit** a line and a hidden layer, and **score** them against uniform, today's code and the rule.
7. **Pass the gate**, then copy the weights to `server/decide/weights/<profile>.json` and commit them.

## Commands

```
bun tools/decide/generate.ts --point lab.ring --scenes 40 --workers 20     label 40 scenes of each family
bun tools/decide/generate.ts --point lab.ring --first 1000 --under <weights.json>
                                                       more, from states a trained scorer gets into itself
bun tools/decide/score.ts --headroom lab.ring          before training: is it worth it
bun tools/decide/fit.ts --point lab.ring --kind linear [--reading 5s] [--seed 1]
bun tools/decide/fit.ts --point lab.ring --kind hidden --hidden 16
bun tools/decide/score.ts [--episodes 40] [--workers 8] the board
bun tools/decide/toy.ts                                the whole loop on the toy world, in seconds
bun tools/decide/world.ts --cost                       what a lab world and a tick cost
```

Wrap long runs in `systemd-run --user --scope -q -p MemoryMax=24G -p MemorySwapMax=0`. Workers are separate
processes, at most 20, each kept for 300 scenes or until it holds 2 GB.

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

The board's headline is whole episodes on the held-out layouts: each policy plays them from start to finish. A trained
scorer passes only if, held out:

- its regret is at most 0.75 of the rule's, and the interval's top under 0.9;
- no held-out family is worse than 1.1 of the rule's;
- its ECE is at most 0.05;
- hiding the state costs it at least 10% more log loss;
- one answer's 99th percentile is at most 25 µs on a fast core, and its file at most 64 KB;
- in whole episodes it arrives at least as often as the rule and as today's code, at no higher mean cost than the rule;
- and there are at least 2,000 decisions from 200 scenes, or it is not measurable.

For a "yes" point, regret is read as log loss. The rule itself is marked as failing where it arrives in fewer whole
episodes than today's code: then turning the point on loses episodes, whatever a scorer does.

## Another engine

`toy.ts` is the first example: a grid world with its own profile, rule and split, labelled, fitted and scored by the same
code. It loads nothing outside `shared/decide` and `tools/decide` but `shared/hash.ts` and `shared/rng.ts`, which load
nothing. To use the pipeline elsewhere, write a `Replayer` (`label.ts`) for your world and a `Catalog` (`fit.ts`).
