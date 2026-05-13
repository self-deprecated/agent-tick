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

          agent-tick-cli = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-cli";
            version = "0.1.4";
            inherit src;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              fetcherVersion = 2;
              hash = "sha256-+y+K5ws7cYJEV2ZWRmFCdu76Nj7VMalRZBEInl2XUv0=";
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              pkgs.pnpmConfigHook
              pkgs.makeWrapper
            ];

            dontCheckForBrokenSymlinks = true;

            buildPhase = ''
              runHook preBuild

              pnpm --filter @self-deprecated/agent-tick build

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p "$out/lib/agent-tick-cli/node_modules" "$out/bin"
              cp packages/cli/package.json "$out/lib/agent-tick-cli/"
              cp -R packages/cli/dist "$out/lib/agent-tick-cli/"
              cp -RL packages/cli/node_modules/commander "$out/lib/agent-tick-cli/node_modules/commander"

              makeWrapper ${nodejs}/bin/node "$out/bin/agent-tick" \
                --add-flags "$out/lib/agent-tick-cli/dist/index.js"

              runHook postInstall
            '';

            meta = {
              description = "Human-in-the-loop approval CLI for Agent Tick";
              homepage = "https://agenttick.sh";
              mainProgram = "agent-tick";
              platforms = lib.platforms.linux;
            };
          });

          agent-tick-diagnostics-mcp = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-diagnostics-mcp";
            version = "0.1.0";
            inherit src;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              fetcherVersion = 2;
              hash = "sha256-+y+K5ws7cYJEV2ZWRmFCdu76Nj7VMalRZBEInl2XUv0=";
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
              pnpm --filter @agent-tick/db build
              pnpm --filter @agent-tick/diagnostics-mcp build

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

              makeWrapper ${nodejs}/bin/node "$out/bin/agent-tick-diagnostics-mcp" \
                --add-flags "$out/lib/agent-tick/apps/diagnostics-mcp/dist/index.js"

              runHook postInstall
            '';

            meta = {
              description = "Local MCP server for Agent Tick diagnostics";
              homepage = "https://agenttick.sh";
              mainProgram = "agent-tick-diagnostics-mcp";
              platforms = lib.platforms.linux;
            };
          });

          agent-tick-server = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-server";
            version = "0.1.0";
            inherit src;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              fetcherVersion = 2;
              hash = "sha256-+y+K5ws7cYJEV2ZWRmFCdu76Nj7VMalRZBEInl2XUv0=";
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
            inherit agent-tick-cli agent-tick-server agent-tick-diagnostics-mcp;
            agent-tick = agent-tick-cli;
            default = agent-tick-server;
          };

          apps = {
            agent-tick = {
              type = "app";
              program = "${agent-tick-cli}/bin/agent-tick";
              meta.description = "Run the Agent Tick CLI";
            };

            default = {
              type = "app";
              program = "${agent-tick-server}/bin/agent-tick-server";
              meta.description = "Run the Agent Tick server";
            };
          };

          devShells.default = pkgs.mkShell {
            packages = [ nodejs pnpm pkgs.sqlite pkgs.python3 pkgs.pkg-config ];
          };
        };
    };
}
