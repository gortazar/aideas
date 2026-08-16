{
  description = "title-slides — Quarto extension carrying the last ## title onto continuation slides (wrapper)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # The extension itself lives in its own repository; `upstream/` here is a git
    # submodule pointing at the same place. Nix cannot read through a submodule
    # gitlink, so the sources are also taken as a plain (non-flake) input: that is
    # what lets `nix flake check` run the real test suite hermetically, with
    # flake.lock recording the exact commit. scripts/check-pin.sh asserts the two
    # pins agree, so they cannot drift apart unnoticed.
    title-slides-src = {
      url = "github:gortazar/title-slides";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, title-slides-src }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # Just enough to check the wrapper: the pin check needs git and jq, and nothing
        # here renders anything. Developing the extension itself means `nix develop` in
        # upstream/, which brings the pinned quarto with it.
        default = pkgs.mkShell {
          packages = [ pkgs.git pkgs.jq ];
        };
      });

      checks = forAllSystems (pkgs: {
        # The real test suite runs upstream. What matters here is that the wrapper is
        # coherent: the extension the submodule points at is well-formed and its unit
        # tests still pass at the pinned commit.
        wrapper = pkgs.runCommand "title-slides-wrapper"
          {
            src = title-slides-src;
            nativeBuildInputs = [ pkgs.pandoc pkgs.bash pkgs.yq-go ];
          } ''
          cp -r "$src" source && chmod -R u+w source
          cd source

          test -f _extensions/title-slides/_extension.yml \
            || { echo "upstream has no _extensions/title-slides/_extension.yml" >&2; exit 1; }

          # `quarto add` reads this file; a filter listed here but missing on disk
          # installs an extension that fails at render time.
          for filter in $(yq -r '.contributes.filters[]' _extensions/title-slides/_extension.yml); do
            test -f "_extensions/title-slides/$filter" \
              || { echo "_extension.yml lists $filter, which does not exist" >&2; exit 1; }
          done

          bash tests/run-unit.sh
          touch "$out"
        '';
      });
    };
}
