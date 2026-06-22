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
          pnpm = pkgs.pnpm_10_29_2;
          pnpmDepsHash = "sha256-Ug+a/jyRGlZjIeQgVmnTAUsbznGZ42veHoSxYnak/ls=";

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
                  ".local-tools"
                  ".venv"
                  "dist"
                  "result"
                ]);
          };


          agent-tick-cli = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-cli";
            version = "1.4.0";
            inherit src;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              inherit pnpm;
              fetcherVersion = 3;
              hash = pnpmDepsHash;
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

          agent-tick-docs-node-modules = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-docs-node-modules";
            version = "1.4.0";
            inherit src;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              inherit pnpm;
              fetcherVersion = 3;
              hash = pnpmDepsHash;
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              pkgs.pnpmConfigHook
            ];

            dontCheckForBrokenSymlinks = true;

            installPhase = ''
              runHook preInstall

              mkdir -p "$out"
              cp -R package.json pnpm-workspace.yaml node_modules apps packages sites "$out/"

              runHook postInstall
            '';

            meta = {
              description = "Cached Agent Tick docs pnpm workspace node_modules";
              homepage = "https://docs.agenttick.sh";
              platforms = lib.platforms.linux;
            };
          });

          agent-tick-docs = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-docs";
            version = "1.4.0";
            inherit src;

            nativeBuildInputs = [
              nodejs
              pnpm
            ];

            buildPhase = ''
              runHook preBuild

              materializeNodeModules() {
                local sourceDir="$1"
                local targetDir="$2"

                mkdir -p "$targetDir"

                local entry base scopedEntry scopedBase
                for entry in "$sourceDir"/* "$sourceDir"/.[!.]* "$sourceDir"/..?*; do
                  [ -e "$entry" ] || [ -L "$entry" ] || continue
                  base="$(basename "$entry")"

                  if [ -L "$entry" ]; then
                    cp -P "$entry" "$targetDir/$base"
                  elif [ -d "$entry" ] && [[ "$base" == .cache || "$base" == .vite || "$base" == .vite-temp ]]; then
                    mkdir -p "$targetDir/$base"
                  elif [ -d "$entry" ] && [[ "$base" == @* ]]; then
                    mkdir -p "$targetDir/$base"
                    for scopedEntry in "$entry"/*; do
                      [ -e "$scopedEntry" ] || [ -L "$scopedEntry" ] || continue
                      scopedBase="$(basename "$scopedEntry")"
                      if [ -L "$scopedEntry" ]; then
                        cp -P "$scopedEntry" "$targetDir/$base/$scopedBase"
                      else
                        ln -s "$scopedEntry" "$targetDir/$base/$scopedBase"
                      fi
                    done
                  else
                    ln -s "$entry" "$targetDir/$base"
                  fi
                done
              }

              while IFS= read -r nodeModulesPath; do
                relPath="''${nodeModulesPath#${agent-tick-docs-node-modules}/}"
                materializeNodeModules "$nodeModulesPath" "$relPath"
              done < <(find ${agent-tick-docs-node-modules} -type d -name node_modules -prune -print | sort)

              export HOME="$TMPDIR"
              export XDG_CACHE_HOME="$TMPDIR/.cache"
              export XDG_DATA_HOME="$TMPDIR/.local/share"
              export npm_config_manage_package_manager_versions=false
              export npm_config_package_manager_strict=false

              pnpm \
                --config.manage-package-manager-versions=false \
                --config.package-manager-strict=false \
                --filter agent-tick-docs \
                build

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              cp -R sites/docs/build "$out"

              remainingSymlinks=$(find "$out" -type l -print)
              if [ -n "$remainingSymlinks" ]; then
                echo "agent-tick-docs output contains symlinks:" >&2
                printf '%s\n' "$remainingSymlinks" >&2
                exit 1
              fi

              runHook postInstall
            '';

            meta = {
              description = "Static Docusaurus documentation site for Agent Tick";
              homepage = "https://docs.agenttick.sh";
              platforms = lib.platforms.linux;
            };
          });

          agent-tick-server-node-modules = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-server-node-modules";
            version = "1.4.0";
            inherit src;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) pname version src;
              inherit pnpm;
              fetcherVersion = 3;
              hash = pnpmDepsHash;
            };

            nativeBuildInputs = [
              nodejs
              pnpm
              pkgs.pnpmConfigHook
              pkgs.python3
              pkgs.pkg-config
              pkgs.node-gyp
            ];

            buildInputs = [ pkgs.sqlite ];

            dontCheckForBrokenSymlinks = true;

            buildPhase = ''
              runHook preBuild

              export npm_config_build_from_source=true
              export npm_config_nodedir=${nodejs}
              (cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npm run build-release)

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p "$out"
              cp -R package.json pnpm-workspace.yaml node_modules apps packages sites "$out/"

              runHook postInstall
            '';

            meta = {
              description = "Cached Agent Tick server pnpm workspace node_modules";
              homepage = "https://agenttick.sh";
              platforms = lib.platforms.linux;
            };
          });

          agent-tick-server = pkgs.stdenv.mkDerivation (finalAttrs: {
            pname = "agent-tick-server";
            version = "1.4.0";
            inherit src;

            nativeBuildInputs = [
              nodejs
              pnpm
              pkgs.makeWrapper
            ];

            dontCheckForBrokenSymlinks = true;

            buildPhase = ''
              runHook preBuild

              materializeNodeModules() {
                local sourceDir="$1"
                local targetDir="$2"

                mkdir -p "$targetDir"

                local entry base scopedEntry scopedBase
                for entry in "$sourceDir"/* "$sourceDir"/.[!.]* "$sourceDir"/..?*; do
                  [ -e "$entry" ] || [ -L "$entry" ] || continue
                  base="$(basename "$entry")"

                  if [ -L "$entry" ]; then
                    cp -P "$entry" "$targetDir/$base"
                  elif [ -d "$entry" ] && [[ "$base" == .vite || "$base" == .vite-temp ]]; then
                    mkdir -p "$targetDir/$base"
                  elif [ -d "$entry" ] && [[ "$base" == @* ]]; then
                    mkdir -p "$targetDir/$base"
                    for scopedEntry in "$entry"/*; do
                      [ -e "$scopedEntry" ] || [ -L "$scopedEntry" ] || continue
                      scopedBase="$(basename "$scopedEntry")"
                      if [ -L "$scopedEntry" ]; then
                        cp -P "$scopedEntry" "$targetDir/$base/$scopedBase"
                      else
                        ln -s "$scopedEntry" "$targetDir/$base/$scopedBase"
                      fi
                    done
                  else
                    ln -s "$entry" "$targetDir/$base"
                  fi
                done
              }

              while IFS= read -r nodeModulesPath; do
                relPath="''${nodeModulesPath#${agent-tick-server-node-modules}/}"
                materializeNodeModules "$nodeModulesPath" "$relPath"
              done < <(find ${agent-tick-server-node-modules} -type d -name node_modules -prune -print | sort)

              export HOME="$TMPDIR"
              export XDG_CACHE_HOME="$TMPDIR/.cache"
              export XDG_DATA_HOME="$TMPDIR/.local/share"
              export npm_config_manage_package_manager_versions=false
              export npm_config_package_manager_strict=false

              pnpmBuild() {
                pnpm \
                  --config.manage-package-manager-versions=false \
                  --config.package-manager-strict=false \
                  --filter "$1" \
                  build
              }

              pnpmBuild @self-deprecated/agent-tick-shared
              pnpmBuild @self-deprecated/agent-tick-sdk
              pnpmBuild @agent-tick/db
              pnpmBuild @agent-tick/server
              pnpmBuild agent-tick-admin

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

              if [ -d "$out/lib/agent-tick/apps/server/public" ]; then
                remainingPublicSymlinks=$(find "$out/lib/agent-tick/apps/server/public" -type l -print)
                if [ -n "$remainingPublicSymlinks" ]; then
                  echo "agent-tick-server public assets contain symlinks:" >&2
                  printf '%s\n' "$remainingPublicSymlinks" >&2
                  exit 1
                fi
              fi

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
            inherit agent-tick-cli agent-tick-server agent-tick-server-node-modules agent-tick-docs agent-tick-docs-node-modules;
            agent-tick = agent-tick-cli;
            docs = agent-tick-docs;
            default = agent-tick-server;
          };

          apps = {
            agent-tick = {
              type = "app";
              program = "${agent-tick-cli}/bin/agent-tick";
              meta.description = "Run the Agent Tick CLI";
            };

            update-pnpm-deps-hash = {
              type = "app";
              program = lib.getExe (pkgs.writeShellApplication {
                name = "update-pnpm-deps-hash";
                runtimeInputs = [ pkgs.nix pkgs.python3 ];
                text = builtins.readFile ./scripts/update-pnpm-deps-hash;
              });
              meta.description = "Refresh the shared fetchPnpmDeps hash in flake.nix";
            };

            check-pnpm-deps-hash = {
              type = "app";
              program = lib.getExe (pkgs.writeShellApplication {
                name = "check-pnpm-deps-hash";
                runtimeInputs = [ pkgs.nix pkgs.python3 ];
                text = ''
                  exec ${./scripts/update-pnpm-deps-hash} --check "$@"
                '';
              });
              meta.description = "Check that the shared fetchPnpmDeps hash matches pnpm-lock.yaml";
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
