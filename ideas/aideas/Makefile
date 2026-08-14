# aideas build/install/test targets. Everything here is expected to run inside `nix develop`,
# except test-contract, which deliberately needs nothing but a stock python3.

UUID    := aideas-shell@patxi.gortazar
BUILD   := build
BUNDLE  := $(BUILD)/$(UUID)
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
REPO    := ../..

GJS ?= gjs

.PHONY: help check lint test test-unit test-http test-contract build check-bundle pack install \
        uninstall enable disable prefs logs smoke clean

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
	@echo "  make pack           build + gnome-extensions pack -> the release artefact"
	@echo "  make install        install and enable it in this session"
	@echo "  make smoke          end-to-end test in a nested headless Shell"

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

pack: build
	cd $(BUILD) && gnome-extensions pack --force \
	    $(if $(wildcard src/extension/schemas),--schema=$(UUID)/schemas/*.gschema.xml,) \
	    --extra-source=lib \
	    $(UUID)
	@echo "packed: $(BUILD)/$(UUID).shell-extension.zip"

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

clean:
	rm -rf $(BUILD)
