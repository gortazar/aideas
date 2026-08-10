# recap — what were my agents doing?

You left several coding agents running across several repos, closed the laptop, and came
back. [`recap`](https://github.com/gortazar/recap) is the one command that answers "what
were they doing, and is anything still going?" — a few lines of output, no interaction, no
daemon, and (unless you ask for `--smart`) no network.

It reads what Claude Code and opencode already write to disk and prints one line per
project. It never writes to an agent's state directories and never spawns an agent, so it
cannot disturb a session in progress.

![recap output](upstream/screenshots/recap.svg)

## Where the code is

In its own repository, [`gortazar/recap`](https://github.com/gortazar/recap), checked out
here as the `upstream/` submodule. That is where the Go module path already pointed
(`github.com/gortazar/recap`), and it is what lets the release workflow tag, release and
upload with nothing but its own `GITHUB_TOKEN`.

This folder holds the idea's `PLAN.md` and `STATUS.md`, a flake that builds and tests the
pinned commit, and nothing else. Read
[`upstream/README.md`](https://github.com/gortazar/recap#readme) for how to install and use
recap.

```sh
git submodule update --init ideas/recap/upstream
```

## Working on it

```sh
cd ideas/recap
nix develop            # go, gopls, sqlite, jq, python3, shellcheck, charm-freeze
cd upstream && go test ./...
```

Changes are committed and pushed in `upstream/`, then the pin is moved here:

```sh
git -C upstream push
nix flake lock --update-input recap-src   # or --override-input for an exact rev
git add upstream flake.lock
./scripts/check-pin.sh                    # both pins at the same commit
```

`scripts/check-pin.sh` is what stops the two pins drifting: the submodule gitlink is what a
clone checks out, the `recap-src` flake input is what `nix flake check` actually builds, and
CI would otherwise happily test a commit nobody is working on.

## CI

`.github/workflows/ci-recap.yml` checks out the submodule, runs `scripts/check-pin.sh` and
then `nix flake check`, which builds recap and runs its Go test suite against the pinned
commit. recap's own repository runs the same suite on every push there.
