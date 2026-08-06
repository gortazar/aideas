{
  description = "gnome-tasks — KDE-style Activities for GNOME Shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Only the inputs the checks actually read, so editing STATUS.md or docs/ does not
      # invalidate the build cache. Note that a flake only ever sees git-tracked files:
      # `git add` new files before running `nix flake check`.
      sourceFor = pkgs:
        let inherit (pkgs.lib) fileset;
        in fileset.toSource {
          root = ./.;
          fileset = fileset.unions [
            ./src
            ./tests
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
            gjs # the JS runtime both the daemon and the tests run under
            glib # glib-compile-schemas, gdbus
            gtk4 # the preferences window
            libadwaita
            gnome-shell # `gnome-extensions pack`, and the Shell typelibs
            eslint
            dbus # dbus-run-session, for the D-Bus integration tests
            gnumake
            jq
            zip
            gettext
          ];

          shellHook = ''
            echo "gnome-tasks dev shell — make help"
          '';
        };
      });

      checks = forAllSystems (pkgs: {
        # ESLint over every JS file we ship. Runs offline: the config uses only built-in rules
        # so nothing has to be resolved from node_modules.
        lint = pkgs.runCommand "gnome-tasks-lint"
          {
            src = sourceFor pkgs;
            nativeBuildInputs = [ pkgs.eslint ];
          } ''
          cd $src
          export HOME=$TMPDIR
          eslint .
          touch $out
        '';

        # The Shell-free logic: state model, schema migration, adapter selection, layout
        # matching. Plain gjs, no compositor, no display.
        unit = pkgs.runCommand "gnome-tasks-unit"
          {
            src = sourceFor pkgs;
            nativeBuildInputs = [ pkgs.gjs ];
          } ''
          cd $src
          export HOME=$TMPDIR
          export XDG_DATA_HOME=$TMPDIR/data
          export XDG_CONFIG_HOME=$TMPDIR/config
          gjs -m tests/run.js | tee $TMPDIR/log
          mkdir -p $out
          cp $TMPDIR/log $out/unit.log
        '';

        # The daemon's D-Bus surface, against a private session bus. dbus-run-session gives the
        # test its own bus, so this is hermetic even though it spawns a real daemon process.
        dbus = pkgs.runCommand "gnome-tasks-dbus"
          {
            src = sourceFor pkgs;
            nativeBuildInputs = [ pkgs.gjs pkgs.dbus ];
          } ''
          cd $src
          export HOME=$TMPDIR
          export XDG_DATA_HOME=$TMPDIR/data
          export XDG_CONFIG_HOME=$TMPDIR/config
          export XDG_RUNTIME_DIR=$TMPDIR/run
          mkdir -p $XDG_RUNTIME_DIR
          # The sandbox has no /etc/dbus-1, so the bus configuration has to be named explicitly.
          # gjs has to be on PATH too: the test spawns the daemon as a subprocess.
          dbus-run-session --config-file=${pkgs.dbus.out}/share/dbus-1/session.conf \
            -- gjs -m tests/run.js tests/dbus | tee $TMPDIR/log
          mkdir -p $out
          cp $TMPDIR/log $out/dbus.log
        '';

        # Assemble the extension the way `make install` does and validate the result. An extension
        # fails at load time inside the compositor, so a missing file or a mistyped relative import
        # is otherwise only discovered by a user reading the journal. Deliberately does not use
        # `gnome-extensions pack`, which would pull the whole gnome-shell closure into CI.
        bundle = pkgs.runCommand "gnome-tasks-bundle"
          {
            src = sourceFor pkgs;
            nativeBuildInputs = [ pkgs.gjs pkgs.glib pkgs.gnumake ];
          } ''
          cp -r $src work
          chmod -R u+w work
          cd work
          export HOME=$TMPDIR
          make build
          gjs -m tools/check-bundle.js "build/gnome-tasks@patxi.gortazar" | tee $TMPDIR/log
          mkdir -p $out
          cp $TMPDIR/log $out/bundle.log
        '';
      });

      formatter = forAllSystems (pkgs: pkgs.nixpkgs-fmt);
    };
}
