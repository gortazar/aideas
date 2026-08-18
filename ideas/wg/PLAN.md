# Plan: wg — an asynchronous, git-transported wargame

Difficulty estimate: hard — a deterministic global military simulation is a project on its own, and
it is bolted to a genuinely hard distributed-systems problem: hidden information over a transport
(git branches) where every participant can read every byte and there is no trusted server.

This is the idea's first entry, so it delivers **v0.1**.

## Context

Five things shape this before any feature list. They are the reason the entry asks for careful
planning rather than a prototype.

### 1. Hidden information over a public transport is the central problem

Every player can `git fetch` every other player's branch and read it. Anything a submarine does that
is written in cleartext is not hidden. Encrypting it to the owner alone does not work either,
because the idea also says *each player runs a referee* — and a referee that cannot read the orders
cannot resolve the turn. Replicated referees plus true secrecy plus no trusted party is, in the
general case, multi-party computation; that is out of scope for a game played among friends.

The way out, and the architecture this plan builds on, is **commit now, audit later**:

- Orders for tick *T* are published as a **sealed envelope**: ciphertext plus a cleartext
  `commitment = H(plaintext ‖ nonce)`, signed by the player's key. Everybody stores everybody's
  commitment; nobody can retroactively change what they ordered.
- What the world can legitimately observe is published **in cleartext** as an *observation report*,
  by the party being observed. B's engine knows B's true positions and knows A's published sensor
  coverage, so B's engine computes "am I detected?" and emits the contact itself. The observed party
  discloses; it does not wait to be found.
- Keys are released on a schedule — when a unit is destroyed, surfaces, is detected, or when the
  game ends. Once released, **any player can replay the tick and check that every disclosure the
  rules demanded was actually made**. Cheating is not prevented; it is made provable after the fact
  by anyone, with no trusted party. Among people who deliberately added each other to a repo, that
  is the right threat model, and it is the same one postal and play-by-email wargames have used for
  decades.
- For groups that want prevention rather than detection, the **same engine** runs in `authority`
  mode: envelopes are additionally encrypted to one designated instance (the host's), which is the
  only holder of ground truth and publishes canonical contact reports to a `referee` branch. This is
  a key-distribution policy, not a second codebase — the open question below is only about which
  mode is the default.

Two supporting mechanics fall out of this and are not optional:

- **The tick beacon.** The per-tick RNG seed is `H(all players' commitments for T ‖ scenario id ‖ T)`.
  Orders are committed before the beacon exists, so nobody can grind a favourable roll, and every
  replica derives the same seed.
- **Cross-notarisation.** Each player's tick commit records the head hashes it observed on every
  other branch. A force-push or a rewritten history is then detectable by anyone. Git's own
  immutability is doing the heavy lifting; we just have to reference it.

And the metadata leaks have to be closed deliberately: **every player commits every tick**, even
with no orders, envelopes are **padded to a fixed size**, and commit timestamps are normalised to
the tick boundary. Otherwise "B pushed a big commit at 03:00" is itself intelligence.

### 2. OpenStreetMap is the wrong dependency at runtime — and probably at build time too

The entry asks for an opinion, so, plainly:

- **OSM tile servers are not for this.** The OSMF tile usage policy forbids bulk downloading and
  systematic use by applications, requires an identifying User-Agent, and asks that apps not hardcode
  `tile.openstreetmap.org`. Nominatim is capped around one request per second and Overpass is a
  shared research resource. A game with several players each running a client that redraws a world
  map is exactly the pattern those policies exist to stop. There is also no network dependency worth
  having in a game whose whole point is that it works offline and asynchronously.
- **OSM data is also more than we need, and its licence is contagious.** Geofabrik extracts are
  ODbL: a derived database — which a baked game grid is — carries share-alike obligations. Nothing
  here is unmanageable, but it is a real constraint for something published as a template repo.
- **Recommendation: Natural Earth**, public domain (no attribution required, no share-alike), 1:50m
  and 1:10m vector coastlines, national borders, bathymetry, ports, airports and populated places.
  Tens of megabytes, versioned, stable. It is baked **at build time** into a committed, checksummed
  binary map artefact; the game itself makes no network calls to any map service, ever.
- **For the later GUI**, when it comes: MapLibre GL over a self-hosted **PMTiles** basemap — one file,
  no API key, no tile server, no usage policy to breach — or, if a hosted basemap is wanted, a
  provider with an explicit API key (MapTiler, Protomaps, Stadia). Not raw OSM tiles.
- **Geometry.** Unit positions are continuous lat/lon in fixed-point microdegrees; **H3** (Apache-2.0)
  provides the spatial index for fog-of-war queries, terrain lookup and ASCII rendering buckets. H3
  resolution 2 is roughly 6k cells worldwide and resolution 3 roughly 41k — the exact figures and the
  choice between them get settled and recorded in P0, not guessed at here.

### 3. Determinism is a hard requirement, not a quality goal

Every replica must compute byte-identical state from identical inputs, or the game silently forks
and nobody notices until two players disagree about who won a battle. That means: all
game-affecting arithmetic in integers or fixed-point, no floating point in the resolution path,
one specified PRNG (ChaCha20 from the beacon), ordered iteration everywhere (no hash-map traversal),
no wall-clock, no locale, no environment. Great-circle distance is precomputed or done in fixed-point
with a pinned implementation. A **state hash** is committed each tick, and divergence is therefore
detected on the next fetch rather than three sessions later.

### 4. The real-world data is a research task, not a lookup

Armed forces, budgets, upkeep share, alliances, population and GDP (PIB) for ~195 countries do not
exist in one clean machine-readable place. World Bank (CC-BY-4.0) covers population and GDP; SIPRI
covers military expenditure with a non-commercial-use-plus-attribution licence; order of battle is
IISS *Military Balance* territory, which is not redistributable. The plan therefore treats the
country dataset as a **curated, sourced, hand-checked data file** with a documented provenance
column per field, plus a plausible generic profile for countries nobody has curated — not as a
scrape. See the open questions.

### 5. Two products in one repository

The engine is a released binary that people install; the game is a repository a group instantiates.
Keeping them in one upstream repo means a game's rules can drift from its engine. The plan keeps the
canonical rules and scenario under `template/` in the engine repo, has `wg new-game` materialise it,
and pins the **engine version and ruleset hash into the game repo** so a mismatch is refused rather
than silently resolved differently on two machines.

Assumptions, stated rather than asked: **Rust** for the engine and TUI (`ratatui`, `serde`, `age`
for envelopes, `ed25519` for signatures, the `git` CLI for transport), because a single static
binary per platform is what the shipping rules want and because determinism is easier to defend
without a GC or a JIT; the TUI is the v0.1 UI and the GUI is explicitly out of scope; game time is
decoupled from real time by a configurable tick length.

## Features

- **Deterministic simulation core** — a pure, side-effect-free engine: `(state, orders, beacon) →
  (state', events)`. No I/O, no clock, no floats in the resolution path. It is the only thing that
  may change game state, and it is replayable from the journal to the same state hash on every
  machine.
- **Nations and their economy** — each country carries population, GDP, %GDP to defence, the
  resulting budget, an upkeep fraction (salaries, maintenance, fuel) consumed automatically each
  tick, and the discretionary remainder the player actually spends. Alliances are modelled with
  their obligations. Overspending degrades readiness rather than being forbidden — going broke is a
  strategic outcome, not a validation error.
- **Forces and procurement** — land formations, surface groups, submarines, air wings, and strategic
  assets (satellites, ground radar, SAM belts). Each has readiness, supply, fuel and strength.
  Procurement orders have cost, lead time and a delivery tick; you buy now and receive later.
- **Movement orders over real geography** — multi-tick movement plans along great-circle legs with
  terrain, sea and air constraints, speed by unit class, fuel and supply range, and chokepoints.
  Orders are standing: a player who does not log in for three days keeps moving as instructed.
- **Layered fog of war with fuzzy contacts** — detection is not ground truth. A contact carries a
  position with error, a class guess, and a confidence, produced by four channels with different
  ranges, refresh rates and reliability: satellite (periodic revisit, coarse, wide), ground and
  shipborne radar (fixed range, reliable, local), visual/proximity contact, and SIGINT from emissions.
  Submarines running silent are detectable only at short range and by dedicated ASW assets.
- **Sealed orders, self-disclosure and post-hoc audit** — the protocol from *Context §1*: padded
  encrypted envelopes with cleartext signed commitments, self-published observation reports, the
  tick beacon, cross-notarised branch heads, scheduled key release, and `wg audit`, which replays a
  finished (or partly revealed) game and reports any tick where a player's disclosures do not match
  what the rules required of their own revealed orders.
- **Git-transported turns with no merges** — each player owns `player/<nation>`, an append-only JSONL
  journal. Nobody ever merges another player's branch; the referee **fetches all branches and reads
  them as data** into a local materialised view. Conflict resolution therefore does not exist as a
  problem. `main` holds the ruleset, scenario, map artefact and the signed roster of public keys.
- **The referee process** — `wg referee` fetches every branch, verifies signatures and notarisations,
  waits for the tick to be complete (all envelopes present, or the deadline passed), resolves it,
  writes the player's own commit, and pushes. It runs as a one-shot command in cron or as a
  foreground loop; it never blocks the TUI.
- **Asynchronous, offline-first turns** — a tick advances when every player has published or the
  wall-clock deadline expires; absent players fall back to standing orders and their NPC doctrine.
  Nobody has to be online at the same time as anybody else.
- **NPC nations** — countries with no player are driven by a deterministic, fully public doctrine
  engine (defend territory, concentrate against the strongest incursion, honour alliances, keep
  reserves). Because it is deterministic and public, every replica computes the same NPC behaviour
  and there is no hidden-information problem for NPCs.
- **War, alliances and diplomacy** — declaring war, alliance calls with a response window,
  ceasefire and peace, all as ordinary signed orders in the journal, with a public diplomatic log so
  the casus belli of any war can be reconstructed.
- **Combat resolution** — the attacker names which of their formations engage which target, by land,
  sea or air; resolution accounts for domain matchups, readiness, supply, terrain, local
  concentration and surprise, and returns losses, retreats and a battle report. Randomness comes only
  from the beacon-seeded PRNG.
- **TUI with an ASCII map** — `ratatui`: a pannable, zoomable ASCII world map with coastlines from
  the baked artefact, own forces at true position and enemy contacts drawn with their uncertainty,
  plus panes for the order queue, budget, force list, intelligence feed and battle reports. Character
  cell aspect ratio is corrected so the world is not squashed.
- **Baked map artefact** — a build-time pipeline turning Natural Earth into a committed, checksummed
  binary of coastline masks, terrain and passability classes, ports, airbases and country polygons.
  Its hash is pinned in the game repo; two players cannot be playing different worlds.
- **Game bootstrap** — `wg new-game` creates the game repo from `template/`, generates and registers
  each player's keypair, assigns nations, writes the scenario and the signed roster, and creates each
  player's branch. `wg join` sets a player up against an existing game.
- **Reproducible environment, green CI, release and installer** — `flake.nix`; `nix flake check`
  running unit, property, replay and integration suites; CI upstream on push and PR; a `v0.1` release
  carrying static Linux and macOS binaries; `curl -fsSL …/install.sh | sh` verified from a clean
  directory against the published asset; the path-filtered pin check in this repo.
- **Documentation** — README opening with the install one-liner, then a "your first game in ten
  minutes" walkthrough with screenshots; `docs/protocol.md` (envelope, journal, notarisation, key
  release) and `docs/rules.md` (the simulation contract) as the two specifications the tests encode.

## Parallel workflow

The entry asks for this explicitly. The design rule is: **freeze the contracts first, then give each
track a disjoint set of directories and let the schemas be the only coupling.**

### P0 — contracts (serial, blocking, one agent)

Nothing runs in parallel until these land on `main` upstream, because every other track depends on
them. P0 produces no gameplay, and that is fine.

1. Upstream repo, `flake.nix`, workspace layout, CI skeleton, `docs/protocol.md` and `docs/rules.md`
   as stubs with the schemas filled in.
2. **JSON Schemas, versioned**, in `schemas/`: world state, order, journal entry, sealed envelope,
   observation report, roster, scenario, map artefact header.
3. **Crate boundaries and trait signatures**, compiling against stub implementations that return
   `unimplemented!()` — so every track has something that type-checks on day one.
4. **The conformance corpus**: a handful of committed fixture states, order sets and expected state
   hashes. This is the integration seam. A track is integrated when the corpus is still green.
5. H3 resolution, tick length, fixed-point unit conventions and the RNG choice, decided and written
   down.

### Tracks (parallel after P0)

Each track owns its directories exclusively. No agent edits another track's files; cross-track needs
go through a schema change, which is a P0-style serial change proposed as a PR and reviewed.

| Track | Owns | Depends on | Deliverable |
|---|---|---|---|
| **A — engine** | `crates/wg-core/` | P0 | Deterministic resolution: economy, movement, detection, combat |
| **B — protocol** | `crates/wg-proto/`, `crates/wg-git/` | P0 | Envelopes, signatures, commitments, beacon, notarisation, key release, `wg audit` |
| **C — geo** | `crates/wg-map/`, `tools/bake-map/` | P0 | Natural Earth pipeline, map artefact, pathfinding graph, projection for ASCII |
| **D — TUI** | `crates/wg-tui/` | P0, C's artefact format | Map view, order entry, reports — driven off fixture states, not a live game |
| **E — NPC doctrine** | `crates/wg-npc/` | P0, A's traits | Deterministic AI for unowned nations |
| **F — data** | `data/`, `template/` | P0 | Curated country dataset with provenance, starting scenario, game template |
| **G — ship** | `.github/`, `install.sh`, `README.md`, `docs/` | P0 | CI, release workflow, installer, docs, screenshots |

Tracks D, F and G can start the moment P0 lands and never block on A. A and B are the long poles and
should get the strongest agents. E is written against A's traits and can be stubbed until A is real.

### Integration protocol

- One branch per track (`track/a-engine`), rebased on `main`, small commits, merged as soon as the
  conformance corpus is green — daily, not at the end.
- **The corpus is the contract.** A track that needs to change an expected state hash must say why in
  the commit message; a silent hash change is a divergence bug.
- **Schema changes are serial.** Bump the schema version, update `schemas/` and the corpus in one
  commit, announce it in `STATUS.md`. Never change a schema on a track branch.
- `STATUS.md` here lists units per track, so "3 of 7 units in A, 5 of 6 in C" is readable at a glance.

### Milestones

- **M1 (after P0)** — one nation, one unit, one tick, resolved and committed to a branch, with a
  state hash two machines agree on. Proves the whole vertical slice.
- **M2** — movement and the ASCII map, two players, no combat, no secrecy. Playable and boring.
- **M3** — sealed envelopes, self-disclosure, contacts, `wg audit`. The hard part.
- **M4** — economy, procurement, combat, NPC doctrine.
- **M5** — bootstrap, installer, release, docs, screenshots, a real three-player game played end to
  end across three checkouts.

## Testing

- **Unit** — economy arithmetic, envelope round-trips, signature and notarisation verification,
  detection ranges, combat resolution tables, projection maths.
- **Property-based** — replay determinism (same inputs → same state hash, across thread counts and
  iteration orders), no order can raise a nation's budget above its income, no unit exceeds its
  fuel range, revealed keys always reproduce their commitment, a hidden unit inside a published
  sensor footprint always produces a disclosure.
- **Replay/golden** — the conformance corpus: fixture game, N ticks, committed expected state hashes.
  The single most valuable test in the project.
- **Multi-checkout integration** — a test harness that creates a bare repo and three working
  checkouts in a temp directory, runs three referees, plays scripted ticks, and asserts all three
  agree on the state hash and that each player's view contains exactly the contacts it is entitled to
  and none of the ones it is not.
- **Adversarial** — a cheating harness: a player who force-pushes, who submits orders after seeing
  the beacon, who fails to disclose a detected unit, who signs with the wrong key. `wg audit` must
  catch each one, and there is a test per attack.
- **TUI** — snapshot tests of rendered frames at fixed terminal sizes over fixture states.

## Risks / things to verify early

- **Determinism across platforms** is the risk that invalidates the architecture if it fails. Verify
  in M1, on Linux and macOS, before anything is built on top. Fallback: authority mode becomes
  mandatory and replicas only verify.
- **The disclosure model has a hole where sensors are themselves secret** — B cannot know it was heard
  by A's silent submarine. The mitigation is that each nation publishes a **coarse sensor footprint**
  (satellites have public orbits in reality too; fixed radar is public), and that purely covert
  passive detection yields intelligence only at key-release time. Settle this in M3 and write it into
  `docs/rules.md`; it is a rules decision, not a bug.
- **Scope.** A global military simulation can absorb unlimited effort. v0.1 is *playable*, not
  *realistic*: a small curated set of nations, a handful of unit classes, one scenario. Depth is a
  later entry.
- **Real-world data licensing and provenance.** SIPRI and IISS terms constrain redistribution. Ship
  what is genuinely redistributable, cite every field, and use plausible generic profiles elsewhere.
- **The template repo needs push access for every player**, which means every player needs write
  permission on a shared GitHub repo and a working SSH key. That onboarding is a real usability
  cliff; `wg new-game`/`wg join` must do it or the game never gets played once.
- **Immutable history means a released key reveals its envelope forever.** Per-tick keys, released
  selectively, so revealing tick 40 does not reveal tick 12.
- **GitHub as an unwitting dependency.** Fetching every branch every tick, from every player, is
  polling. Keep the cadence sane (minutes, not seconds) and make the referee's default a one-shot.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] Which trust model is the default: **audit** (fully replicated referees, secrecy enforced only
      by encryption to the owner, cheating provable after the fact by anyone) or **authority** (one
      designated instance holds the master key and publishes canonical contact reports, so cheating
      is prevented but one player's machine is the arbiter)? Both use the same engine and differ only
      in key distribution, so this decides the default and which one v0.1 tests end-to-end.
- [ ] Real countries with real 2026 armed forces, budgets and alliances, or a fictional world with
      invented nations? Real data means curating non-redistributable order-of-battle figures and
      simulating actual wars between actual states; fictional means no licensing problem and no
      political weight, at the cost of the recognition that makes the idea appealing.
- [ ] If real: how many nations get curated data for v0.1 — a curated set (say 20–30 with real
      figures, everyone else on a generic profile derived from population and GDP) or all ~195?
- [ ] What is the tick length in game time, and how does it map to real time? E.g. one tick = 6
      game-hours resolved once per real day, versus one tick = 1 game-hour resolved hourly. This sets
      the pace of the whole game and the granularity of every movement rule.
- [ ] Are nuclear weapons in scope? They dominate any realistic model of war between the countries
      this idea describes, and leaving them out is as much a design decision as putting them in.
- [ ] How does a game end and who wins — explicit victory conditions (territory, capitals,
      surrender), a fixed number of ticks with a score, or open-ended sandbox with no win state?
- [ ] Should the game template be a **separate GitHub template repository** (cleaner for players:
      "Use this template" in the GitHub UI, engine updates independent of game state) or a
      `template/` directory inside the engine repo materialised by `wg new-game` (one repo, matching
      this workshop's one-repo-per-idea rule, which is what the plan currently assumes)?
