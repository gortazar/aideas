{
  description = "Dev/build/test/release environment for <idea name>";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let pkgs = import nixpkgs { inherit system; };
      in {
        # `nix develop` — everything needed to build/test/run locally.
        devShells.default = pkgs.mkShell {
          buildInputs = [
            # add language toolchains here, e.g. pkgs.nodejs_22, pkgs.python312, pkgs.go
          ];
        };

        # `nix build` — replace with the real build once the idea's stack is chosen.
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "idea";
          version = "0.0.0";
          src = ./.;
          buildPhase = "echo 'replace with real build steps'";
          installPhase = "mkdir -p $out";
        };

        # `nix flake check` — wire this to the real test command once chosen.
        checks.default = pkgs.runCommand "tests" { } "echo replace-with-real-tests > $out";
      });
}
