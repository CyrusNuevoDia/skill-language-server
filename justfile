set shell := ["bash", "-cu"]

default: build

# Build everything into dist/: server artifacts, VS Code .vsix, Zed wasm
build: build-server build-vscode build-zed

# Server artifacts: standalone binary (Zed/any stdio client) + node bundle (npm bin)
build-server:
    mkdir -p dist
    bun build --compile --outfile=dist/skill-language-server src/main.ts
    bun build --target=node --format=cjs --banner='#!/usr/bin/env node' --outfile=dist/main.cjs src/main.ts

# VS Code extension: bundle server + client, package as .vsix (version mirrors the root package)
build-vscode:
    mkdir -p dist ext/vscode/dist
    jq --arg v "$(jq -r .version package.json)" '.version = $v' ext/vscode/package.json > ext/vscode/package.json.tmp
    mv ext/vscode/package.json.tmp ext/vscode/package.json
    bun build --target=node --format=cjs --outfile=ext/vscode/dist/server.js src/main.ts
    cd ext/vscode && bun install
    cd ext/vscode && bun build --target=node --format=cjs --external=vscode --outfile=dist/extension.js src/extension.ts
    cd ext/vscode && bunx @vscode/vsce package --no-dependencies --out ../../dist/skill-language-server.vsix

# Publish the .vsix to Open VSX — Cursor, Antigravity, VSCodium, Windsurf. Needs $OVSX_PAT
publish-openvsx: build-vscode
    cd ext/vscode && bunx ovsx publish ../../dist/skill-language-server.vsix

# Publish the .vsix to the VS Code Marketplace. Needs $VSCE_PAT
publish-vscode: build-vscode
    cd ext/vscode && bunx @vscode/vsce publish --packagePath ../../dist/skill-language-server.vsix

# Zed extension wasm (Zed rebuilds dev extensions itself; this verifies + copies)
build-zed:
    mkdir -p dist
    cd ext/zed && cargo build --release --target wasm32-wasip2
    cp ext/zed/target/wasm32-wasip2/release/zed_skill_language_server.wasm dist/

# Build and install the server binary to ~/.local/bin (used by Zed).
# rm first: overwriting a signed macOS binary in place trips the kernel's
# signature cache and the new binary gets SIGKILLed on launch.
bin: build-server
    mkdir -p ~/.local/bin
    rm -f ~/.local/bin/skill-language-server
    cp dist/skill-language-server ~/.local/bin/skill-language-server

test:
    bun test --parallel

bench:
    bun scripts/benchmark.ts

# Typecheck (server + tests, VS Code extension), lint, and run the test suite
check: && test
    bunx tsc --noEmit
    bunx tsc --noEmit -p ext/vscode
    bunx ultracite check

# Format + apply all lint fixes, including unsafe ones
fmt:
    bunx ultracite fix --unsafe

# Declare a release: pick a bump type and write the changeset
changeset:
    bunx changeset
