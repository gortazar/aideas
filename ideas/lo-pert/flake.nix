{
  description = "lo-pert — PERT diagrams for LibreOffice (idea wrapper: dev/test env)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # The extension lives in its own repository; `upstream/` here is a git submodule
    # pointing at the same place. Nix cannot read through a submodule gitlink, so the
    # sources are also taken as a plain (non-flake) input: that is what lets
    # `nix flake check` run the real test suite hermetically, with flake.lock
    # recording the exact commit. scripts/check-pin.sh asserts the two pins agree, so
    # they cannot drift apart unnoticed.
    lo-pert-src = {
      url = "github:gortazar/lo-pert";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, lo-pert-src }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        python = pkgs.python3.withPackages (ps: [ ps.pytest ps.hypothesis ]);
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            python
            pkgs.libreoffice
            pkgs.zip
            pkgs.unzip
            pkgs.jq # scripts/check-pin.sh
            pkgs.git
          ];

          shellHook = ''
            echo "lo-pert idea wrapper — sources in upstream/ (git submodule)"
            echo "  ./scripts/check-pin.sh   submodule and flake input agree"
            echo "  nix flake check          core tests at the pinned commit"
            echo "  cd upstream && nix develop   the real dev shell"
          '';
        };

        # Runs against the pinned commit, not the working tree, so it says exactly
        # what the recorded upstream revision does. The headless LibreOffice tests
        # live upstream, where they have a display-free soffice to drive; here we
        # check the part that needs nothing but python.
        checks.unit = pkgs.runCommand "lo-pert-unit-tests"
          {
            src = lo-pert-src;
            nativeBuildInputs = [ python ];
          } ''
          cp -r "$src" ./source
          chmod -R u+w ./source
          cd ./source
          PYTHONPATH="$PWD/src" pytest tests/unit -q | tee "$out"
        '';
      });
}
