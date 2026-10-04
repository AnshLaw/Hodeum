# Teach Mode: the learning loop

Teach Mode is Hodeum's differentiator: Hodey teaches the task; it never does the task for the
learner. A lesson is a loop of short teaching moves, not a list of instructions read out one by one.

## The loop

| Moment | What Hodey does | Why it teaches |
| --- | --- | --- |
| **Orient** (Hode starts) | One or two sentences on what the learner is about to make and why it's useful (`pack.concept`), then "you do the clicking". | An advance organizer gives each click a purpose. |
| **Ask first** (step starts) | A new skill starts at *hint*: a guiding question, with a soft glow over the **area** that holds the answer (the tab row, the dialog's buttons), never the answer itself. | Generating the answer beats being told it, and the area cue keeps a novice from getting lost. |
| **Scaffold** (stuck or wrong) | More help, one rung at a time: hint → guide (highlight + instruction) → demonstrate (spotlight, arrow, and *why*). A known mistake gets its own correction, with the why. | Help arrives only when it's needed, and only as much as is needed. |
| **Confirm with why** (step done) | "Exactly right" plus the idea behind the step ("Insert holds everything you add to a sheet"), unless the why was already said this step. | Elaborative feedback turns a click into a concept. |
| **Fade** (within and across Hodes) | A skill done without help starts one rung quieter next time; *observe* is silent ("Your turn: …"); remembered steps get "you remembered that on your own". | Assistance drops as the skill grows. |
| **Recap and check** (Hode done) | The moves in one line (`pack.recap`), then one recall question with tappable answers (`pack.check`), answered by tap or voice, with feedback and the why. | Retrieval practice is the strongest known way to make learning stick. |
| **Practise alone** (optional) | "Practise on your own" restarts the Hode with Hodey watching silently from the first step; it steps in only on a mistake or hesitation. | Independent practice is the last rung of the ladder (PRD §5). |

Help and Agent modes keep their own behaviour: Help stays quiet until asked, and Agent guides every
step or does it with checkpoints. Only Teach orients, asks first, explains on success, and checks.

## Never nag

- Hodey doesn't repeat a line the learner already heard unless they ask: hint, repeat, look again, or "where?".
- The stuck timer climbs the ladder once per step and then waits quietly. This holds for open goals too,
  which used to re-ask the vision model every 12 s forever.

## Open goals (no task pack)

The vision model gets the same ladder: a hint names the area to look in but never the control, and a
demonstration names the control and says why. The hint's target is drawn as an area glow, not a
precise ring.

## Speed

- A step's first screen read reuses the read that finished the previous step when it's fresh, so the
  next instruction doesn't wait on another UI Automation walk.
- The skill record loads alongside the screen read, not before it.
