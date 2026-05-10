{
  description = "Agent Tick self-hosted approval service";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs @ { self, flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" ];

      flake.nixosModules = rec {
        agent-tick = import ./nix/modules/agent-tick.nix { inherit self; };
        default = agent-tick;
      };

      perSystem = { pkgs, lib, system, ... }:
        let
          nodejs = pkgs.nodejs_24;
          pnpm = pkgs.pnpm_10;

          src = lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              let
                base = baseNameOf path;
              in
                !(lib.elem base [
                  ".git"
                  ".jj"
                  "node_modules"
                  ".env"
                  ".devbox"
                  ".venv"
                  "dist"
                  "result"
                ]);
          };

          agent-tick-server = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-server";
            version = "0.1.0";
            inherit src;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              fetcherVersion = 2;
              hash = "sha256-yEAwKHUYyoQ96PfXSt+SX5IoEZf3yYSUwdle8B+qnq8=";
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              pkgs.pnpmConfigHook
              pkgs.python3
              pkgs.pkg-config
              pkgs.node-gyp
              pkgs.makeWrapper
            ];

            buildInputs = [ pkgs.sqlite ];

            dontCheckForBrokenSymlinks = true;

            buildPhase = ''
              runHook preBuild

              export npm_config_build_from_source=true
              export npm_config_nodedir=${nodejs}
              (cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release)

              pnpm --filter @agent-tick/shared build
              pnpm --filter @agent-tick/sdk build
              pnpm --filter @agent-tick/db build
              pnpm --filter @agent-tick/server build
              pnpm --filter agent-tick-admin build

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p "$out/lib/agent-tick" "$out/bin"
              cp -R package.json pnpm-workspace.yaml node_modules apps packages "$out/lib/agent-tick/"
              rm -rf \
                "$out/lib/agent-tick/apps"/*/src \
                "$out/lib/agent-tick/apps"/*/test \
                "$out/lib/agent-tick/packages"/*/src \
                "$out/lib/agent-tick/packages"/*/test

              makeWrapper ${nodejs}/bin/node "$out/bin/agent-tick-server" \
                --add-flags "$out/lib/agent-tick/apps/server/dist/index.js" \
                --set-default AGENT_TICK_ADMIN_DIST "$out/lib/agent-tick/apps/server/public/admin"

              runHook postInstall
            '';

            meta = {
              description = "Agent Tick API server and dashboard";
              homepage = "https://agenttick.sh";
              mainProgram = "agent-tick-server";
              platforms = lib.platforms.linux;
            };
          });
        in {
          packages = {
            inherit agent-tick-server;
            default = agent-tick-server;
          };

          apps.default = {
            type = "app";
            program = "${agent-tick-server}/bin/agent-tick-server";
            meta.description = "Run the Agent Tick server";
          };

          devShells.default = pkgs.mkShell {
            packages = [ nodejs pnpm pkgs.sqlite pkgs.python3 pkgs.pkg-config ];
          };
        };
    };
}
