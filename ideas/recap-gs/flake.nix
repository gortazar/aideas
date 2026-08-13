{
  description = "recap-gs — agent statuses in the GNOME Shell top bar (idea wrapper)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # The extension lives in its own repository; `upstream/` here is a git submodule
    # pointing at the same place. Nix cannot read through a submodule gitlink, so the
    # repository is taken as a flake input as well — and because upstream *is* a flake,
    # this wrapper can run upstream's own checks rather than a second copy of them that
    # would drift. flake.lock records the exact commit; scripts/check-pin.sh asserts it is
    # the same commit the submodule points at.
    recap-gs-src.url = "github:gortazar/recap-gs";
  };

  outputs = { self, nixpkgs, flake-utils, recap-gs-src }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        # Exactly upstream's checks — ESLint, the headless gjs suite, a --strict schema
        # compile, and the upload zip assembled and inspected — against the pinned commit.
        checks = recap-gs-src.checks.${system};

        # The packed .shell-extension.zip, the same artefact the release workflow publishes.
        packages.default = recap-gs-src.packages.${system}.default;

        # `nix develop` here gets you upstream's development shell plus what the wrapper's
        # own scripts need.
        devShells.default = pkgs.mkShell {
          inputsFrom = [ recap-gs-src.devShells.${system}.default ];
          packages = [ pkgs.jq pkgs.git ];
          shellHook = ''
            echo "recap-gs idea wrapper — the extension is in upstream/ (git submodule)"
            echo "  ./scripts/check-pin.sh   the submodule and the flake input agree"
            echo "  nix flake check          upstream's checks, at the pinned commit"
            echo "  cd upstream && ...       where the actual work happens"
          '';
        };
      });
}
