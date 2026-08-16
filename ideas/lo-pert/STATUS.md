status: in_progress
version: 0.1
started_at: 2026-08-16
last_session_id:
last_run:

## Log
<!-- Newest entries on top. The orchestrator prepends here after each cycle. -->

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
- [x] Wrapper: upstream submodule, flake with the pinned-commit unit check, check-pin.sh
- [x] .oxt skeleton: installs with unopkg, PERT menu, About command, 3 headless tests
- [x] AOA network construction with dummy activities
- [x] Forward/backward passes, floats, critical path
- [x] Layered layout + the pure table-to-diagram pipeline
- [x] Property-based tests over random acyclic tables
- [ ] Draw the state shape from the UNO layer
- [ ] Draw the action (connector) shape
- [ ] The generate command, table to diagram
- [ ] Validation dialogs and non-Draw documents
- [ ] Headless integration tests installing the built .oxt
- [ ] Release workflow, install.sh, README with screenshots

Next: draw the state shape — the grouped three-region circle, inserted on the current
Draw page by a menu command.
