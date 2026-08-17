{
  description = "aideas — the orchestrator's live state in the GNOME Shell top bar";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      uuid = "aideas-shell@patxi.gortazar";

      # Only the inputs the checks actually read, so editing STATUS.md or docs/ does not
      # invalidate the build cache. Note that a flake only ever sees git-tracked files:
      # `git add` new files before running `nix flake check`.
      #
      # tests/test_state_contract.py is deliberately *not* here. It imports the orchestrator
      # from two directories up, outside this flake's root, which a flake cannot see; CI runs
      # it as its own step with a stock python3, which is all it needs. `make test-contract`.
      sourceFor = pkgs:
        let inherit (pkgs.lib) fileset;
        in fileset.toSource {
          root = ./.;
          fileset = fileset.unions [
            ./src
            ./tests/harness.js
            ./tests/run.js
            ./tests/unit
            ./tests/http
            ./tests/stub-state-server.py
            ./tools
            # The smoke test's probe extension is linted too, and worth it: the stray backtick
            # that broke it (inside a template literal holding D-Bus XML) is a parse error
            # eslint reports in a second, where the compositor took a four-minute run to say
            # only that the probe never appeared on the bus.
            ./ci
            ./eslint.config.mjs
            ./Makefile
          ];
        };
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            gjs # the runtime the extension and its tests both run under
            glib # glib-compile-schemas, gsettings
            gtk4 # the preferences window
            libadwaita
            gnome-shell # `gnome-extensions enable/prefs`, and the Shell typelibs
            eslint
            python3 # the /state contract test, and the stub server the smoke test uses
            dbus # dbus-run-session, which ci/install-test.sh needs to isolate dconf
            gnumake
            jq
            zip
            unzip
            curl
          ];

          shellHook = ''
            echo "aideas dev shell — make help"
          '';
        };
      });

      checks = forAllSystems (pkgs: {
        # ESLint over every JS file we ship. Runs offline: the config uses only built-in rules
        # so nothing has to be resolved from node_modules.
        lint = pkgs.runCommand "aideas-lint"
          {
            src = sourceFor pkgs;
            nativeBuildInputs = [ pkgs.eslint ];
          } ''
          cd $src
          export HOME=$TMPDIR
          eslint .
          touch $out
        '';

        # The Shell-free logic: parsing a /state body, grouping it into sections, the wording,
        # the visibility rule, the badge, the backoff and the scheduler. Plain gjs, no
        # compositor, no display, no network.
        unit = pkgs.runCommand "aideas-unit"
          {
            src = sourceFor pkgs;
            # gdk-pixbuf and librsvg are here for one test: that each shipped SVG can actually
            # be loaded as an image. A comment before the <svg> element makes gdk-pixbuf refuse
            # the file, the shell substitutes a fallback icon, and nothing is logged — so this
            # is checked with the same loader the shell uses rather than by reading the XML.
            nativeBuildInputs = [ pkgs.gjs pkgs.gdk-pixbuf pkgs.librsvg ];
          } ''
          cd $src
          export HOME=$TMPDIR
          export XDG_DATA_HOME=$TMPDIR/data
          export XDG_CONFIG_HOME=$TMPDIR/config
          # The typelib is what `import GdkPixbuf from 'gi://GdkPixbuf'` needs; the module file
          # is what makes that loader able to read an SVG at all.
          export GI_TYPELIB_PATH=${pkgs.gdk-pixbuf}/lib/girepository-1.0
          export GDK_PIXBUF_MODULE_FILE=${pkgs.librsvg}/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache
          gjs -m tests/run.js tests/unit | tee $TMPDIR/log
          mkdir -p $out
          cp $TMPDIR/log $out/unit.log
        '';

        # The real libsoup transport, against a real HTTP server on loopback. libsoup needs no
        # compositor, so the half of the client a fake transport cannot check — that requests
        # go out, that the deadline fires, and that a refused connection is reported in a
        # phrase that does not change with the user's language — is checked here rather than
        # left to the smoke test. Hermetic: the Nix sandbox's network namespace has only `lo`,
        # and the stub server lets the kernel pick its port.
        http = pkgs.runCommand "aideas-http"
          {
            src = sourceFor pkgs;
            nativeBuildInputs = [ pkgs.gjs pkgs.libsoup_3 pkgs.glib-networking pkgs.python3 ];
          } ''
          cd $src
          export HOME=$TMPDIR
          export XDG_DATA_HOME=$TMPDIR/data
          export XDG_CONFIG_HOME=$TMPDIR/config
          # gjs finds Soup-3.0 through the typelib search path, which nothing sets for us.
          export GI_TYPELIB_PATH=${pkgs.libsoup_3}/lib/girepository-1.0
          # libsoup finds its TLS and proxy backends through GIO modules; without this a
          # session in the sandbox fails to construct.
          export GIO_MODULE_DIR=${pkgs.glib-networking}/lib/gio/modules
          gjs -m tests/run.js tests/http | tee $TMPDIR/log
          mkdir -p $out
          cp $TMPDIR/log $out/http.log
        '';

        # Assemble the extension the way `make install` does and validate the result. An
        # extension fails at load time inside the compositor, so a missing file, a mistyped
        # relative import or an uncompiled schema is otherwise only found by a user reading
        # the journal. Deliberately avoids `gnome-extensions pack`, which would pull the whole
        # gnome-shell closure into CI.
        bundle = pkgs.runCommand "aideas-bundle"
          {
            src = sourceFor pkgs;
            nativeBuildInputs = [ pkgs.gjs pkgs.glib pkgs.gnumake ];
          } ''
          cp -r $src work
          chmod -R u+w work
          cd work
          export HOME=$TMPDIR
          make build
          gjs -m tools/check-bundle.js "build/${uuid}" | tee $TMPDIR/log
          mkdir -p $out
          cp $TMPDIR/log $out/bundle.log
        '';
      });

      # The release artefact: the same zip `make pack` produces and the release workflow
      # uploads, so `nix build` and a published asset cannot be different things. gjs is here
      # because `make pack` validates the bundle before zipping it; gnome-shell is not, because
      # nothing assembles the zip but zip itself.
      packages = forAllSystems (pkgs: {
        default = pkgs.stdenv.mkDerivation {
          pname = "aideas-shell-extension";
          version = "0.2";
          src = sourceFor pkgs;
          nativeBuildInputs = [ pkgs.glib pkgs.gjs pkgs.gnumake pkgs.zip ];
          buildPhase = ''
            export HOME=$TMPDIR
            make pack
          '';
          installPhase = ''
            mkdir -p $out
            cp build/${uuid}.shell-extension.zip $out/
          '';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixpkgs-fmt);
    };
}
