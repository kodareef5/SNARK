# What changed after the owner watched the films

The owner judges clips from films. In the moving clips they saw the neck telescope and the wings clip into the body.
So each clip here now has a film (`<name>.mp4`, three views side by side, the camera following the bird; a layer is
filmed over what it plays on), and `review.py` checks every frame on the real model for that family of faults: the
shell (body, neck and head) folding through itself, and any other piece sinking into the shell more than 3 mm past
where it sits at rest. A wing's root turning into the shoulder and a shank going up under the belly hide nothing and
are not counted. `sheets.py` makes the films and sheets and writes the last run's findings to `faults.txt`.

What the check found on the first version, and what changed:

- **The neck creased** wherever it curled: the peck's wind-up, the flinch, held's resting pose and its nod off,
  carried's stare. On this rig's straight rest neck it folds through itself and crushes the throat once the head comes
  in more than about 6 mm, or the neck leans back against the chest, or the chin tucks alone. Now the neck leans
  instead: the peck's wind-up rocks the whole bird back with the head tipped up, the flinch rears the breast with the
  head tossed back a little on it, and the bird looks down by leaning its neck and tipping its head together.
- **The wings cut into the flanks** when they drooped at less than a third out (carried, tired), when the body rocked
  under folded wings (the peck's wind-up), when the breast twisted under them, and when they folded back onto a body
  still reared (the flinch). Drooping wings now stay a third out, folded wings lift a little while the body rocks, a
  big look about turns the whole bird in the arms, and the flinch folds its wings only as the breast settles.
- **Hanging legs rode up into the belly** and the toes went in, in held's paddles and carried's kicks. The feet now
  hang at their standing height and paddle and kick fore and aft.
- **The jaw and the throat pouch sank into the neck.** The beak opens a quarter at most (opening it sinks the lower
  beak into the face: 8 mm at half open), and the pouch's swell is handed to rig.py with the sign that swings it out
  on this model; the modeller's new pouch weights fixed the rest.
- **Over other clips** the flinch first folded the neck with the walk's head thrust, and over-shut the eyelids on a
  closed eye. Its head toss is smaller and its eyes only squint now; laid over the walk, run, idle, held and the peck
  it adds no fold.
- **The mane and the hood's edge cards** (on the modeller's newest model) hang from the skull and sink into the neck
  when the head turns on it. The mane now lifts as the neck bends or the head turns, as a bird's nape feathers bunch,
  and big turns are shared with the body. What is left (`faults.txt`: the hood's edge card up to 29 mm in held's
  looks about, up to 24 mm in the eating over the knocked-out pose) needs those cards weighted down the neck as the
  pouch now is.
