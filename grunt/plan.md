# grunt: the plan

A character is an actor with senses, a body and goals. The game gives grunt the senses and the body, through the
[protocol](protocol.md): what the character perceives, and the inputs a player could give. grunt is the mind. One Pi
instance is one character, and everything that decides is in this package: what the character wants, what it is
doing, what it notices, what interrupts it, and what it does next.

The same mind serves every kind of character: a survivor that joins a server and lives there, a companion told "go
get some wood", an NPC that farms and trades, a raider, a guide. The role changes the mind, never the game.

This is a plan, not a set of decisions. Its order is what depends on what. Its numbers are starting points to be
measured. Its invariants (the end) are the only parts meant to hold.

## 1. Layers

Intent → Goals → Skills → Decisions → Controls → World, with observations and events flowing back up to every layer.

| Layer | Who | Does | Decides how often | First made with |
| --- | --- | --- | --- | --- |
| **Intent** | the Director: Pi's conversation | the role, the personality, what the character wants, talking to people | on events and instructions, every few seconds to minutes | the LLM Pi runs |
| **Goals** | the Planner | turns a want into a tree of goals and tasks: "a 2×2 house" → have the pieces → craft them → have the materials → place them in order | on a new goal, or when something invalidates the plan | rules and recipes, the LLM where they run out |
| **Skills** | the task system | runs tasks: small autonomous machines that own body controls for a while (harvest, approach, build, flee) | continuously, one step per check | code, each with decision points |
| **Decisions** | policies | the narrow choices inside skills and arbitration: which tree, continue or stop, interrupt or ignore, fight or run | 1 to 20 times a second, at decision points | rules, then models |
| **Controls** | the body | steering, turning, aiming, holding a button: the only part that sends `act` | 10 to 20 times a second | deterministic controllers |
| **World** | the game | physics, rules, inventory, combat, persistence | its own tick | the game, through the protocol |

The Director does not need to know how to walk, and the walking does not need to know why it is going somewhere. No
layer reaches past the one below it: the Director starts tasks, it never sends controls.

## 2. What a player does, and the skills it reduces to

| Domain | What a player does | Skills |
| --- | --- | --- |
| Perception | looks around, scans, inspects, tracks movement, listens | look at, scan, track, investigate |
| Movement | walks, runs, jumps, crouches, swims, climbs | approach, follow, avoid, recover |
| Navigation | finds routes, crosses terrain, avoids cliffs and threats | travel to, explore, patrol, return |
| Survival | eats, drinks, heals, manages heat, cold, stamina, oxygen | keep needs, find shelter, recover |
| Gathering | finds trees, rocks, bushes, bodies | harvest, collect, deposit |
| Inventory | equips, drops, splits, moves, organises | equip, transfer, sort, restock |
| Crafting | learns recipes, gathers ingredients, uses stations | craft, repair, prepare |
| Construction | places pieces, snaps them, repairs, demolishes | build a blueprint, extend, repair |
| Combat | aims, swings, shoots, dodges, reloads, retreats | engage, defend, disengage |
| Taming | finds creatures, judges levels, knocks out, feeds | capture, tame, guard |
| Creatures | whistles, orders, saddles | command, follow, stay |
| Riding | mounts, steers, flies, lands | ride to, fly to, scout, land |
| Social | chats, trades, coordinates, joins tribes | converse, answer, cooperate |
| Recovery | dies, rises, retrieves belongings | rise, retrieve, re-equip |

Most of these are compositions of a few operations. Chopping wood is find tree + approach + face + hold the right tool +
swing until it is gone + watch weight and danger. Building is have the piece + hold it + approach the place + look at
where it snaps + check the preview + place + verify. The game has hundreds of things to do and perhaps a few dozen
distinct skills, which is the opportunity.

## 3. Senses, belief and memory

The protocol's channels are the character's senses: `self` (the body), `entities` (sight), `terrain` (the ground ahead),
`focus` (the crosshair and what can be done there), `inventory`, `chat` (and the interface's notices), events (being
hurt, items gained, mounting), and, optionally, `image`.

**The game's truth and the character's knowledge are different things.** grunt holds a *belief*: what it has seen,
when, and how sure it is. An entity seen 20 s ago behind the character is remembered, not known. Every decision reads
belief with its age, and a stale belief is refreshed (a look, a turn of the head) before something costly is done on
it. Deciding where to look is an action like any other: the character has one pair of eyes.

Memory keeps what a player keeps: places (home, the chest, where the good trees were), creatures and players met,
routes that worked and ones that failed, what the owner asked and prefers. It is grunt's, stored beside the Pi session,
never asked of the game.

## 4. Attention: monitors and arbitration

Several monitors judge at once; only one thing drives the body.

| Monitor | Watches | Raises |
| --- | --- | --- |
| **Threat** | hostile creatures and players, their distance and approach, damage taken | `danger` with how bad and where |
| **Body** | health, stamina, food, water, oxygen, weight, temperature | `need` (eat, drink, unload, rest), `critical` |
| **Progress** | whether the running task is getting closer to done: yield per swing, metres gained, pieces placed | `stalled`, `done`, `invalidated` |
| **Stuck** | blocked movement, failed actions, the same thing tried again | `blocked` with what was tried |
| **Social** | chat lines: is it to me, from my owner or tribe, an instruction, a question | `addressed`, `instruction` |
| **Opportunity** | something worth more than the current task: a rare creature, a drop, better resources | `opportunity` with a value |
| **Perception** | new things in view, things gone, things that moved | `noticed` (feeds the others, and memory) |

Monitors produce **signals**, not actions. The arbiter decides what a signal does, by a ladder that can be configured:

`imminent death > owner's instruction > immediate threat > the active task > needs > opportunities`

with an interruption cost (switching is not free), hysteresis (a raptor at 30 m that becomes 29 m is not news) and
cooldowns (no turning between two things every second). When the ladder does not settle it, a decision point asks a
policy (`interrupt`, `continue`, `defer`, `ask the Director`). Only what the Director needs reaches it: a task done or
blocked, a choice above the skills' level, a line addressed to the character, danger it should know of.

## 5. Tasks: the character's own operating system

A skill runs as a **task**, a first-class object the Director, the arbiter and the trace can all see:

```
{ id: "t17", skill: "harvest", status: "running", phase: "swing",
  args: { kind: "tree", until: "none_near" }, parent: "g4",
  owns: ["move", "look", "hands"], interrupts: ["owner_instruction", "danger", "critical", "death"],
  reports: ["done", "blocked", "inventory_full", "tool_broken"],
  progress: { trees: 3, wood: 41 } }
```

Each skill is defined by one contract (the *options* framework of hierarchical reinforcement learning):

- **Preconditions**: when it can start (a tool in the inventory, a tree in memory).
- **Parameters**: what it is for, and the limits on it (`until`, `radius`, `risk`).
- **Phases**: its steps, each a small loop over belief and controls.
- **Decision points**: the choices it hands to a policy, with their candidates.
- **Success and failure**: how it knows it is done, or stuck.
- **Interruptions**: what may stop it, and whether it can resume.
- **Resources**: the controls it owns (`move`, `look`, `hands`, `inventory`, `voice`) while it runs.
- **Progress**: what it shows its parent.

Two tasks may run together when their resources do not overlap: listening and answering chat while chopping is fine,
two things steering is not. A task that is interrupted releases its controls, keeps its progress and phase, and resumes
when the arbiter lets it. A shared **blackboard** holds beliefs, goals, tasks and candidate actions, so the monitors and
skills read one picture of the world.

## 6. Decisions and policies

A decision point is a narrow question with explicit candidates:

```ts
interface DecisionPolicy {
  decide(input: { point: string; state: unknown; goal: unknown; candidates: string[] }):
    Promise<{ choice: string; scores?: Record<string, number>; why?: string }>;
}
```

Every policy answers the same question the same way: hard-coded rules, an LLM asked one narrow question, a hosted
decision model, a small model run locally. Nothing else knows which one answered. Scores are logged, never trusted as
probabilities.

The first decision points:

| Point | Candidates |
| --- | --- |
| `harvest.next` (after each swing) | continue, next target, deposit, stop |
| `harvest.target` | the trees, rocks or bushes in belief, by distance, yield and danger |
| `arbiter.interrupt` | interrupt, continue, defer, ask the Director |
| `threat.respond` | flee, fight, hide, call a tame, ignore |
| `task.after` (when a task ends) | the next task of the plan, a need, idle, ask the Director |

Safety, freshness and verification are not a policy's job: a rule keeps the character out of lava whatever the policy
says, a stale belief is refreshed before it is acted on, and "done" is checked in the world, not taken from a model's
confidence.

## 7. Worked through

### Chop wood until there is none near

The owner says "get wood from these trees". The Director starts `harvest {kind: tree, until: none_near}`.

1. **Acquire.** The skill reads belief: trees within its radius. Decision `harvest.target` picks one (nearest, the
   owner's favourite, away from the raptor seen earlier). If belief is old, it looks around first: a slow turn, which
   refreshes `entities`.
2. **Prepare.** The best tool in the inventory (a hatchet over a pick for wood) goes in hand: `select`.
3. **Approach.** The body steers to reach: `move` forward with `look` toward the tree, a step at a time, re-aiming as it
   goes; the stuck monitor watches metres gained.
4. **Face.** At reach, it turns until `focus.target` is the tree and `focus.verbs` has `harvest`.
5. **Swing.** `interact {target, verb: harvest, hold_ms}` or `use` with the tool, again and again. Each outcome and each
   `item` event says what it gave. Decision `harvest.next` after each swing.
6. **Next.** When the tree is gone from `entities`, back to Acquire. When none is left within the radius, `done`, with
   what was gathered.

Meanwhile the threat monitor sees a raptor come within 30 m and closing. The arbiter's ladder puts an immediate threat
above the task: harvest is suspended (its controls released, its progress kept), `threat.respond` picks flee, `flee`
takes the body. When the raptor is gone, harvest resumes at Acquire. The Director hears about it once: "a raptor came
by; I ran; back to the trees." It made one decision in the whole sequence.

### Build a 2×2 wood house from what is in the inventory

The Director starts `build {blueprint: hut_2x2}` (or writes a layout of rooms: `grunt/builder.md`). The skill lays the
layout out as pieces on the game's grid (4 foundations, 7 walls, a doorframe and a door, 4 ceilings, in an order that
keeps every piece supported), and nothing is aimed (D881):

1. Check the whole plan with the game's build helper (`plan`, `op: check`): a verdict for every piece. Ground that
   will not do moves the site to the nearest that fits, a cell at a time.
2. Compare what is still to place with the inventory and the recipes; say the whole bill if materials are short; else
   queue the crafting of every missing piece at once, in the order the plan needs them.
3. Place the plan in sections of a few dozen pieces (`op: build`), each from a spot outside the footprint within the
   helper's reach. The game places them at its pace, from the bag.
4. A piece that cannot go stops the section, saying which and why: waiting for crafting and stepping out of the way
   are the skill's own; anything else (a rock rolled onto a cell, a creature) is `blocked` for the Director, with how
   to clear it. Taken up again, the build goes on from that piece.

### "Come here"

A player says "Scout, come here" in local chat while Scout is chopping. The social monitor marks it `addressed`, from a
player who may give instructions (the owner, the tribe, or anyone, by role). An instruction is high on the ladder:
harvest is suspended, the Director gets the line and starts `approach {target: the speaker, distance: 3}`, says
"coming", and asks whether to go back to the trees once there.

## 8. Pi's part

Pi is the Director, and the host of everything else: the runtime runs inside the extension, beside the conversation.

**The tools the model sees** (and `game_connect`) are few and coarse, and the skills are found through a registry, not listed as dozens of
tools:

| Tool | Does |
| --- | --- |
| `game_look` | what the character knows now, summarised: itself, what is near, what it holds, what is running |
| `game_skills` | the skills it can run, with their parameters and preconditions |
| `game_do` | starts a skill as a task: `game_do {skill: "harvest", args: {...}}` |
| `game_tasks` | what is running, suspended, done, with progress |
| `game_stop` | cancels or suspends a task |
| `game_say` | a chat line |
| `game_recall` | memory: places, creatures, people, what happened (not yet) |

**Events reach the model** through `pi.sendMessage(…, { triggerTurn: true })`, only for what the Director must answer
(a task done or blocked, a decision escalated, a line addressed to the character, danger). Everything else waits in
`game_look` and `game_tasks`.

**The operator** has `/grunt connect <url> <name>`, `/grunt status`, `/grunt trace`, `/grunt role <file>`,
`/grunt pause`. A role is a file: who the character is, who it obeys, what it may do, how it talks.

One Pi conversation per character identity, its role and long-term goals kept apart from its motor state, so a
restarted Pi picks the character up where it was. Pi Durable is a later adapter over the same runtime.

## 9. Traces

The conversation is not the record: a player makes thousands of movements between two messages. grunt records, as
JSON lines, every observation it acted on (by `seq`), every signal, every decision (point, candidates, choice, scores,
policy, time taken), every control sent and its outcome, every task's life, and every correction a person made. A
trace can be replayed against another policy offline, so two policies are compared on the same moments, and it is
the dataset small policies are trained on.

## 10. Testing: scenarios, a ladder, measures

A **scenario** is data: a world to start from (the place, the inventory, creatures spawned, the time of day), what the
character is told, how success is checked in the world, what counts as failure, and a budget (time, turns, cost). It
runs against the mock world first and SNARK after.

| Rung | Shows | Scenarios |
| --- | --- | --- |
| 0 | connect, observe, move, chat | say where you are; turn to face the chest |
| 1 | explore, avoid, recover | walk to the rock 60 m off, round the trees; get unstuck from a corner |
| 2 | identify and interact | open the chest and take the hatchet |
| 3 | gather and manage inventory | chop until no tree is near; gather 30 stone and put it in the chest |
| 4 | keep a goal under threat | chop while a raptor hunts nearby, and live |
| 5 | craft and build | craft a stone pick; build a 2×2 wood house from the inventory |
| 6 | multistep goals | build a 2×2 house from nothing: gather, craft, place |
| 7 | people | come when called, mid-task; answer a question about what you are doing |
| 8 | ride and fly | mount the saddled pteranodon, fly to the hill, land |

Every scenario is scored on more than success:

| Quality | Measured as |
| --- | --- |
| Competence | done or not, and how much of it |
| Efficiency | time, distance, materials, model cost |
| Survivability | avoidable damage and deaths |
| Responsiveness | time from an event or an instruction to action |
| Continuity | stops, reversals, changes of target that were not needed |
| Naturalness | camera speed and jerk, pacing, how it looks to a person watching |
| Recoverability | success after an interruption or an obstruction |
| Trustworthiness | doing what it was not allowed, ignoring a constraint |

Naturalness matters disproportionately: a character that moves like a player is more convincing than a smarter one
that flicks its camera.

The experiments, in order: **A**, a reference player with every policy a strong model and no limit on cost, which sets
the ceiling; **B**, the same with decision models at the decision points, compared on the same traces; **C**, small
policies trained from A's and B's traces for single points (`harvest.next`, `arbiter.interrupt`, `threat.respond`);
**D**, naturalness, scored by people watching recordings.

## 11. Models

- **The Director**: Claude Haiku 5.5 through OpenRouter (cheap, fast, 1M context), with Claude Sonnet 5.5 or Opus 5.5
  as the reference for experiment A.
- **Decision points**: rules first, so that every skill works and is tested without a model. Then an LLM asked the one
  narrow question (Haiku at low effort) as the teacher. Then decision models, hosted or local, chosen by experiment B.
  The candidates in `planning/reference/grunt-background.md` (Bekko, Needle, Mirage and the rest) are unverified notes.
- **Local inference** later, in a worker beside the runtime, once a policy is small enough.

## 12. What the protocol has to grow

Playing through a player's inputs needs more than version 0's draft. From the examples above:

- **Crafting**: a `craft` control (the inventory screen's button, with a count), and `inventory.craftable`: what can be
  made now, and what each needs.
- **Building**: the build helper (`plan`): a whole structure checked at once, piece by piece, then placed at the game's
  pace and reach (D881). A game may also offer the aimed preview a player has (`focus.placement`, `rotate`).
- **Touch**: a `blocked` event when movement is stopped by something, and what by.
- **Hearing**: sound events with a direction and loudness, things heard but not seen.
- **Inspection**: what the interface shows on looking closely (a creature's level, a box's lock), only from where a
  player could see it.

## 13. Where things are built

| Piece | Where | Runs in |
| --- | --- | --- |
| The protocol and its types | `grunt/protocol.md`, `grunt/protocol.ts` | both sides |
| The runtime: link, session, belief, monitors, arbiter, tasks, skills, policies, trace | `grunt/` | Pi, under Node |
| The Pi tools, events and commands | `grunt/extension.ts` | Pi |
| The mock world: a beach, trees, rocks, bushes, a chest, a raptor, recipes and building | `tools/grunt/` | Bun |
| The scenario runner and scenarios | `tools/grunt/`, `grunt/scenarios/` | Bun, driving Pi |
| The protocol in SNARK | a gateway in SNARK, beside `agent/` | Bun |

## 14. Order of work

Each step stands on the ones before it; every step ends tested.

1. The protocol's additions (section 12), written into the draft.
2. The mock world, deterministic and steppable, speaking the protocol in process and over a WebSocket.
3. Link and session: hello and welcome, subscriptions, acts with acks and outcomes, the leash, resuming.
4. Belief and memory from observations, with ages.
5. The body: steer toward a point, turn to a bearing, keep reach, hold a button; the stuck monitor.
6. Tasks, the arbiter and the monitors (threat, body, progress, stuck, social), with the rules policy.
7. Skills: look around, approach, face, harvest, flee; then craft and build.
8. The trace recorder, and replay.
9. Pi's tools, events and operator commands; a role file.
10. The scenario runner, against the mock: rungs 0 to 5, rules policies, no model.
11. The Director: Haiku 5.5 in Pi playing the scenarios; experiment A with a stronger model.
12. SNARK speaks the protocol, and the scenarios run on Miami.
13. Decision models at the decision points: experiments B and C.

## Invariants

The game owns the world and its rules. Observations are what the character could perceive. Controls are what a player
could do. grunt owns every intention and decision. Only the body sends controls, and only one task owns a control at
a time. The protocol is versioned, and the game knows nothing of grunt. Every observation acted on, decision, control
and outcome is recorded and can be replayed.

## Open

How many monitors are worth having; the skill taxonomy past the first dozen; whether the Planner is rules, an HTN, or
the LLM; the tick rates; how the camera should move to look natural; how memory is kept; whether policies run in Pi's
process or a worker. These are for the experiments to settle.
