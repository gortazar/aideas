# recap — what were my agents doing?

You left several coding agents running across several repos, closed the laptop, and came
back. `recap` is the one command that answers "what were they doing, and is anything still
going?" — a few lines of output, no interaction, no network, no daemon.

recap is a *reader*: it parses what the agents already write to disk (Claude Code's JSONL
transcripts and opencode's SQLite store) and never writes to their state directories.

## Status

Early. See [STATUS.md](STATUS.md) for what is committed and passing today, and
[docs/session-formats.md](docs/session-formats.md) for the on-disk formats recap reads.

## Development

Everything is pinned by the flake:

```sh
nix develop           # dev shell with go, gopls, sqlite, jq
go test ./...         # the test suite
go build ./cmd/recap  # the binary
```

CI (`.github/workflows/ci-recap.yml`) runs `nix flake check`, which builds the binary, runs
`go test ./...` and enforces `gofmt`. To reproduce CI exactly:

```sh
nix flake check --print-build-logs
```

Note that a flake only sees git-tracked files: `git add` new files before running it.

## Install

```sh
nix build            # ./result/bin/recap
nix run . -- --help
```

## Language

Go, standard library only so far. It gives a single dependency-free binary with a
sub-100 ms start, which the sub-300 ms target needs, and it is straightforward for the
planned `recap-gs` GNOME Shell extension to shell out to for `--json`.
