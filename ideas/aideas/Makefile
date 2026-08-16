# aideas build/install/test targets. Everything here is expected to run inside `nix develop`,
# except test-contract, which deliberately needs nothing but a stock python3.

UUID    := aideas-shell@patxi.gortazar
BUILD   := build
BUNDLE  := $(BUILD)/$(UUID)
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
REPO    := ../..

GJS ?= gjs

# 1980-01-01 00:00:00 UTC — the earliest a zip can record, and exactly what nixpkgs' stdenv
# exports, so `make pack` here and `nix build` in the sandbox produce the same bytes.
SOURCE_DATE_EPOCH ?= 315532800

.PHONY: help check lint test test-unit test-http test-contract build check-bundle pack install \
        uninstall enable disable prefs logs smoke test-install test-pack test-release \
        check-release clean

help:
	@echo "aideas — the orchestrator's state in the GNOME top bar"
	@echo "  make check          lint + tests + bundle check (what CI runs)"
	@echo "  make lint           eslint over src/, tests/, ci/"
	@echo "  make test           every test: unit, http and the /state contract"
	@echo "  make test-unit      the pure logic (no compositor, no display, no network)"
	@echo "  make test-http      the real libsoup transport against a stub server on loopback"
	@echo "  make test-contract  the /state contract, against fixture repositories"
	@echo "  make build          assemble $(BUNDLE)"
	@echo "  make check-bundle   validate the assembled bundle (metadata + imports)"
	@echo "  make pack           build + zip -> the release artefact"
	@echo "  make install        install and enable it in this session"
	@echo "  make smoke          end-to-end test in a nested headless Shell"
	@echo "  make test-install   run install.sh for real, from a clean directory"
	@echo "  make test-pack      the artefact is a function of the source alone"
	@echo "  make test-release   the release decision, over fixture releases lists"
	@echo "  make check-release  ask GitHub whether the published release is really there"

check: lint test check-bundle

lint:
	eslint .

test: test-unit test-http test-contract

test-unit:
	$(GJS) -m tests/run.js tests/unit

test-http:
	$(GJS) -m tests/run.js tests/http

# Drives orchestrator.queue_rows() and heartbeat_server.orchestrator_state() over fixture
# repositories. Not a flake check: the flake's root is this folder, and this test imports the
# orchestrator from two directories up, which a flake cannot see. CI runs it as its own step.
test-contract:
	cd $(REPO) && python3 -m unittest discover -s ideas/aideas/tests -v

# --- build ---------------------------------------------------------------------------------

build:
	rm -rf $(BUNDLE)
	mkdir -p $(BUNDLE)
	cp -r src/extension/. $(BUNDLE)/
	# The Shell-free modules are shared with the tests and the preferences window. An
	# extension may only import from inside its own directory, so they are copied in.
	mkdir -p $(BUNDLE)/lib
	cp src/lib/*.js $(BUNDLE)/lib/
	if [ -d $(BUNDLE)/schemas ]; then \
	    glib-compile-schemas --strict $(BUNDLE)/schemas; \
	fi

# What CI validates instead of `gnome-extensions pack`, which would pull the whole
# gnome-shell closure into the sandbox.
check-bundle: build
	$(GJS) -m tools/check-bundle.js $(BUNDLE)

# The release artefact. A .shell-extension.zip is just a zip whose root holds metadata.json,
# which is exactly what `make build` has already assembled and `check-bundle` has validated —
# so this zips that, rather than asking `gnome-extensions pack` to assemble it a second time
# from a different set of rules. It also keeps the whole gnome-shell closure out of the release
# workflow, which only needs zip and glib-compile-schemas.
#
# Reproducible, deliberately: the same source must give the same bytes, on this laptop and on a
# runner. Three things would otherwise vary — the mtimes `cp` stamps on every copied file, the
# readdir order `zip -r` walks in, and the uid/gid and extended timestamps zip stores by
# default. The release workflow decides whether to publish by comparing this artefact against
# the published one, so without this every run would look like a change and publish a
# byte-different copy of an identical extension forever.
pack: build check-bundle
	rm -f $(BUILD)/$(UUID).shell-extension.zip
	# Modes as well as times: zip records the unix mode bits, so a developer's umask of 002
	# and a build sandbox's 022 produce different archives from identical files.
	find $(BUNDLE) -type f -exec chmod 644 {} +
	find $(BUNDLE) -type d -exec chmod 755 {} +
	find $(BUNDLE) -exec touch -h -d @$(SOURCE_DATE_EPOCH) {} +
	# TZ=UTC because a zip entry's timestamp is stored as *local* time with no zone: the same
	# epoch packs as 00:00 in the sandbox and 01:00 on a CET laptop without this.
	cd $(BUNDLE) && find . -type f -printf '%P\n' | LC_ALL=C sort | \
	    TZ=UTC zip -qX -D -@ ../$(UUID).shell-extension.zip
	@echo "packed: $(BUILD)/$(UUID).shell-extension.zip"
	@sha256sum $(BUILD)/$(UUID).shell-extension.zip

# --- install -------------------------------------------------------------------------------

install: build
	rm -rf $(EXT_DIR)
	mkdir -p $(dir $(EXT_DIR))
	cp -r $(BUNDLE) $(EXT_DIR)
	@echo "installed to $(EXT_DIR) — log out and back in on Wayland, then: make enable"

uninstall: disable
	rm -rf $(EXT_DIR)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

logs:
	journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i --line-buffered aideas

smoke:
	./ci/smoke-test.sh

# Runs the installer against the packed artefact, over HTTP and through a stubbed releases API.
# Isolated: its own XDG dirs and its own session bus, so neither the real extensions directory
# nor the real dconf database is touched.
test-install:
	./ci/install-test.sh

test-pack:
	./ci/pack-test.sh

test-release:
	./ci/release-test.sh

# Run this *after* a merge reaches main: it is what says whether the release actually
# published, which no test in this repo can know beforehand.
check-release:
	./tools/check-release.sh

clean:
	rm -rf $(BUILD)
