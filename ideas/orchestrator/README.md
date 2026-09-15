# orchestrator

Install it without cloning this repository:

```sh
curl -fsSL https://github.com/gortazar/aideas/releases/latest/download/orchestrator-1.6.tar.gz | tar xz
./orchestrator/install.sh
```

`install.sh` clones the ideas repository into `~/aideas` when `--repo` is absent, installs the
user systemd units and starts the heartbeat receiver. Pass `--repo PATH` to point it at a clone
you already have — the orchestrator commits and pushes to it every cycle, so it does need one.
`./orchestrator/install.sh --help` lists the rest.

The code itself lives in this repository's `orchestrator/`, not in a submodule under this
folder, and deliberately: the orchestrator is what runs the cycles, so a submodule of itself
would be a clone that a cycle checks out and replaces underneath the process reading it. Its
release is a `orchestrator-v<version>` tag on this repository, published by
`.github/workflows/release-orchestrator.yml`.

## Development

Stdlib only, on a stock `python3` — the systemd unit hardcodes `/usr/bin/python3`, so a suite
needing anything else would be testing a different program. From the repository root:

```sh
python3 -m unittest discover -s orchestrator/tests -t orchestrator
python3 orchestrator/orchestrator.py status
```

No network, no nix, no pytest. The tests build real repositories in a temporary directory with
`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM` forced into it, so the machine's own git
configuration cannot change a result.

| script | what it asserts |
| --- | --- |
| `scripts/check-version.sh` | `version:` in `STATUS.md` and `ORCHESTRATOR_VERSION` agree |
| `scripts/check-release.sh` | the release exists, its checksum matches the bytes served, and the packed `orchestrator.py` declares that same version |

`check-release.sh` needs no token and no clone. It is the only way anyone learns whether a
release worked, because it is published on a push that no agent watches.
