# grunt

A Pi package that plays a game as a player. The repository is the package: its `package.json` names
`grunt/extension.ts` under `pi.extensions`, so Pi installs SNARK and finds grunt in it.

The game's only part is to say what its character perceives and to take the inputs a player could give: the
[grunt protocol](protocol.md). Everything that decides is here, as [the plan](plan.md) lays out: the Director (Pi's
conversation) starts skills and hears reports; the runtime runs them as tasks on its own tick, with monitors that
raise signals, an arbiter that interrupts and resumes, decision points answered by policies, and a body that is the
only part that sends controls. One Pi instance is one character.

| File | Contents |
| --- | --- |
| `plan.md` | The design: layers, skills, senses, attention, tasks, decisions, examples, Pi's part, traces, testing, models, order of work |
| `protocol.md`, `protocol.ts` | The protocol, version 0 (a draft), and its messages as types |
| `link.ts`, `session.ts` | A connection: over a WebSocket or into an endpoint in the same process; hello, observe, subscribe, act |
| `belief.ts` | What the character believes: each channel's last view, things remembered with when they were seen, dangers |
| `body.ts` | The only sender of controls: turn, face until under the crosshair, walk steering round obstacles, get unstuck |
| `skills.ts` | look_around, walk_to, harvest, flee, fight, build (the 2×2 hut), craft, say |
| `monitors.ts`, `policy.ts` | Threat, body and social monitors; decision points and the rules policy |
| `runtime.ts` | Tasks, the arbiter, the tick, reports, and the Director's summary |
| `trace.ts` | Every observation acted on, signal, decision, control, outcome and task change, as JSON lines |
| `extension.ts`, `pi.ts` | What Pi loads: the `game_` tools, messages that wake the Director, `/grunt`; Pi's API as types written here |
| `scenarios/` | Scenarios as data: a world, an instruction, a script of events, a success check, a budget |

The zone imports nothing but itself and Node's built-ins (`tools/check.ts`, D879). It names nothing of the game's,
so the same package can play any game that speaks the protocol, and a game knows nothing of Pi. Pi loads it under
Node, not Bun, so it uses none of Bun's own APIs. Pi's own packages are never listed in `package.json`: Pi supplies
them to the extension, and the repository takes no packages.

## Run it

```sh
bun tools/grunt/serve.ts                                       # the mock world: ws://127.0.0.1:8771/grunt
pi -e ~/Desktop/snark_private --model openrouter/anthropic/claude-haiku-5.5
# in Pi: /grunt connect ws://127.0.0.1:8771/grunt Scout   then talk to it: "chop the trees near you"
```

Type `Ana: Scout, come here` into the mock world's terminal to talk to the character as another player.

## Test it

```sh
bun test tests/unit/grunt*.test.ts                             # the protocol, the mock world, the runtime and skills
bun tools/grunt/measure.ts grunt/scenarios/chop-raptor.json harvest '{"kind":"tree"}'   # one skill, rules only
bun tools/grunt/play.ts grunt/scenarios/chop-grove.json --show                          # the Director playing it
```

`measure.ts` plays one skill with the rules policies and no model, and says how it played (time, distance, controls a
second and why, blocks, decisions, health). `play.ts` runs Pi in RPC mode with a model as the Director (default Haiku
5.5 on OpenRouter), runs the scenario's script, checks its success in the world, and reports turns, tool calls, cost
and the trace. Traces are in `~/.pi/agent/grunt/traces/` (`GRUNT_TRACES` to change it).

## Where it stands

Steps 1 to 10 of the plan's order of work are in: the protocol's additions, the mock world, the runtime, the first
skills, traces, Pi's tools, and the scenario runner. Next: the Director playing the scenarios (step 11), SNARK
speaking the protocol (12), and decision models at the decision points (13).
