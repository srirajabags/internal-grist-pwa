# Working in this repo

This app books real stock in and out of real godowns. A wrong number here sends
someone to a shelf for the wrong thing, or tells a machine operator to cut
fabric that is already on a trolley. Bugs are quiet: they look like plausible
figures and are found weeks later, by a person, on paper.

## The testing rule

**Every decision in `src/domain/` is covered, and every bug fix ships with a
test that fails without it.**

Not "every line". Line coverage is trivially satisfied by a test that asserts
nothing — the job 25-216 bug ran through fully-covered code. Cover the
*decisions*: the branch, the cap, the rounding, the thing that picks one item
over another.

### Prove the test fails first

A test written after a fix, never seen to fail, proves nothing. Before claiming
a fix is done: put the bug back, run the test, watch it fail, restore the fix.
Show that output. If the test passes against the broken code, it is not a test.

When a bug is reported, write the failing test **before** theorising about the
cause. It forces you to reproduce it rather than reason about it — which is how
a wrong theory gets caught in a minute instead of a paragraph.

### Where logic goes

New rules go in `src/domain/`, not inside a component. This is the precondition
for all of the above: logic buried in a 4,000-line view cannot be reached by a
test, and that is the only reason several known bugs here are still untested.

```
src/domain/production/   planning and running a job — the batch planner,
                         ready-stock draw, job ledger, printing list
src/domain/inventory/    stock, godowns, item identity, units
src/domain/orders/       the customer-facing journey
src/grist/               Grist encodings, writes, sync
src/services/            network and platform
src/utils/               genuinely generic helpers, no domain knowledge
```

`src/domain/` has no React and no network in it. Keep it that way.

Tests sit beside the code they test (`readyStock.js` / `readyStock.test.js`) and
each names the incident it holds the line on, so the next person to touch that
function knows what the constraint is for.

## Before saying something is done

- `npm test` passes. Say so, with the count.
- `npx eslint` is clean on the files you touched.
- `npm run build` passes if you changed imports or module layout.

Report failures with their output. "Tests pass" when they were not run is worse
than not running them.

## The gates

- **Pre-commit hook** (`.githooks/pre-commit`) runs the tests. Installed by the
  `prepare` script on `npm install`, via `core.hooksPath`. Fast feedback only —
  it can be skipped with `--no-verify` and only exists on machines that have
  installed dependencies.
- **CI** (`.github/workflows/deploy.yml`) runs tests and a scoped lint, and the
  deploy job `needs: test`. This is the real gate.

The CI lint is scoped to `src/domain src/grist src/services src/utils src/hooks`
because `src/components`, `src/pages` and `App.jsx` carry 31 errors that pre-date
the job. Widen that line when they are cleaned up; do not widen it before.

## Domain notes

- The godown books each article in **one** unit. Rolls and finished bags are
  weighed; patty, sheets and handles are **counted** and carry `Weight_Kg_` of 0.
  Summing the weight column on a counted form reports nothing at all — this has
  caused several bugs. `primaryUnitFor` is the authority.
- A requirement is **not fungible**. 25 bundles of 6x54 side patty and 7 of 6x46
  are different articles answering different orders. Never pool a job's
  requirement into one figure and draw against it.
- Item sizes are always written **smaller × bigger**.
- Grist `/sql` interrupts at about 1 second and user tables carry no indexes, so
  a correlated subquery is usually what timed out.
