# Pail Roadmap — v2 (Docker) and v3 (Parallel)

- **Status:** v1 shipped (serial + worktree isolation, on the host). v2 and v3 are planned, not started.
- **Source of truth for v1:** `docs/specs/2026-06-09-pail-v1-design.md`.

## The ladder, and why each rung is small

Pail was built so that each later version is a **small, isolated change** — that's the whole point of the modular structure:

| Version | Adds | What actually changes |
|---|---|---|
| **v1** (done) | serial loop, git-worktree isolation, host execution | — |
| **v2** | a Docker sandbox per agent | **only `agent.ts`** |
| **v3** | parallelism (N agents at once) | **only `run.ts`** |

The seams hold because every other module operates on a **worktree path on the host**, and Docker bind-mounts that path into the container — so the agent's edits land on the host worktree, where `check.ts` and `merge.ts` already know how to find them.

## Guiding constraints (carried from v1 — do not regress)

Every version must preserve the v1 invariants:

- **Two-layer verification.** The agent self-checks; then Pail re-runs the check **independently** before merging. Never merge on the agent's word.
- **Never touch trunk.** Pail only ever merges onto the integration branch. The human promotes `integration → trunk` via PR.
- **Plain-English output.** Every issue write (close / flag-for-human) leads with the human-summary header so `orient` can lift it.
- **Minimal-first.** Add the smallest thing that delivers the rung. Defer anything not yet needed (YAGNI).

---

## v2 — Docker isolation

### Goal
Run each agent inside a **disposable container** instead of on the host, so the agent physically cannot touch the host machine — and so we can safely grant it full autonomy.

### Why
- **Removes the host blast radius.** v1 runs `claude` on your real machine with `--permission-mode auto` (classifier-guarded *because* there's no jail). A container is the jail.
- **Unlocks full autonomy.** With a jail, we flip `claudeArgs` to `--permission-mode bypassPermissions` safely — the agent can do anything, but only inside a box you throw away.
- **Reproducible environment.** A `Dockerfile` pins the toolchain; every agent gets an identical clean box.
- **Prerequisite for v3.** Sealed boxes are what make parallel agents safe to run at once.

### The seam: only `agent.ts` changes
v1's `agent.ts` runs `claude -p <prompt> --permission-mode auto` with `cwd = worktreePath`. v2's `agent.ts` instead runs `claude` **inside a container** with the worktree **bind-mounted** in. Conceptually:

```
docker run --rm \
  -v <worktreePath>:/work -w /work \
  -v <claude-credentials>:/root/.claude:ro \
  <image> \
  claude -p <prompt> --permission-mode bypassPermissions
```

`worktree.ts`, `check.ts`, `merge.ts`, `issues.ts`, `run.ts` are untouched: the container writes to the bind-mounted worktree, so the agent's commits land on the host worktree branch exactly as before.

### How verification stays clean
- The **agent self-checks inside the container** (it's told to run `{checkCommand}` and get green).
- **Pail's independent check (`check.ts`) keeps running on the host** against the worktree — *unchanged*. This preserves the "only `agent.ts` changes" seam and keeps the trust-but-verify gate outside the box the agent controls.

### Config additions (v2)
```jsonc
{
  // ...v1 config...
  "claudeArgs": ["--permission-mode", "bypassPermissions"],  // safe inside the jail
  "sandbox": {
    "image": "node:22",          // or a path to a per-repo .pail/Dockerfile
    "mountClaudeAuth": true       // bind-mount host claude credentials read-only
  }
}
```

### Open design decisions
- **claude auth in the container.** The CLI needs credentials. Lean: bind-mount the host's claude credentials dir read-only (simplest). Alternative: pass an API key via env.
- **Image source.** A sensible default image vs. a per-repo `.pail/Dockerfile` (needed when the project's toolchain is non-trivial). Start with a configurable image string; add Dockerfile support if a real repo needs it.
- **Network.** The agent needs network (claude API, dependency installs). Keep network on for v2; consider locking it down later.
- **Provider abstraction.** Keep it a single `runInDocker(...)` helper in `agent.ts` for now. Generalizing to Podman / Vercel microVMs (like real Sandcastle) is a *beyond-v3* concern — don't abstract before the second provider exists.

### Risks / trade-offs
- Docker Desktop must be running; image build/pull adds startup latency (cache it).
- Mounting credentials into a container is a real security consideration — keep it read-only and be deliberate.
- Slower per-task than host execution.

### Done when
- `agent.ts` runs `claude` in a `--rm` container with the worktree bind-mounted; the agent's edits + commit land on the host worktree branch.
- A first run with `bypassPermissions` completes a task end-to-end with the host filesystem untouched outside the worktree.
- `agent.test.ts` asserts the docker invocation (via the mocked `exec`); all existing tests still pass.

---

## v3 — Parallelism

### Goal
Run several agents on several worktrees **at the same time**, so independent `afk` issues get worked concurrently — real parallel AFK, the full Sandcastle.

### Why
- **Throughput.** v1/v2 are serial (one task at a time). Parallel = N tasks at once.
- It's the capability that motivated building Pail in the first place.

### The seam: only `run.ts` changes
The per-task pipeline — create worktree → run agent (in its container, v2) → independent check → merge — is unchanged. `run.ts` changes from a sequential `while` loop into a **bounded concurrent dispatcher with a serialized merge queue**.

### The two hard parts (the real design)
1. **Serialize the merges.** Agents implement + check in parallel, but `mergeInto` must run **one at a time** onto the integration branch — concurrent merges would race the git index and muddy conflict detection. So: parallel implement/check, single-file merge queue (a mutex). This is the key concurrency design.
2. **Don't double-grab issues.** With several workers calling `getNextTask` concurrently, two could grab the same issue. Mark an issue **in-progress** when picked (e.g. add a `pail-in-progress` label) so concurrent fetches skip it; remove it on completion. (New, small addition to `issues.ts`.)

Each task remains **fully isolated** — its own worktree + its own container — which is exactly why **v2 (Docker) is the prerequisite**: sealed boxes can run concurrently without fighting over host resources, ports, or a shared dev DB.

### Config additions (v3)
```jsonc
{
  // ...v2 config...
  "maxParallel": 3,                  // concurrency cap — don't spawn unbounded agents
  "inProgressLabel": "pail-in-progress"
}
```

### Open design decisions
- **Caps in a parallel world.** `maxIterations` and `maxConsecutiveFailures` need to become *global* counters across workers (with a global circuit breaker), not per-worker.
- **More conflicts, by design.** Serialized merges of parallel work mean later merges conflict more often. v1's conflict path (abort + `flag-for-human`) already handles this; a *re-base-and-retry* option is a possible future nicety — deferred.
- **Dependencies matter more.** In parallel, you don't want to start B before A if B depends on A. v1 only respects the `blocked` label; a real dependency **DAG** (from issue `Depends on` / `Blocked by`) becomes more valuable here. Can stay deferred, but revisit.

### Risks / trade-offs
- **Cost:** N agents = N× concurrent API spend. The cap is the cost lever.
- **Resources:** N containers at once.
- Added complexity: the merge queue + in-progress tracking.

### Done when
- `run.ts` dispatches up to `maxParallel` tasks concurrently, each in its own worktree + container.
- Merges are serialized through a queue — no git index corruption under parallel load.
- Issues are marked in-progress when picked, so no two workers do the same one.
- `run.test.ts` simulates N concurrent tasks with faked deps and asserts merge serialization + that all complete and report correctly.

---

## Beyond v3 (parking lot — not scheduled)

- **More sandbox providers:** Podman (rootless), Vercel microVMs — generalize `agent.ts` once a second provider is actually wanted.
- **PR-per-task hand-off:** an alternative to the batch integration branch (push each green task + `gh pr create`). Considered and deferred in v1.
- **Dependency DAG scheduling:** order tasks by issue `Depends on` / `Blocked by` instead of just the `blocked` label.
- **Composing with `verification.md`:** if a target repo opts into the runtime-verification system, those verifiers run inside its `check` — so Pail's "green" gets stronger for free. No Pail change needed; just a stronger gate.
