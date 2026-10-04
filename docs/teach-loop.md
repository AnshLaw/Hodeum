# Teach Mode: the learning loop

Teach Mode is Hodeum's differentiator: Hodey teaches the task; it never does the task for the
learner. A lesson is a loop of short teaching moves, not a list of instructions read out one by one.

## The loop

| Moment | What Hodey does | Why it teaches |
| --- | --- | --- |
| **Orient** (Hode starts) | One or two sentences on what the learner is about to make and why it's useful (`pack.concept`), then "you do the clicking". Skipped for a learner who already does the first step unprompted. | An advance organizer gives each click a purpose. |
| **Ask first** (step starts) | A new skill starts at *hint*: a guiding question, with a soft glow over the **area** that holds the answer (the tab row, a dialog's buttons, a list), never the answer itself. | Generating the answer beats being told it, and the area cue keeps a novice from getting lost. |
| **Scaffold** (stuck or wrong) | More help, one rung at a time: hint → guide (highlight and instruction) → demonstrate (spotlight, arrow and *why*). A known mistake gets its own correction, with the why. | Help arrives only when it's needed, and only as much as is needed. |
| **Confirm with why** (step done) | "Exactly right", plus the idea behind the step ("Insert holds everything you add to a sheet"), unless the why was already said this step. The why stays on the card until the learner acts again. | Elaborative feedback turns a click into a concept. |
| **Fade** (within and across Hodes) | A skill done without help starts one rung quieter next time. *Observe* is silent ("Your turn: …"). Unaided steps get "you remembered that on your own", or "you've got the hang of it" for a skill learned earlier in the same Hode. | Assistance drops as the skill grows. |
| **Recap and check** (Hode done) | The moves in one line (`pack.recap`), then one recall question with answers to tap (`pack.check`). It can be answered by tap or voice ("Insert", "the first one"), and the feedback carries the why. The card waits for the answer. | Retrieval practice is the strongest known way to make learning stick. |
| **Practise alone** (optional) | "Practice on your own" restarts the Hode with Hodey watching silently from the first step; it steps in only on a mistake or hesitation. Done without help, Hodey says so. | Independent practice is the last rung of the ladder (PRD §5). |

Help and Agent keep their own behaviour. Help stays quiet until asked; Agent guides every step, or
does it with checkpoints. Only Teach orients, asks first, explains on success, recaps and checks.

## What the learner can always say

| Say | What happens |
| --- | --- |
| "Give me a hint", "where?", "I don't see it" | One rung more help. |
| "Show me" (दिखाओ, dikhao) | Straight to a full demonstration. The step won't count as done unaided. |
| "Explain" / "why" | The step's why. In an open-ended Hode, the vision model is asked. |
| "Let me try", "stop helping", "I've got this" | Hodey goes quiet and watches. |
| "I did it" / Look again | Hodey re-reads the screen and finishes the step if it's done. If it can't see the step done, it says so and offers **Skip step**. |
| "Skip", "next step" | Moves past a step Hodey can't see done. Nothing is learned or failed for it. |
| "Practice again" | The practice round, from the success card. |

## Never nag

- Hodey doesn't repeat a line the learner already heard unless they ask (a hint, repeat, look again, "where?", a mode switch, coming back to the app).
- The stuck timer climbs the ladder once per step and then waits quietly. This holds for open goals too, which used to re-ask the vision model every 12 s forever.
- While Hodey re-checks in the background after the learner's action, the guidance card stays up (marked busy) instead of collapsing into the thinking orb.

## Open goals (no task pack)

- The vision model is told what each rung means. A hint asks a question or gives a clue without naming the control, but still points at it so Hodey can light up the area. A demonstration names the control and says why.
- The first reply opens with one sentence on what reaching the goal involves.
- When the learner acted and the model moves on to a new instruction, the step counts as done: it's acknowledged, the next step starts at the mode's level again, and the success card lists every step done.
- The model hears the steps already done, its own last instruction, and the learner's recent actions. Hodey's earlier words are passed as tagged data, never as instructions.
- An unsure target isn't drawn, but the model's line is still said.
- Help with an open goal stands by until the learner asks or gets stuck.
- Once its first step is showing, an open Teach Hode is planned in the background. Hodey looks the goal up (the offline help first, then the web when Settings allows it) and the local model drafts a plan: the idea, each step's control with a question to ask first and why it matters, a recap, and a check. The first step never waits on the plan. Each later look at the screen follows the plan where it fits, and finishing closes with the plan's recap and its check question. If planning fails, Hodey carries on a step at a time.

## Where the learner is

- Every request to the model carries the learner's pointer. Controls near it rank first, and the model is told where it rests.
- When Hodey can't tell which control is meant, it asks once per step: "Move your pointer near the area you're working in." Once the pointer moves and comes to rest, Hodey looks again with it.
- With the Hode's app still open, the learner can step into another app. The step and its card wait quietly, nothing counts as hesitation, and coming back takes a fresh look without repeating the instruction.
- One instruction can walk through several controls: each is lit at once, numbered in the order it's used, with the arrow on the first. A later control Hodey isn't sure of is left out, and the others keep their numbers.

## Speed

- A lesson step that UI Automation can ground is answered by the local planner at once, before any cloud or vision call.
- A step's first screen read reuses the read that finished the previous step when that read already shows the step's control.
- Clicks made while a step is being prepared still count.
- Reasoning for a request the Hode has moved past is aborted.
- A second look at an unchanged screen asks the learner instead of re-sending the identical prompt to the model.
