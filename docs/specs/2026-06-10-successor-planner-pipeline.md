# The successor: a planner pipeline around Pail

- **Status:** vision + rung ladder, not started. Captured from design discussion 2026-06-10.
- **Thesis:** big features don't need a new tool — they need a **planning stage in front of
  Pail** and **stronger gates underneath it**. Pail stays the small, proven executor at the core
  (composition over growth). v2 (Docker) and v3 (parallel) are the executor's internals and slot
  in unchanged.

## Why Pail alone doesn't do big features

"Every big feature can be decomposed into Pail-sized tasks" is half true:

- **Decomposition is the engineering.** By the time an issue is precise enough for an unattended
  agent, the architecture, interfaces, and sequencing have been decided — the human did the
  thinking and moves up a level: from implementer to architect-and-reviewer. The win is real
  (typing is where the hours go) but the human doesn't disappear.
- **Coherence drifts across seams.** Independent agents produce locally-correct, globally
  drifting code (duplicated helpers, naming drift). Small fixes dodge this because the existing
  codebase is the style guide; a 12-task feature creates new surface with no precedent.
- **Verification debt compounds.** The check is compile-level; a human eyeballs single fixes
  shut. For a feature the gap grows faster than the task count.
- **Not everything decomposes upfront.** Exploratory work, UX iteration loops, refactors with
  global invariants: the design *emerges* from implementation. Out of scope for this model.
- **The real ceiling is review bandwidth, not agent capability.** A fleet that implements
  overnight produces a morning of diffs to trust-but-verify. Making output *cheap to verify* is
  the successor's hardest problem — and Pail's DNA (two-layer verification, human promotion
  gate, plain-English summaries) already points at it.

## The pipeline

```
idea ──/to-prd──► PRD ──/to-issues──► issue DAG (Blocked-by + Acceptance + afk label)
        (skills, interactive, human signs the plan)         │
                                                            ▼
                    Pail executor (v2 containers, v3 topological parallel)
                                       │
                    Verifier: per-task acceptance + whole-diff coherence pass
                                       │
                    morning report (one evidence bundle) ──► human promotes
```

**The boundary principle:** everything *before* the human signs the plan is interactive →
skills running in a normal Claude session. Everything *after* is unattended → Pail code. The
signature moment — applying the afk label to a reviewed chain — is the API boundary between the
two halves. The planner ships as markdown, not as a binary.

## The front half already exists

`~/.claude/skills/to-prd` and `~/.claude/skills/to-issues` (Matt Pocock's skills) are ~80% of
the planner:

- **to-prd:** conversation → PRD. Sketches the *seams at which the feature will be tested* and
  checks them with the user — exactly where acceptance checks get decided. Publishes the PRD as
  a tracker issue (the **Parent**).
- **to-issues:** PRD → **tracer-bullet vertical slices**. Each slice cuts thinly through every
  layer and is demoable alone — better than horizontal decomposition because agents don't invent
  interfaces toward each other (attacks the coherence problem at the root). Classifies each
  slice **HITL vs AFK** (Pail only gets the AFK ones), emits **Blocked by** with real issue
  numbers (publishes blockers first), includes acceptance-criteria checkboxes, and has a
  mandatory **quiz-the-user approval gate** — the human signature, already built in.

Bonus: Parent references give the morning report its grouping for free ("feature X: 5/7 slices
landed" = group-by-parent). to-issues' "do NOT close or modify any parent issue" is already
compatible with `closeMode: "comment"`.

### The three gaps (all on Pail's side, all small)

1. **Pail can't read `Blocked by`.** v1 only respects the blocked *label*. Teach `issues.ts` to
   parse the body's Blocked-by reference and skip until the blocker is **satisfied = closed, or
   merged earlier in this same run** (worktrees are cut from the integration branch, so a
   dependent slice literally builds on its blocker's merged code within one drain). Guard the
   cross-promotion gap: if the integration branch was deleted at promotion but the blocker isn't
   on trunk yet, the dependent must wait.
2. **Acceptance criteria are prose; Pail needs them executable.** Add a Pail dialect: an
   `## Acceptance` block whose entries are runnable (a command, a grep, a check invocation),
   written by the *planner* at plan time and run by Pail **independently** after the agent
   finishes — test author and implementer are different minds, which kills agent-grades-its-own-
   homework structurally. (Prior art: learn-wings `slice-workflow` gates — "zero `supabase.*` by
   grep + build green" — that's a hand-written acceptance block.)
3. **Vocabulary alignment.** The skills speak `ready-for-agent`; a repo speaks its own labels
   (Inact: `pail-afk`). Map "AFK triage label" per-repo in the skills' setup so to-issues output
   comes out armed.

## How v2/v3 fit: executor internals that change what the gates can be

Docker and parallelism never appear as pipeline boxes — they live inside the EXECUTOR box.

- **v3 (parallel) is what makes the planner worth building.** With a planned DAG, the v3
  dispatcher becomes a **topological scheduler**: a task is eligible the moment its Blocked-by
  edges are merged; independent subtrees run concurrently, chains run in order. The planner
  decides how wide the DAG is; v3 exploits exactly that width. Rung 1 (Blocked-by parsing) is
  shared infrastructure for both.
- **v2 (Docker) upgrades the Verifier, not just safety.** Runtime-level acceptance checks
  ("spin up the dev server, hit the endpoint, screenshot the modal") need a port, a process,
  maybe a browser — parallel agents on the host would fight over port 3000 and the dev DB.
  Per-task containers give each acceptance check its own sealed network and filesystem.

```
planner writes runtime acceptance checks
        └─ requires per-task sandboxes (v2)
                └─ which is also what makes parallel execution safe (v3)
                        └─ which is what makes planned DAGs fast
```

## The rung ladder (each ships alone and pays for itself)

| Rung | What | Size | Done when |
|---|---|---|---|
| **0** | **The free experiment — run before writing any code.** `/to-prd` + `/to-issues` on one small real feature; file the AFK slices in dependency order. v1's lowest-number-first ordering accidentally respects publish-blockers-first, so today's Pail may drain a 3-slice chain unmodified. | zero code | We know whether rung 1 is urgent. |
| **1** | **Blocked-by scheduling** in `issues.ts`: parse body reference, satisfied = closed ∨ merged-this-run, with the cross-promotion guard. | tens of lines | A 3-slice chain drains in order even when filed out of order; a dependent whose blocker failed gets skipped, not attempted. |
| **2** | **Acceptance blocks**: Pail runs a per-issue `## Acceptance` block (if present) independently, alongside the global check; failures land in the needs-human comment. Useful immediately for *single-issue* runs — criteria can be hand-written today, no planner needed. | small; `issues.ts` (parse) + `check.ts`/`run.ts` (execute, report) | An issue with a failing acceptance block is flagged needs-human even though the global check is green. |
| **3** | **Morning report**: one evidence bundle per drain (per-task summaries, diffs, acceptance results, screenshots), grouped by Parent — instead of N issue comments to hunt down. The review-bandwidth product. | report generator, no loop changes | One artifact answers "what landed, what failed, what do I promote?" |
| **4** | **Planner alignment**: per-repo label vocabulary for to-prd/to-issues; teach to-issues the executable-acceptance dialect. Human-drafted plans first, agent-drafted second. | markdown, not code | `/to-issues` output is armed for Pail with no manual editing. |
| **5** | **v2 then v3** per the existing roadmap — containers, then the topological parallel dispatcher consuming rung 1's edges. | per ROADMAP.md | Independent DAG subtrees drain concurrently. |

**Rung 2 before the planner, always:** it strengthens even today's single-issue runs, every later
rung depends on it, and building the planner first would put the most speculative part on the
weakest gate.

## Carried invariants (do not regress)

All of v1's: two-layer verification, never touch trunk, human promotes, plain-English output,
minimal-first. Plus one new: **the planner and the executor never share a mind** — whoever wrote
the acceptance check must not be the agent implementing against it.
