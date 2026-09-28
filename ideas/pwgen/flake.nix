{
  description = "pwgen — GNOME Shell extension generating passwords in-process (idea wrapper)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # The extension lives in its own repository; `upstream/` here is a git submodule
    # pointing at the same place. Nix cannot read through a submodule gitlink, so the
    # repository is taken as a flake input as well — and because upstream *is* a flake
    # now, this wrapper runs upstream's own checks rather than a second copy of them that
    # would drift. flake.lock records the exact commit; scripts/check-pin.sh asserts it is
    # the commit the submodule points at and the one STATUS.md names.
    pwgen-src.url = "github:gortazar/gnome-shell-pwgen";
  };

  outputs = { self, nixpkgs, flake-utils, pwgen-src }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        # Exactly upstream's checks — the headless gjs suite, a --strict schema compile,
        # and the upload zip assembled and inspected — against the pinned commit.
        checks = pwgen-src.checks.${system};

        # The packed .shell-extension.zip, the same artefact the release workflow publishes.
        packages.default = pwgen-src.packages.${system}.default;

        # `nix develop` here gets you upstream's development shell plus what the wrapper's
        # own scripts need.
        devShells.default = pkgs.mkShell {
          inputsFrom = [ pwgen-src.devShells.${system}.default ];
          packages = [ pkgs.jq pkgs.git pkgs.curl pkgs.unzip ];
          shellHook = ''
            echo "pwgen idea wrapper — the extension is in upstream/ (git submodule)"
            echo "  ./scripts/check-pin.sh       the gitlink, flake.lock and STATUS.md agree"
            echo "  ./scripts/check-release.sh   the release for STATUS.md's version is real"
            echo "  nix flake check              upstream's checks, at the pinned commit"
            echo "  cd upstream && ...           where the actual work happens"
          '';
        };
      });
}
