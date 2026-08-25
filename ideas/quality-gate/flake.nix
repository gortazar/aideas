{
  description = "quality-gate — the shared SonarQube Cloud workflow and its wiring (lint/check env)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  # This idea has no upstream repository and ships no binary: what it delivers is a
  # reusable workflow living at this repo's root, plus the caller workflows, badges
  # and properties files that six projects use to call it. So there is nothing to
  # build here, only two things to check — that the shell scripts are sound, and that
  # the workflows are valid GitHub Actions YAML.
  #
  # Those two live in different places, and the split below follows that:
  #
  #   nix flake check   shellcheck over scripts/ — self-contained, so it runs in the
  #                     sandbox against the flake's own source.
  #   nix run .#lint    actionlint over ../../.github/workflows/ and check-wiring.sh
  #                     over the whole checkout. Both read files outside this
  #                     directory, which a sandboxed check cannot see, so they are an
  #                     app that CI runs as a separate step.
  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # The workflows this idea owns, relative to the repo root. actionlint is
        # pointed at these by name rather than at the whole directory: the other
        # ci-*.yml files belong to other ideas, and a lint failure in one of those is
        # not this idea's to fix or to be blocked by.
        ownWorkflows = [
          ".github/workflows/sonar.yml"
          ".github/workflows/tag-sonar.yml"
          ".github/workflows/sonar-aideas-repo.yml"
          ".github/workflows/release-quality-gate.yml"
          ".github/workflows/ci-quality-gate.yml"
        ];

        lint = pkgs.writeShellApplication {
          name = "quality-gate-lint";
          runtimeInputs = [ pkgs.actionlint pkgs.shellcheck pkgs.git ];
          text = ''
            # Run from the idea directory whatever the caller's cwd, so the relative
            # paths below mean one thing.
            cd "''${QUALITY_GATE_DIR:-$(git rev-parse --show-toplevel)/ideas/quality-gate}"
            root="$(cd ../.. && pwd)"

            status=0

            echo "== actionlint =="
            for wf in ${builtins.concatStringsSep " " ownWorkflows}; do
              if [ -f "$root/$wf" ]; then
                echo "  $wf"
                actionlint "$root/$wf" || status=1
              else
                # Not yet written is fine; wired-but-broken is not. The units that
                # add each workflow are what make these appear.
                echo "  $wf — not present, skipped"
              fi
            done

            echo "== check-wiring =="
            ./scripts/check-wiring.sh || status=1

            exit $status
          '';
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.actionlint
            pkgs.shellcheck
            pkgs.git
            pkgs.curl # reading measures back out of the SonarQube Cloud web API
            pkgs.jq
            lint
          ];

          shellHook = ''
            echo "quality-gate — the shared Sonar workflow lives in ../../.github/workflows/sonar.yml"
            echo "  nix flake check           shellcheck over scripts/"
            echo "  nix run .#lint            actionlint + check-wiring.sh over the checkout"
            echo "  ./scripts/check-wiring.sh every project's caller, properties, badge, baseline row"
          '';
        };

        checks.shellcheck = pkgs.runCommand "quality-gate-shellcheck"
          {
            src = ./scripts;
            nativeBuildInputs = [ pkgs.shellcheck ];
          } ''
          shellcheck --severity=style "$src"/*.sh
          echo "shellcheck OK" > "$out"
        '';

        apps.lint = {
          type = "app";
          meta.description = "actionlint the workflows this idea owns, then check the wiring";
          program = "${lint}/bin/quality-gate-lint";
        };
      });
}
