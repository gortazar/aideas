{
  description = "meet — one click from the top bar into an OpenVidu Meet room (idea wrapper)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # The extension lives in its own repository; `upstream/` here is a git submodule
    # pointing at the same place. Nix cannot read through a submodule gitlink, so the
    # repository is taken as a flake input as well — and because upstream *is* a flake,
    # this wrapper can run upstream's own checks rather than a second copy of them that
    # would drift. flake.lock records the exact commit; scripts/check-pin.sh asserts it is
    # the same commit the submodule points at.
    meet-src.url = "github:gortazar/meet";
  };

  outputs = { self, nixpkgs, flake-utils, meet-src }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        # Exactly upstream's checks — ESLint, the headless gjs suite, and the upload zip
        # assembled and inspected — against the pinned commit.
        checks = meet-src.checks.${system};

        # The packed .shell-extension.zip, the same artefact the release workflow publishes.
        packages.default = meet-src.packages.${system}.default;

        # `nix develop` here gets you upstream's development shell plus what the wrapper's
        # own scripts need.
        devShells.default = pkgs.mkShell {
          inputsFrom = [ meet-src.devShells.${system}.default ];
          packages = [ pkgs.jq pkgs.git pkgs.curl ];
          shellHook = ''
            echo "meet idea wrapper — the extension is in upstream/ (git submodule)"
            echo "  ./scripts/check-pin.sh      the submodule and the flake input agree"
            echo "  ./scripts/check-release.sh  the release is published and installable"
            echo "  nix flake check             upstream's checks, at the pinned commit"
            echo "  cd upstream && ...          where the actual work happens"
          '';
        };
      });
}
