# gnome-tasks build/install targets. Everything here is expected to run inside `nix develop`.

UUID        := gnome-tasks@patxi.gortazar
BUILD       := build
BUNDLE      := $(BUILD)/$(UUID)
EXT_DIR     := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
LIB_DIR     := $(HOME)/.local/lib/gnome-tasks
BIN_DIR     := $(HOME)/.local/bin
DBUS_DIR    := $(HOME)/.local/share/dbus-1/services
SYSTEMD_DIR := $(HOME)/.config/systemd/user

GJS ?= gjs

.PHONY: help lint test test-unit test-dbus build check-bundle pack install install-extension \
        install-daemon install-browser-host uninstall enable disable restart-daemon logs clean \
        check smoke

help:
	@echo "gnome-tasks"
	@echo "  make lint             eslint over src/, tests/, tools/"
	@echo "  make test             unit tests + D-Bus integration tests"
	@echo "  make test-unit        Shell-free unit tests (plain gjs)"
	@echo "  make test-dbus        daemon D-Bus surface, on a private bus"
	@echo "  make build            assemble $(BUNDLE)"
	@echo "  make check-bundle     validate the assembled bundle (metadata + imports)"
	@echo "  make pack             build + gnome-extensions pack -> $(BUILD)/$(UUID).shell-extension.zip"
	@echo "  make install          install the extension and the daemon into ~/.local"
	@echo "  make install-browser-host  native-messaging host for Firefox and Chrome (see browser/)"
	@echo "  make enable/disable   toggle the extension"
	@echo "  make restart-daemon   restart the user daemon and follow its log"
	@echo "  make logs             follow the Shell and daemon logs"
	@echo "  make check            lint + test (what CI runs)"
	@echo "  make smoke            end-to-end test in a nested headless Shell (needs a display-less GNOME)"

check: lint test check-bundle

lint:
	eslint .

test: test-unit test-dbus

test-unit:
	$(GJS) -m tests/run.js tests/unit

test-dbus: build
	dbus-run-session -- $(GJS) -m tests/run.js tests/dbus

# --- build ---------------------------------------------------------------------------------

build:
	rm -rf $(BUNDLE)
	mkdir -p $(BUNDLE)
	cp -r src/extension/. $(BUNDLE)/
	# The Shell-free modules are shared with the daemon; an extension can only import from
	# inside its own directory, so they are copied in rather than referenced.
	mkdir -p $(BUNDLE)/lib $(BUNDLE)/prefs
	cp src/lib/*.js $(BUNDLE)/lib/
	mkdir -p $(BUNDLE)/lib/adapters
	cp src/lib/adapters/*.js $(BUNDLE)/lib/adapters/
	# The preferences window lives outside src/extension so it can be built by a plain gjs
	# script for testing; it still has to ship inside the bundle.
	cp src/prefs/*.js $(BUNDLE)/prefs/
	if [ -d src/extension/schemas ]; then \
	    glib-compile-schemas --strict $(BUNDLE)/schemas; \
	fi

# What CI validates instead of `gnome-extensions pack`, which needs the whole gnome-shell closure.
check-bundle: build
	$(GJS) -m tools/check-bundle.js $(BUNDLE)

pack: build
	cd $(BUILD) && gnome-extensions pack --force \
	    $(if $(wildcard src/extension/schemas),--schema=$(UUID)/schemas/*.gschema.xml,) \
	    --extra-source=lib \
	    $(UUID)
	@echo "packed: $(BUILD)/$(UUID).shell-extension.zip"

# The only test that exercises the extension, the daemon, Mutter and a real application together.
# Not part of `make check`: it needs a working GNOME installation and takes a couple of minutes.
SMOKE_STATE ?= /tmp/gnome-tasks-smoke

smoke: build
	tools/nested-shell.sh stop --state $(SMOKE_STATE) >/dev/null 2>&1 || true
	tools/nested-shell.sh start --extension $(BUNDLE) --extension tools/probe \
	    --state $(SMOKE_STATE)
	set -a; . $(SMOKE_STATE)/env; set +a; \
	    GNOME_TASKS_DATA_DIR=$(SMOKE_STATE)/tasks $(GJS) -m src/daemon/main.js \
	        >$(SMOKE_STATE)/daemon.log 2>&1 & \
	    sleep 4; \
	    python3 tools/smoke-nested.py; \
	    status=$$?; \
	    tools/nested-shell.sh stop --state $(SMOKE_STATE); \
	    exit $$status

# --- install -------------------------------------------------------------------------------

install: install-extension install-daemon
	@echo
	@echo "Installed. Log out and back in (Wayland cannot reload the Shell in place),"
	@echo "then: gnome-extensions enable $(UUID)"

install-extension: build
	rm -rf $(EXT_DIR)
	mkdir -p $(dir $(EXT_DIR))
	cp -r $(BUNDLE) $(EXT_DIR)

install-daemon:
	mkdir -p $(LIB_DIR) $(BIN_DIR) $(DBUS_DIR) $(SYSTEMD_DIR)
	rm -rf $(LIB_DIR)/daemon $(LIB_DIR)/lib
	cp -r src/daemon $(LIB_DIR)/daemon
	cp -r src/lib $(LIB_DIR)/lib
	sed -e 's|@LIB_DIR@|$(LIB_DIR)|g' -e 's|@GJS@|$(shell command -v gjs)|g' \
	    data/gnome-tasks-daemon.in > $(BIN_DIR)/gnome-tasks-daemon
	chmod +x $(BIN_DIR)/gnome-tasks-daemon
	sed -e 's|@BIN_DIR@|$(BIN_DIR)|g' \
	    data/org.gnome.Tasks.service.in > $(DBUS_DIR)/org.gnome.Tasks.service
	sed -e 's|@BIN_DIR@|$(BIN_DIR)|g' \
	    data/gnome-tasks-daemon.service.in > $(SYSTEMD_DIR)/gnome-tasks-daemon.service
	systemctl --user daemon-reload

# Tier-2 browser support: the host bridges a WebExtension's stdio to org.gnome.Tasks. Both browsers
# look for their manifests in their own directory, hence two copies of it.
FIREFOX_HOSTS_DIR := $(HOME)/.mozilla/native-messaging-hosts
CHROME_HOSTS_DIR  := $(HOME)/.config/google-chrome/NativeMessagingHosts
CHROMIUM_HOSTS_DIR := $(HOME)/.config/chromium/NativeMessagingHosts
CHROME_EXTENSION_ID ?= REPLACE_WITH_THE_ID_CHROME_ASSIGNS

install-browser-host:
	mkdir -p $(LIB_DIR) $(BIN_DIR) $(FIREFOX_HOSTS_DIR) $(CHROME_HOSTS_DIR) $(CHROMIUM_HOSTS_DIR)
	rm -rf $(LIB_DIR)/native-host
	cp -r src/native-host $(LIB_DIR)/native-host
	cp -r src/lib $(LIB_DIR)/lib
	for browser in firefox chrome; do \
	    sed -e 's|@LIB_DIR@|$(LIB_DIR)|g' -e 's|@GJS@|$(shell command -v gjs)|g' \
	        -e "s|@BROWSER@|$$browser|g" \
	        data/gnome-tasks-browser-host.in > $(BIN_DIR)/gnome-tasks-browser-host-$$browser; \
	    chmod +x $(BIN_DIR)/gnome-tasks-browser-host-$$browser; \
	done
	sed -e 's|@BIN_DIR@|$(BIN_DIR)|g' data/org.gnome.tasks.browser_host.firefox.json.in \
	    > $(FIREFOX_HOSTS_DIR)/org.gnome.tasks.browser_host.json
	sed -e 's|@BIN_DIR@|$(BIN_DIR)|g' -e 's|@CHROME_EXTENSION_ID@|$(CHROME_EXTENSION_ID)|g' \
	    data/org.gnome.tasks.browser_host.chrome.json.in \
	    > $(CHROME_HOSTS_DIR)/org.gnome.tasks.browser_host.json
	cp $(CHROME_HOSTS_DIR)/org.gnome.tasks.browser_host.json \
	    $(CHROMIUM_HOSTS_DIR)/org.gnome.tasks.browser_host.json
	@echo
	@echo "Host installed. Load the extension from browser/ — see browser/README.md."
	@echo "Chrome needs its extension id in the manifest:"
	@echo "  make install-browser-host CHROME_EXTENSION_ID=<the id chrome://extensions shows>"

uninstall:
	rm -rf $(EXT_DIR) $(LIB_DIR)
	rm -f $(BIN_DIR)/gnome-tasks-daemon $(DBUS_DIR)/org.gnome.Tasks.service
	rm -f $(SYSTEMD_DIR)/gnome-tasks-daemon.service
	rm -f $(BIN_DIR)/gnome-tasks-browser-host-firefox $(BIN_DIR)/gnome-tasks-browser-host-chrome
	rm -f $(FIREFOX_HOSTS_DIR)/org.gnome.tasks.browser_host.json
	rm -f $(CHROME_HOSTS_DIR)/org.gnome.tasks.browser_host.json
	rm -f $(CHROMIUM_HOSTS_DIR)/org.gnome.tasks.browser_host.json
	systemctl --user daemon-reload || true

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

restart-daemon:
	systemctl --user restart gnome-tasks-daemon.service
	journalctl --user -u gnome-tasks-daemon.service -f -n 20

logs:
	journalctl --user -f -o cat \
	    -u gnome-tasks-daemon.service -u org.gnome.Shell@wayland.service

clean:
	rm -rf $(BUILD)
