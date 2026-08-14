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
            ./tools
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
            gnome-shell # `gnome-extensions pack`, and the Shell typelibs
            eslint
            python3 # the /state contract test, and the stub server the smoke test uses
            gnumake
            jq
            zip
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
            nativeBuildInputs = [ pkgs.gjs ];
          } ''
          cd $src
          export HOME=$TMPDIR
          export XDG_DATA_HOME=$TMPDIR/data
          export XDG_CONFIG_HOME=$TMPDIR/config
          gjs -m tests/run.js tests/unit | tee $TMPDIR/log
          mkdir -p $out
          cp $TMPDIR/log $out/unit.log
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
      # uploads, so `nix build` and a published asset cannot be different things.
      packages = forAllSystems (pkgs: {
        default = pkgs.stdenv.mkDerivation {
          pname = "aideas-shell-extension";
          version = "0.1";
          src = sourceFor pkgs;
          nativeBuildInputs = [ pkgs.glib pkgs.gnome-shell pkgs.gnumake pkgs.zip ];
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
