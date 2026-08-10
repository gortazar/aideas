{
  description = "recap — what were my coding agents doing? (idea wrapper: dev/build/test env)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # recap itself lives in its own repository; `upstream/` here is a git submodule
    # pointing at the same place. Nix cannot read through a submodule gitlink, so the
    # sources are also taken as a plain (non-flake) input: that is what lets
    # `nix flake check` build and test the real thing hermetically, with flake.lock
    # recording the exact commit. scripts/check-pin.sh asserts the two pins agree, so
    # they cannot drift apart unnoticed.
    recap-src = {
      url = "github:gortazar/recap";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, recap-src }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Kept in step with upstream's own flake.nix, which builds the same package for
      # people working in the recap repository directly.
      recapFor = pkgs: pkgs.buildGoModule {
        pname = "recap";
        version = "0.1";
        src = recap-src;
        # modernc.org/sqlite and its dependencies, for reading opencode's store. Update
        # this hash whenever upstream's go.sum changes: `nix build` prints the one it
        # wanted.
        vendorHash = "sha256-5WaCZ29wuU/aP05IBHTM0WhELYrYoerGlIS3QxoXL5o=";
        # Same stamping as upstream's own flake, so `nix run` from here and `nix run` from
        # the recap repository report the same thing.
        ldflags = [
          "-s"
          "-w"
          "-X github.com/gortazar/recap/internal/cli.Version=0.1"
          "-X github.com/gortazar/recap/internal/cli.Commit=${recap-src.rev}"
          "-X github.com/gortazar/recap/internal/cli.BuildDate=nix"
        ];
        meta = {
          description = "One-line recap of what every local coding agent session was doing";
          mainProgram = "recap";
        };
      };
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            go
            gopls
            gotools
            sqlite
            jq
            git # scripts/check-pin.sh
            python3
            charm-freeze
            shellcheck
          ];
          shellHook = ''
            echo "recap idea shell — the code is in upstream/ (its own repository)"
          '';
        };
      });

      packages = forAllSystems (pkgs: {
        default = recapFor pkgs;
        recap = recapFor pkgs;
      });

      checks = forAllSystems (pkgs: {
        # buildGoModule's checkPhase is `go test ./...`, so this is the real suite,
        # run against the pinned upstream commit.
        tests = recapFor pkgs;

        gofmt = pkgs.runCommand "gofmt-check" { nativeBuildInputs = [ pkgs.go ]; } ''
          export HOME=$TMPDIR
          unformatted="$(cd ${recap-src} && gofmt -l .)"
          if [ -n "$unformatted" ]; then
            echo "not gofmt-clean:"; echo "$unformatted"; exit 1
          fi
          touch $out
        '';
      });
    };
}
