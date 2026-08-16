status: done
version: 0.1
started_at: 2026-08-16
last_session_id:
last_run:

Difficulty estimate: hard, as planned. The graph work (dummy activities, event
identity, numbering) and the extension packaging were each about as much trouble as
expected; the two things that could have sunk the design — PyUNO under nix, and
connectors gluing to grouped shapes — were settled in the M0 spike and cost nothing
afterwards.

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

2026-08-16 — **0.1 done, released and verified installable.**
[v0.1](https://github.com/gortazar/lo-pert/releases/tag/v0.1) carries
`lo-pert-0.1.oxt` and `SHA256SUMS`; `install.sh` was run from a clean directory with
a throwaway HOME against that published asset, and the installed extension then drew
the worked example (7 states, 6 activities) when driven over the UNO bridge.
`nix flake check` runs 80 unit tests, 11 headless tests against the installed .oxt,
and the packaging check; CI is green upstream and the wrapper pin check is green
here.

2026-08-16 — M0 (spike), M1 (skeleton) and M2 (the pure core) done: 76 unit tests
including hypothesis properties, and 3 headless tests against the installed .oxt.

2026-08-16 — M0 (spike) done, M1 (skeleton) started. The two design-sinking risks are
answered against nixpkgs libreoffice 25.8.5.2: PyUNO imports from the flake's own
python3, and ConnectorShapes do glue to GroupShapes, follow them when they move and
survive an .odg round trip. The pure core has its first piece (precedence table
parsing and validation) upstream and green.

## Units
<!-- The honest progress report: one line per unit of work, ticked only once it is
     committed with its tests passing. Refresh this at every unit, not at session end.
     Keep "next" to the single unit being started now. -->
- [x] Precedence table parsing and validation (26 unit tests, upstream `src/lopert/table.py`)
- [x] M0 spike: `import uno` under nix; connector glued to a group shape survives moves and save/reload
- [x] Wrapper: upstream submodule, flake with the pinned-commit checks, check-pin.sh
- [x] .oxt skeleton: installs with unopkg, PERT menu, About command, protocol handler
- [x] AOA network construction with dummy activities
- [x] Forward/backward passes, floats, critical path
- [x] Layered layout + the pure table-to-diagram pipeline
- [x] Property-based tests over random acyclic tables
- [x] State shape: grouped three-region circle, drawn from the UNO layer
- [x] Action shape: connector glued to two state groups, labelled `id(duration)`
- [x] Generate command: Calc selection to drawn diagram, page sized to the network
- [x] Validation errors as one dialog naming every offending row, drawing nothing
- [x] Headless integration tests installing the built .oxt (11, inside `nix flake check`)
- [x] Release v0.1, install.sh, README with the generated screenshot
- [x] Installer verified from a clean profile against the published asset

Next: nothing — 0.1 is delivered. A later entry in `README.md` would start 0.2.

## What "done" covers

Every feature in `PLAN.md`, delivered upstream at
[a67eb04](https://github.com/gortazar/lo-pert/commit/a67eb04) and released as v0.1:

- A `.oxt` installable with `unopkg add` (or the one-line `curl | sh` installer),
  contributing a **PERT** menu to Draw, Impress and Calc through `Addons.xcu` and a
  PyUNO protocol handler.
- **Diagram from Precedence Table**: reads the selected Calc range, builds the
  activity-on-arrow network with the dummy activities precedence requires, computes
  early and late times, floats and the critical path, lays it out left to right by
  level with barycentre ordering, and draws it — states as grouped three-region
  circles (early, late, event number), actions as connectors glued to those groups
  and labelled `id(duration)`, dummies dashed and unlabelled, the critical path red.
- **Insert State** and **Insert Action Between Two States** for editing by hand.
- Validation: cycles, unknown predecessors, duplicate ids, missing, negative or
  non-numeric durations, and an empty table each produce one dialog naming the rows
  at fault, with nothing drawn.
- A core (`table`, `network`, `times`, `layout`, `diagram`) that imports no UNO — a
  test asserts it — so 80 unit tests, hypothesis properties included, run without
  LibreOffice. The properties are what pin down "correct": the network implies
  exactly the transitive closure of the stated precedences, never one constraint more
  or less.
- `nix flake check` upstream runs those unit tests, 11 headless tests that install
  the built .oxt into a throwaway profile and drive the menu commands over the UNO
  bridge, and a packaging check. Green in CI on every push.
- Answered questions honoured: Calc is the input, Impress is a target (with its own
  headless test), labels carry identifier and duration, a single expected duration
  per activity, the diagram is generated once and freely editable, and the critical
  path is marked.

Known deviations, deliberate and documented in the README: parallel activities
between the same two events are split by an extra dummy so no two arrows overlap, and
`Insert State`/`Insert Action` place placeholder text to type over rather than
prompting in a dialog.
