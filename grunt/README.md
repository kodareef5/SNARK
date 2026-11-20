# grunt

A Pi package that plays a game as a player. The repository is the package: its `package.json` names
`grunt/extension.ts` under `pi.extensions`, so Pi installs SNARK and finds grunt in it.

The game's only part is to say what its character perceives and to take the inputs a player could give: the
[grunt protocol](protocol.md). Everything that decides is here: the character's role and goals, the skills it runs,
the policies behind them (rules, a language model, a decision model, a small trained policy), and a trace of every
decision, which is also what a smaller policy is trained on. One Pi instance is one character.

| File | Contents |
| --- | --- |
| `protocol.md` | The protocol, version 0: a draft for review |
| `protocol.ts` | Its messages as types, for the package, a game and a mock server alike |
| `extension.ts` | What Pi loads: `/grunt` |
| `pi.ts` | The part of Pi's extension API grunt uses, as types written here |

The zone imports nothing but itself and Node's built-ins (`tools/check.ts`, D873). It names nothing of the game's,
so the same package can play any game that speaks the protocol, and a game knows nothing of Pi. Pi loads it under
Node, not Bun, so it uses none of Bun's own APIs, and Pi's own packages are never listed in `package.json`: Pi
supplies them to the extension, and the repository takes no packages. `pi.ts` holds the types grunt uses instead;
add to it from Pi's own declarations.

## Run it

```sh
pi -e ~/Desktop/snark_private                         # for one session, from a clone
pi install ~/Desktop/snark_private                    # or keep it: a local path loads where it is
pi install git:github.com/kodareef5/snark_private     # or from the repository
```

In Pi: `/grunt status`, `/grunt protocol`.

## Where it stands

Version 0.0. The package loads and the protocol is drafted; nothing connects yet.

1. The protocol, reviewed.
2. A mock game that speaks it: a beach, trees, a raptor, a chest.
3. Connecting, subscribing, acting and the trace, against the mock.
4. The first player: joins, looks, walks, recovers when blocked, answers chat, keeps a goal.
5. SNARK speaks the protocol, and the first player plays a real map.
6. A policy behind each skill, swapped one at a time and compared on the same traces.

The design this follows came from a research conversation, kept in `planning/reference/grunt-background.md`. Its
model names and figures are unverified notes, not decisions.
