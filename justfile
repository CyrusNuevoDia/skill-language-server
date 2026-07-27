set shell := ["bash", "-cu"]

default: build

# Build everything into dist/: server binary, VS Code .vsix, Zed wasm, npm bin
build: build-server build-vscode build-zed build-npm

# Node-runnable bundle with shebang — what `npx skill-lsp` executes
build-npm:
    bun run build:npm

# Standalone server binary (used by Zed and any stdio client)
build-server:
    mkdir -p dist
    bun build --compile --outfile=dist/skill-lsp src/main.ts

# VS Code extension: bundle server + client, package as .vsix
build-vscode:
    mkdir -p dist ext/vscode/dist
    bun build --target=node --format=cjs --outfile=ext/vscode/dist/server.js src/main.ts
    cd ext/vscode && bun install
    cd ext/vscode && bun build --target=node --format=cjs --external=vscode --outfile=dist/extension.js src/extension.ts
    cd ext/vscode && bunx @vscode/vsce package --no-dependencies --out ../../dist/skill-lsp.vsix

# Zed extension wasm (Zed rebuilds dev extensions itself; this verifies + copies)
build-zed:
    mkdir -p dist
    cd ext/zed && cargo build --release --target wasm32-wasip2
    cp ext/zed/target/wasm32-wasip2/release/zed_skill_lsp.wasm dist/

# Build and install the server binary to ~/.local/bin (used by Zed).
# rm first: overwriting a signed macOS binary in place trips the kernel's
# signature cache and the new binary gets SIGKILLed on launch.
bin: build-server
    mkdir -p ~/.local/bin
    rm -f ~/.local/bin/skill-lsp
    cp dist/skill-lsp ~/.local/bin/skill-lsp

test:
    bun test

# Typecheck (server + tests, VS Code extension) and lint
check:
    bunx tsc --noEmit
    bunx tsc --noEmit -p ext/vscode
    bunx ultracite check

# Format + apply all lint fixes, including unsafe ones
fmt:
    bunx ultracite fix --unsafe
