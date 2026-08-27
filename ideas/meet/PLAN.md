# Plan: meet — one click from the top bar into an OpenVidu Meet room

Difficulty estimate: easy — the extension is a panel button, two menu items and one URI launch; nearly all
the work is the scaffolding every idea here needs (upstream repo, flake, headless tests, Sonar, release,
installer), not the behaviour.

## Context

The whole feature fits in a paragraph: a button in the top bar carrying the OpenVidu Meet logo, whose menu
has **Meet next** and **Meet**, each opening the corresponding site in the default browser. There is no
state to keep, no polling, no subprocess and no data to parse. That makes the interesting decisions the
small ones, and they are worth settling before any code:

1. **The logo is a remote PNG.** The idea names it by URL
   (`https://openvidu.io/assets/images/logos/logo.png`). An extension must not fetch it at runtime — that
   is a network request from inside the compositor for a decoration, it fails offline, and the EGO review
   guidelines would rightly object. So the asset is **vendored into the repository once** and loaded from
   the extension directory. See the open questions on licensing and on whether the panel wants a colour
   logo at all.
2. **"Opens a new browser window" is not something the launching side controls.** The correct API is
   `Gio.AppInfo.launch_default_for_uri_async`, which hands the URI to the user's default handler; a browser
   that is already running will usually open a *tab*, not a window. Forcing a window means knowing the
   browser and passing `--new-window`, which is browser-specific and brittle. The plan launches the default
   handler and treats "a new tab in the default browser" as satisfying the intent; see the first open
   question.
3. **`meet.openvidu.io` is written without a scheme.** Assumed `https://meet.openvidu.io/`, matching the
   fully written `https://meet-next.openvidu.io/`. Both URLs are constants in one module, never built by
   string concatenation at call time.
4. **Nothing here needs a subprocess.** `pwgen` already established why: spawning is a review risk and a
   main-loop risk. No `xdg-open`, no `GLib.spawn*`, no `Gio.Subprocess` anywhere in this extension.

Assumptions stated rather than asked:

- **Menu order follows the idea text** — *Meet next* first, then *Meet*.
- **v0.1 has no preferences window.** Two fixed destinations, no settings schema, no `prefs.js`. Making
  the URLs configurable is proposed as an open question rather than built.
- **Activating an item closes the menu**, which is the standard `PopupMenuItem` behaviour and what a user
  expects from a launcher.

## Features

- **A panel button carrying the OpenVidu Meet logo** — an `St.Icon` built from a `Gio.FileIcon` over the
  bundled asset, sized to the panel's icon size and following the scale factor, so it is sharp on HiDPI and
  the same visual weight as its neighbours. It has an accessible name and a tooltip-equivalent label, and it
  is keyboard reachable like any other panel indicator.
- **A menu with exactly two items** — **Meet next** → `https://meet-next.openvidu.io/`, **Meet** →
  `https://meet.openvidu.io/`. The label→URL mapping lives in one Shell-free module so it can be asserted in
  a headless test rather than only by eye.
- **Opening through the desktop's own default handler** — `Gio.AppInfo.launch_default_for_uri_async` with a
  launch context from `Shell.Global.create_app_launch_context` (so the browser gets the right timestamp and
  workspace, and does not get flagged as demanding attention). Asynchronous, never blocking the compositor.
- **A failure that is visible and harmless** — no default browser, or a handler that refuses, produces one
  `Main.notifyError`-style message naming what could not be opened, and no exception escaping into the
  Shell. A machine with no browser must not break the panel.
- **The logo ships with the extension** — vendored PNG (plus the `@2x` variant if one is published),
  recorded in the repository with its source URL and the date fetched, and a `scripts/refresh-logo.sh` that
  re-downloads it so updating the asset is a deliberate, reviewable commit rather than a runtime download.
- **Review-rules compliance** — ESM imports and the modern `Extension` base class; every widget, signal
  handler and menu item created in `enable()` destroyed in `disable()`, leaving nothing on the main loop; no
  `eval`, no remote code, no bundled binaries; `metadata.json` correct (uuid, `shell-version`, url, licence)
  and validated by a test.
- **Headless test suite under plain `gjs`** — the destinations module (labels, URLs, order, that every URL
  is `https:` and absolute), the launcher with an injected `AppInfo` seam (success, refusal, no handler —
  each asserted to leave the extension usable), `metadata.json` shape, and a hygiene test that greps the
  Shell-free modules for `St`/`Clutter`/`Shell` imports and the whole tree for `spawn`, `Soup` and any
  `http://` literal.
- **The icon is tested as an image, not as a path** — a test loads the bundled asset through GdkPixbuf and
  asserts it decodes, has non-zero dimensions and is not blank. A file that is present but unloadable makes
  GNOME silently fall back to a generic icon, which is exactly the bug that would otherwise ship unnoticed.
- **A smoke test in a real, nested GNOME Shell** — `ci/smoke-test.sh` on the `recap-gs` model (throwaway
  `HOME`, headless, never touching the live session): the extension loads, a panel button appears with the
  logo actually rasterised rather than a fallback, the menu opens with two items, activating one calls the
  URI handler (a stub `.desktop` file registered as the default handler for `https`, which records what it
  was asked to open), and five enable/disable rounds leave no widget and no signal behind.
- **Reproducible environment and green CI** — `flake.nix` providing `gjs`, `glib`, ESLint and
  `gnome-extensions`; `nix flake check` runs lint, the headless suite and `gnome-extensions pack`; upstream
  CI runs it on push and pull request, plus `gortazar/aideas/.github/workflows/sonar.yml@v1` for the gate.
- **Installable without compiling** — `install.sh` fetching the packed `.zip` from the latest release and
  installing it into `~/.local/share/gnome-shell/extensions`, verified from a clean directory before the
  entry is called done; `README.md` opens with that one command, then screenshots of the button and the open
  menu taken from the smoke-test run.
- **The wrapper here stays coherent** — `upstream` submodule with its pointer committed,
  `scripts/check-pin.sh` on the `pwgen`/`recap-gs` model, `STATUS.md` refreshed at every unit, and
  `.github/workflows/ci-meet.yml` adjusted to check the wrapper and the pin (it currently runs
  `nix flake check` in `ideas/meet`, which has no flake).

## Approach

Units, each one commit, tests first:

1. **U1 — the upstream repository and an empty-but-green pipeline.** `gh repo create gortazar/meet
   --public`, submodule at `ideas/meet/upstream`, `flake.nix`, ESLint, the test runner wired into
   `nix flake check`, `SONAR_TOKEN`, the Sonar project and CI. Green on a draft pull request *before* any
   behaviour lands, so a red result later means the code, not the scaffolding.
2. **U2 — destinations.** `src/lib/destinations.js`: the two entries, their order, their URLs, and a test
   that pins all three plus the `https:`-only rule.
3. **U3 — the launcher.** `src/lib/launcher.js` with the `AppInfo` seam; tests for launched, refused and
   no-handler, each asserting the error path is a message and not a throw.
4. **U4 — the vendored logo**, `scripts/refresh-logo.sh`, provenance note, and the GdkPixbuf decode test.
5. **U5 — the panel button and menu.** `extension.js` wiring U2–U4 together, with complete `disable()`
   teardown. This is where the feature becomes visible.
6. **U6 — the real shell.** `ci/smoke-test.sh` with the stub `https` handler, the icon-rasterised check, the
   five enable/disable rounds, and the screenshots.
7. **U7 — installer and README**, then verify the installer from a clean directory.
8. **U8 — the wrapper and the release.** `check-pin.sh`, `ci-meet.yml` fixed, `STATUS.md` at `version: 0.1`,
   pull request ready and auto-merged, `v0.1` tagged upstream by the repository's own release workflow,
   published asset installed and run.

## Risks / things to verify early

- **The logo may not be usable as a panel icon at panel size.** A wordmark that reads at 200px can be an
  illegible smear at 16px, and a logo designed for a light page can vanish on a dark top bar. Look at it in
  the nested shell in U4/U5, in both light and dark, before building anything on top of it. If it does not
  work, the remedy is a cropped or monochrome variant — see the third open question.
- **The asset must survive being vendored.** Fetch it once, commit it, and never let the extension reach the
  network. Check the file actually decodes as a PNG at the size we expect rather than trusting the URL.
- **A default browser is not guaranteed** in a nested shell, in CI, or on a bare machine. The stub handler
  makes the test deterministic; the no-handler path is a real user state and gets its own test.
- **`launch_default_for_uri` behaviour differs between Flatpak'd and native browsers** — under a portal the
  call may be brokered and return before anything opens. Verify on a real session that both destinations
  actually open, and record the browser used in `STATUS.md`; a launcher that was never launched is a guess.
- **Sonar on a repository this small.** New-code coverage percentages swing wildly when there are a few
  hundred lines in total, and the untestable part (`extension.js`, which needs a compositor) is a large
  fraction of them. If the gate fails on coverage of Shell-only code, that is the catalogued class in
  `ideas/quality-gate/baseline.md` — a narrow exclusion in `sonar-project.properties` with a row in
  `exclusions.md`, not a re-labelled issue.
- **`ci-meet.yml` is red as it stands.** It runs `nix flake check` in `ideas/meet`, where there is no flake;
  fix it in U1 rather than discovering it at the end.

## Open Questions
<!-- Append new questions here as "- [ ] question text". Never edit or remove old ones —
     when answered, change "- [ ]" to "- [x]" and add the answer inline. The orchestrator
     treats any remaining "- [ ]" line as blocking. -->
- [ ] **Is "a new browser window" satisfied by whatever the default browser does?** The supported API hands
      the URI to the default handler, and a running browser normally opens a tab. Guaranteeing a *window*
      means detecting the browser and passing its own flag (`--new-window`), which is browser-specific,
      breaks under Flatpak, and needs a spawn we would otherwise not have. Ticking this line as-is accepts
      the default handler's behaviour; the alternative is a best-effort `--new-window` path for a short list
      of known browsers with the plain launch as fallback.
- [ ] **May the OpenVidu logo be vendored into a public repository and published on extensions.gnome.org?**
      It is a third-party trademark and the plan bundles it, which is redistribution. Ticking this line
      as-is says yes — the extension is an OpenVidu-adjacent tool and the mark is used to identify it. If
      that is not settled, the fallback is a generic video-call symbolic icon with the logo shipped only for
      local installs.
- [ ] **Colour logo in the top bar, or a monochrome/symbolic variant?** The idea says "the OpenVidu Meet
      logo", so the plan bundles the PNG as-is. GNOME's own convention is symbolic panel icons that follow
      the theme's foreground colour, which is what makes a top bar look consistent in light and dark.
      Ticking this line as-is keeps the colour logo; the alternative is a symbolic derivative in the panel
      with the colour logo used in the menu header.
- [ ] **Should the two URLs be configurable?** v0.1 hard-codes them, per the idea text. A preferences page
      with editable endpoints would let someone point the button at their own OpenVidu deployment, but
      `AGENTS.md` forbids inventing features, so it is asked rather than built. Ticking this line as-is
      keeps them hard-coded.
