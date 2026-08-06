{
  description = "pwgen — GNOME Shell extension generating passwords in-process (dev/test/release env)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # The extension itself lives in its own repository; `upstream/` here is a git
    # submodule pointing at the same place. Nix cannot read through a submodule
    # gitlink, so the sources are also taken as a plain (non-flake) input: that is
    # what lets `nix flake check` run the real test suite hermetically, with
    # flake.lock recording the exact commit. scripts/check-pin.sh asserts the two
    # pins agree, so they cannot drift apart unnoticed.
    pwgen-src = {
      url = "github:gortazar/gnome-shell-pwgen";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, pwgen-src }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        uuid = "pwgen-generator@pwgen-gs.patxi";

        # The file set `gnome-extensions pack` uploads: sources at the zip root,
        # schemas compiled alongside their XML. Kept in step with
        # upstream/ci/lint-package.sh, which lints this same layout.
        packExtension = pkgs.writeShellApplication {
          name = "pwgen-pack";
          # glib-compile-schemas lives in glib's `dev` output, and runtimeInputs
          # only puts the default output on PATH.
          runtimeInputs = [ pkgs.glib.dev pkgs.zip pkgs.jq ];
          text = ''
            src="$1"
            outDir="$2"
            stage="$(mktemp -d)"
            trap 'rm -rf "$stage"' EXIT

            # gnome-extensions pack refuses a metadata.json missing any of these,
            # and so does extensions.gnome.org.
            for field in uuid name description shell-version url; do
              jq -e --arg f "$field" \
                'has($f) and (.[$f] | if type == "array" then length > 0 else . != "" end)' \
                "$src/metadata.json" >/dev/null \
                || { echo "metadata.json: missing or empty \"$field\"" >&2; exit 1; }
            done
            jq -e --arg u '${uuid}' '.uuid == $u' "$src/metadata.json" >/dev/null \
              || { echo "metadata.json: uuid is not ${uuid}" >&2; exit 1; }

            mkdir -p "$stage/schemas" "$stage/lib"
            cp "$src/metadata.json" "$src/extension.js" "$src/prefs.js" \
              "$src/LICENSE" "$stage/"
            cp "$src"/lib/*.js "$stage/lib/"
            cp "$src"/schemas/*.gschema.xml "$stage/schemas/"
            [ -f "$src/stylesheet.css" ] && cp "$src/stylesheet.css" "$stage/"
            [ -d "$src/locale" ] && cp -r "$src/locale" "$stage/"

            # The shell reads the compiled file, so a schema that will not compile
            # has to fail here rather than at install time.
            glib-compile-schemas --strict "$stage/schemas"

            mkdir -p "$outDir"
            ( cd "$stage" && zip -qr "$outDir/${uuid}.shell-extension.zip" . )
            echo "packed $outDir/${uuid}.shell-extension.zip"
          '';
        };
      in {
        # `nix develop` — everything needed to work on upstream/ locally.
        #
        # ESLint is deliberately not a nix package here: the extension pins its own
        # version in upstream/package.json (flat config, ESLint 9), so use the
        # nodejs from this shell and `npm ci` in upstream/ to get exactly the
        # version CI uses.
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.gjs # runs the headless test suite
            pkgs.glib.dev # glib-compile-schemas
            pkgs.nodejs_22 # npm ci && npx eslint
            pkgs.python3 # shexli, the EGO package linter
            pkgs.zip
            pkgs.jq # scripts/check-pin.sh
            pkgs.git
            packExtension
          ];

          shellHook = ''
            echo "pwgen dev shell — sources in upstream/ (git submodule)"
            echo "  nix run .#tests    headless generator suite against the working tree"
            echo "  nix flake check    same suite against the commit pinned in flake.lock"
            echo "  nix build          packed .shell-extension.zip for extensions.gnome.org"
          '';
        };

        # `nix flake check` — runs against the pinned commit, not the working tree,
        # so it says exactly what the recorded upstream revision does.
        checks = {
          # The generator is a shell-free module, so the whole suite runs under
          # plain gjs: no display, no compositor.
          unit-tests = pkgs.runCommand "pwgen-unit-tests"
            {
              src = pwgen-src;
              nativeBuildInputs = [ pkgs.gjs ];
            } ''
            cp -r "$src" ./source
            chmod -R u+w ./source
            cd ./source
            gjs -m tests/run.js | tee "$out"
          '';

          # A schema the shell cannot compile means preferences fail to open, and
          # --strict turns EGO-relevant warnings into errors.
          schemas = pkgs.runCommand "pwgen-schemas"
            {
              src = pwgen-src;
              nativeBuildInputs = [ pkgs.glib ];
            } ''
            glib-compile-schemas --strict --dry-run "$src/schemas"
            echo "schemas OK" > "$out"
          '';

          # Packaging mistakes are publish blockers, so treat one as a test
          # failure: an incomplete zip is how a working extension still ends up
          # broken for everyone who installs it.
          pack = pkgs.runCommand "pwgen-pack"
            {
              src = pwgen-src;
              nativeBuildInputs = [ packExtension pkgs.unzip ];
            } ''
            pwgen-pack "$src" "$PWD/out"
            zip="$PWD/out/${uuid}.shell-extension.zip"

            unzip -l "$zip"
            # The zip is what users actually get. The generator living in a
            # subdirectory makes it the easy thing to leave out, and the extension
            # does not load without it.
            for entry in metadata.json extension.js prefs.js lib/generator.js \
                schemas/gschemas.compiled; do
              unzip -l "$zip" | grep -q " $entry\$" \
                || { echo "packed zip is missing $entry" >&2; exit 1; }
            done
            echo "pack OK" > "$out"
          '';
        };

        # `nix build` — the uploadable artifact.
        packages.default = pkgs.runCommand "pwgen-shell-extension"
          {
            src = pwgen-src;
            nativeBuildInputs = [ packExtension ];
          } ''
          pwgen-pack "$src" "$out"
        '';

        # `nix run .#tests` — the same suite against the working tree in upstream/,
        # which is what you want while editing. Impure on purpose: it reads the
        # checkout rather than a pinned store path.
        apps.tests = {
          type = "app";
          meta.description = "Run the headless generator suite against upstream/";
          program = "${pkgs.writeShellApplication {
            name = "pwgen-tests";
            runtimeInputs = [ pkgs.gjs ];
            text = ''
              cd "''${1:-upstream}"
              if [ ! -f tests/run.js ]; then
                echo "no tests/run.js here — is the submodule checked out?" >&2
                echo "run: git submodule update --init" >&2
                exit 1
              fi
              exec gjs -m tests/run.js
            '';
          }}/bin/pwgen-tests";
        };
      });
}
