{
  description = "restore-wss — wrapper checks for the idea (the real suite lives upstream)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # The code lives in its own repository; `upstream/` here is a git submodule pointing at the
    # same place. Nix cannot read through a submodule gitlink, so the sources are also taken as a
    # plain (non-flake) input: that is what lets this flake test the exact recorded commit, with
    # flake.lock pinning it. scripts/check-pin.sh asserts the two pins agree.
    restore-wss-src = {
      url = "github:gortazar/restore-wss";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, restore-wss-src }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        python = pkgs.python3.withPackages (ps: [ ps.pygobject3 ps.pytest ]);
      in {
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.git pkgs.jq python ];
          shellHook = ''
            echo "restore-wss wrapper — the sources are in upstream/ (git submodule)"
            echo "  scripts/check-pin.sh   assert the submodule and the flake input agree"
            echo "  nix flake check        run the upstream unit suite against the pinned commit"
            echo "  cd upstream && nix develop   the real development environment"
          '';
        };

        checks = {
          # A light check of the pinned commit, not the idea's full suite: that runs in the
          # upstream repository's own CI, which has a Shell-free environment set up for it.
          # What matters here is that the commit this repo records is not broken.
          upstream-unit-tests = pkgs.runCommand "restore-wss-upstream-unit"
            {
              src = restore-wss-src;
              nativeBuildInputs = [ python ];
            } ''
            cp -r "$src" ./source
            chmod -R u+w ./source
            cd ./source
            PYTHONPATH=$PWD/src python -m pytest tests/unit -q | tee "$out"
          '';

          # The wrapper is only coherent if the documents it promises exist at the pinned commit.
          upstream-deliverables = pkgs.runCommand "restore-wss-upstream-deliverables"
            { src = restore-wss-src; } ''
            for f in README.md flake.nix docs/similar-tools.md docs/platform-findings.md \
                docs/state-schema.md docs/app-adapters.md docs/limitations.md \
                src/extension/metadata.json install.sh; do
              [ -e "$src/$f" ] || { echo "missing upstream deliverable: $f" >&2; exit 1; }
            done
            echo "deliverables OK" > "$out"
          '';
        };
      });
}
