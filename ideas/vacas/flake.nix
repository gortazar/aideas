{
  description = "vacas — wrapper: checks the pinned upstream extension builds and passes";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # The extension lives in its own repository; `upstream/` here is a git submodule
    # pointing at the same place. Nix cannot read through a submodule gitlink, so the
    # sources are also taken as a plain (non-flake) input — that is what lets
    # `nix flake check` run the real suite hermetically, with flake.lock recording the
    # exact commit. scripts/check-pin.sh asserts the two pins agree.
    vacas-src = {
      url = "github:gortazar/vacas";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, vacas-src }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 pkgs.git pkgs.jq pkgs.zip pkgs.unzip pkgs.web-ext ];
          shellHook = ''
            echo "vacas wrapper shell — the extension itself is in upstream/"
            echo "  scripts/check-pin.sh   submodule and flake input agree"
            echo "  nix flake check        upstream's dependency-free suite at the pinned commit"
          '';
        };

        checks = {
          # Upstream's unit suite, at the pinned revision. It is deliberately the
          # dependency-free half: this runs with no network, and jsdom/Playwright are
          # upstream CI's job.
          upstream-unit-tests = pkgs.runCommand "vacas-upstream-unit-tests"
            {
              src = vacas-src;
              nativeBuildInputs = [ pkgs.nodejs_22 ];
            } ''
            cp -r "$src" ./source
            chmod -R u+w ./source
            cd ./source
            node --test "tests/unit/**/*.test.js" | tee "$out"
          '';

          # The wrapper's own coherence: the manifest at the pinned commit is the version
          # STATUS.md claims, so a stale pin cannot masquerade as a shipped release.
          pinned-version = pkgs.runCommand "vacas-pinned-version"
            {
              src = vacas-src;
              status = ./STATUS.md;
              nativeBuildInputs = [ pkgs.jq ];
            } ''
            manifestVersion="$(jq -r .version "$src/src/manifest.json")"
            statusVersion="$(sed -n 's/^version: *//p' "$status" | head -n1)"
            echo "manifest: $manifestVersion   STATUS.md: $statusVersion"
            [ "$manifestVersion" = "$statusVersion" ] || {
              echo "the pinned extension says $manifestVersion, STATUS.md says $statusVersion" >&2
              exit 1
            }
            echo "versions agree" > "$out"
          '';
        };
      });
}
