# meet — one click from the top bar into an OpenVidu Meet room

A GNOME Shell panel button whose menu lists your meeting rooms. Click one and it opens in
your default browser. **Meet next** and **Meet** are there from the first launch, and you
can rename them, point them at your own OpenVidu deployment, reorder them or remove them.

```sh
curl -fsSL https://raw.githubusercontent.com/gortazar/meet/main/install.sh | sh
```

![the button in the top bar](upstream/screenshots/panel.png)
![the menu](upstream/screenshots/menu.png)

## Where the code is

In its own repository, [`gortazar/meet`](https://github.com/gortazar/meet), checked out here
as the `upstream/` submodule. That is where the source, the tests, CI and the releases live,
and it is what lets the release workflow tag, release and upload with nothing but its own
`GITHUB_TOKEN`.

This folder holds the idea's `PLAN.md` and `STATUS.md`, a flake that runs upstream's checks
against the pinned commit, and the scripts that keep the wrapper honest. Read
[`upstream/README.md`](https://github.com/gortazar/meet#readme) for how to install, use and
develop the extension.

## Working on it here

```sh
git submodule update --init          # populate upstream/
nix develop                          # upstream's dev shell, plus jq, git and curl
./scripts/check-pin.sh               # the submodule and the flake input name one commit
./scripts/check-release.sh           # the release exists, and its zip has what it needs
nix flake check                      # upstream's checks, at that commit
cd upstream && gjs -m tests/run.js   # the headless suite while editing
```

The extension is pinned twice — as the `upstream/` gitlink and as the `meet-src` flake input
— so `nix flake check` here tests exactly the commit this idea points at.
`scripts/check-pin.sh` fails if the two ever drift, which is the one mistake this wrapper
exists to catch.
