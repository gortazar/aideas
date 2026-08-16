# Plan: lo-pert — a LibreOffice extension for PERT diagrams

Difficulty estimate: hard — drawing the shapes is routine UNO work, but turning a precedence table
into an activity-on-arrow network is a real graph problem (dummy activities, node identity, layout),
and the LibreOffice extension packaging plus a headless UNO test harness are each a project's worth
of friction on their own.

## Context

The diagram asked for is the classic **activity-on-arrow** (AOA) PERT network, the one taught with
"nodos y flechas": *states* (events) are circles, *actions* (activities) are arrows that run from
one state to another and carry a label. That reading is forced by the idea's own wording — actions
"start on a state and end on another state" — and it is also what makes early/late times per state
meaningful. The alternative convention (activity-on-node) puts the times inside the activity boxes
and has no separate event circles, so it is out of scope.

The circle is divided into three regions: two numbers in the upper half, one in the lower half. The
plan assumes **upper-left = early time (E), upper-right = late time (L), lower = event number**, and
asks about it in *Open Questions* because textbook variants disagree and getting it backwards makes
every generated diagram wrong.

The computation, stated precisely (this is the contract the tests encode):

- Input is a precedence table: one row per activity, with an identifier, a duration, and the list of
  its *immediate* predecessors.
- The network gets a single start event (all activities with no predecessors leave it) and a single
  end event (all activities with no successors arrive at it).
- Two activities share a start event exactly when they have the same set of immediate predecessors;
  where predecessor sets overlap without being equal, **dummy activities** (zero duration) carry the
  precedence without implying a real one. Dummies are unavoidable in AOA — they are not an invented
  feature — and minimising their number is a known NP-hard problem, so the goal is *correct and
  deterministic*, not *minimal*.
- Forward pass: `E(start) = 0`, `E(j) = max(E(i) + d(i→j))` over arcs entering *j*.
- Backward pass: `L(end) = E(end)`, `L(i) = min(L(j) − d(i→j))` over arcs leaving *i*.
- Events are numbered so that every arc runs from a lower to a higher number (topological order),
  which is the convention the diagram is read with.

An input that is cyclic, references an unknown predecessor, or declares an activity twice is
rejected with a message naming the offending rows — not drawn half-way.

## Features

- **LibreOffice Draw extension** — a `.oxt` installable with `unopkg add`, contributing its own menu
  and toolbar entries via `Addons.xcu` and a dispatch handler, implemented in Python over PyUNO
  (boring and testable; Basic would not be).
- **State shape** — inserts a circle divided into three regions with the event number and the early
  and late times, built as a grouped shape (ellipse + divider lines + three text shapes) so it moves
  and scales as one object, and re-editable: changing a number updates only that text region.
- **Action shape** — inserts a labelled connector from one state to another, using a real
  `ConnectorShape` bound to the two grouped shapes so the arrow stays attached when either state is
  dragged. The label rides with the connector.
- **Automatic diagram from a precedence table** — reads the table, builds the AOA network, computes
  every event's early and late times, lays the diagram out and draws it on the current Draw page in
  one command.
- **Dummy activities** — inserted where precedence requires them, drawn distinctly (dashed,
  unlabelled, zero duration) so the diagram stays readable and correct.
- **Deterministic layered layout** — events are placed left to right by their level in the network
  (longest path in arcs), spread vertically within a level by a barycentre pass to keep crossings
  down; the same table always produces the same drawing.
- **Input validation with useful errors** — cycles, unknown predecessors, duplicate activity ids,
  negative or non-numeric durations, and an empty table each produce a dialog naming the rows at
  fault, and nothing is drawn.
- **Pure, UNO-free core** — parsing, network construction, the forward/backward passes and layout
  live in a module that imports no UNO, so the interesting logic is unit-testable without ever
  starting LibreOffice. The UNO layer only turns a laid-out network into shapes.
- **Reproducible environment + green CI** — `flake.nix` providing `libreoffice`, Python and the test
  runner; `nix flake check` runs unit tests, the headless rendering tests and a build of the `.oxt`;
  CI on push and PR upstream, plus the path-filtered pin check in this repo.
- **Release and install without building** — every finished entry tags `v<version>` upstream with
  the built `lo-pert-<version>.oxt` attached, plus an `install.sh` that downloads the latest asset
  and runs `unopkg add --force`. `README.md` opens with that one-liner, with the manual
  Tools ▸ Extension Manager route documented underneath.
- **Documented behaviour** — `README.md` with the install line, a worked example (precedence table
  in, screenshot of the diagram out), the node-layout legend, and the dummy-activity rule.

## Approach

1. **M0 — Spike.** Two throwaway scripts against a running `soffice`: one that draws a grouped
   three-region circle and a connector bound to two groups, one that connects over a socket from the
   test environment. Settles the two things that can sink the whole idea — whether connectors stay
   glued to grouped shapes at the anchor points we want, and whether `import uno` works under nix —
   before any structure is built on top.
2. **M1 — Skeleton.** Upstream repo, `flake.nix`, `.oxt` layout (`description.xml`, `META-INF/`,
   `Addons.xcu`, the Python component), a menu entry that opens a "hello" dialog, packaging and
   install verified from a clean profile, CI green. An extension that installs and does nothing is
   already a checkpoint worth having.
3. **M2 — The core, tests first.** Table model, validation, AOA construction with dummies, event
   numbering, forward/backward passes. No UNO anywhere in this milestone.
4. **M3 — Drawing primitives.** State shape and action shape as user-invoked commands, exercised
   headless.
5. **M4 — Layout and generation.** Layered layout, then the single command that goes from table to
   drawn diagram, on the worked example and a handful of adversarial tables.
6. **M5 — Errors and polish.** Validation dialogs, sensible behaviour on a non-Draw document, page
   sizing for large networks.
7. **M6 — Ship.** README with screenshots, release workflow producing the `.oxt`, `install.sh`
   verified from a clean directory against the published asset.

## Testing

Three layers, all runnable headless:

- **Unit** — the core is pure functions over plain data: precedence table → network → times →
  layout. This is where the edge cases live: parallel activities sharing predecessors, partially
  overlapping predecessor sets (the dummy-generating case), a single activity, disconnected
  fragments, a diamond, and the textbook example whose critical path is known by hand.
- **Property-based** — over randomly generated acyclic tables, assert the invariants rather than
  fixed outputs: every arc goes low-numbered event → high-numbered event, `E(i) ≤ L(i)` everywhere,
  `E(end)` equals the longest path through the original activities, and every original precedence
  relation is still reachable in the built network (dummies never add or drop a constraint).
- **Headless integration** — `soffice --headless --accept=socket,...`, driven over the UNO bridge:
  install the built `.oxt`, run the generate command on a fixture table, then read the resulting
  draw page back and assert shape counts, group structure, connector endpoints and the text in each
  region. Slow, so kept to a few end-to-end cases.

## Risks / things to verify early

- **PyUNO under nix.** `import uno` needs LibreOffice's own Python paths; nixpkgs' `libreoffice` is
  wrapped in ways that have historically made this awkward. M0 settles it; the fallback is driving
  tests through the bundled interpreter rather than the flake's `python3`.
- **Connectors and groups.** If `ConnectorShape` will not glue to a group, or will not target a
  chosen glue point on it, the state shape has to become a single custom shape with formatted text
  instead — a different design, best discovered in M0 and not in M4.
- **Dummy activities are the hard part.** The naive construction (one event per distinct predecessor
  set) is correct but can emit redundant dummies; the property tests above are what keep "correct"
  from quietly becoming "correct-looking".
- **Extension packaging is fiddly and fails loudly only at install time.** A wrong `description.xml`
  or manifest entry yields an extension that installs but contributes no menu. Treat `unopkg add`
  followed by an assertion that the command is dispatchable as part of CI, not as a manual step.
- **LibreOffice version churn.** `Addons.xcu` and the Python component registration are stable but
  not frozen; pin the LibreOffice version in the flake and state the minimum supported version in
  the README.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Which number goes where in the state circle? The plan assumes upper-left = early time, upper-right = late time, lower = event number. The other common convention puts the event number on top and the two times below. Which one is intended?
- [ ] Where does the precedence table live? Options: a selected cell range in a Calc sheet (the diagram then goes to a new Draw document), a table typed into a dialog inside Draw, or a CSV/text file picked from disk. Which is the primary input — and are the others in scope at all?
- [ ] Is Draw the only target application, or must the extension also work in Impress (same drawing API) and be launchable from Calc where the table lives?
- [ ] What exactly does an action's label show — the activity identifier only, or identifier plus duration (e.g. `A(3)`)? And does "PERT" here mean the three-estimate form (optimistic / most likely / pessimistic, combined into an expected duration), or a single duration per activity as in CPM?
- [ ] Is the diagram generated once and then freely hand-editable, or must it stay linked to its precedence table so that editing a duration recomputes the times in place? The second is a substantially larger piece of work.
- [ ] Should the critical path (and per-event slack) be marked in the drawing? It falls straight out of the early/late times, but the idea does not ask for it, so it is not in *Features* until you say so.
- [ ] Is publishing to extensions.libreoffice.org required for "installable", or is a GitHub release carrying the `.oxt` plus the `install.sh` one-liner enough?
