# recap.gs — agent statuses in the GNOME Shell top bar

A panel indicator that shows what your coding agents are doing: how many are running, and
whether any has stopped to ask you something. Click a row and that session resumes, in a
terminal, in the directory it was running in.

It reads its report from [`recap`](https://github.com/gortazar/recap) — the sibling idea —
and decides nothing about a session's state for itself.

```sh
curl -fsSL https://raw.githubusercontent.com/gortazar/recap-gs/main/install.sh | sh
```

![the panel indicator](upstream/screenshots/panel.png)
![the menu](upstream/screenshots/menu.png)

## Where the code is

In its own repository, [`gortazar/recap-gs`](https://github.com/gortazar/recap-gs), checked
out here as the `upstream/` submodule. That is where the source, the tests, CI and the
releases live, and it is what lets the release workflow tag, release and upload with nothing
but its own `GITHUB_TOKEN`.

This folder holds the idea's `PLAN.md` and `STATUS.md`, a flake that runs upstream's checks
against the pinned commit, and the script that keeps the two pins in step. Read
[`upstream/README.md`](https://github.com/gortazar/recap-gs#readme) for how to install, use
and develop the extension.

## Working on it here

```sh
git submodule update --init          # populate upstream/
nix develop                          # upstream's dev shell, plus jq and git
./scripts/check-pin.sh               # the submodule and the flake input name one commit
nix flake check                      # upstream's four checks, at that commit
cd upstream && gjs -m tests/run.js   # the headless suite while editing
```

The extension is pinned twice — as the `upstream/` gitlink and as the `recap-gs-src` flake
input — so `nix flake check` here tests exactly the commit this idea points at.
`scripts/check-pin.sh` fails if the two ever drift, which is the one mistake this wrapper
exists to catch.
