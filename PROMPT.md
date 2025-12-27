# Prompt: Zcash Shielded Transaction Viewer - Milestone 1

Build a web application called "Zcash Shielded Transaction Viewer" that allows users to view shielded transaction details using their viewing key. Decryption happens entirely client-side using the official Zcash Rust libraries compiled to WebAssembly.

## Requirements

### Frontend

- Simple, clean web interface using Bootstrap 5 (latest version)
- Two input fields:
  1. **Viewing Key** - text input for the user's Zcash viewing key (supports Sapling/Orchard unified viewing keys)
  2. **Transaction Hash (txid)** - text input for the transaction ID to inspect
- A "Decode Transaction" submit button
- A results panel to display the decoded transaction information
- Basic input validation and error handling with user-friendly messages
- Loads the WASM module for client-side decryption
- Clear documentation about privacy guarantees (viewing key never leaves the browser)

### WebAssembly Module (Rust)

- Use the official Zcash Rust crates from the `zcash` organization:
  - `zcash_primitives` - transaction parsing and structures
  - `zcash_client_backend` - viewing key handling and decryption
  - `orchard` - Orchard protocol support
  - `sapling-crypto` - Sapling protocol support
- Compile to WebAssembly using `wasm-pack` with `wasm-bindgen`
- Use the latest nightly version of Rust (edition 2024) for compilation
- Expose functions to JavaScript:
  - `parse_viewing_key(key: &str)` - validate and parse viewing key
  - `decrypt_transaction(raw_tx: &[u8], viewing_key: &str)` - decrypt shielded outputs
- Return decoded transaction details: value, memo, nullifiers, note commitments

### Backend

- Minimal REST API (or direct client-side fetch to public node)
- Endpoint to fetch raw transaction data given a txid
- Connects to a Zcash full node via JSON-RPC (zcashd) using `getrawtransaction`
- Returns raw transaction bytes to the frontend for WASM decryption

### Tech Stack

- WASM module: Rust (nightly, edition 2024) + wasm-pack + wasm-bindgen
- Backend: Python (FastAPI) with Poetry for dependency management
- Frontend: HTML + Bootstrap 5 + vanilla JS
- Python linting/formatting: Ruff
- JS/HTML formatting: Prettier

### Build & Development

- All build and deployment commands in a Makefile with self-documenting help
- `.PHONY` declarations right before each target
- Prettier for JavaScript/HTML/CSS formatting and linting
- Ruff for Python formatting and linting
- Rust nightly toolchain with rustfmt and clippy

### CI/CD

- GitHub Actions workflow for CI (build, lint, test all components)
- Dependabot configuration for:
  - Cargo (Rust dependencies)
  - pip/Poetry (Python dependencies)
  - npm (JavaScript dependencies)
  - GitHub Actions

### Architecture

```
User Browser                    Backend                 Zcash Node
    │                              │                        │
    │  1. Submit txid              │                        │
    ├─────────────────────────────►│  2. getrawtransaction  │
    │                              ├───────────────────────►│
    │                              │  3. raw tx bytes       │
    │  4. raw tx bytes             │◄───────────────────────┤
    │◄─────────────────────────────┤                        │
    │                              │                        │
    │  5. WASM decrypts locally    │                        │
    │     using viewing key        │                        │
    │     (key never leaves        │                        │
    │      the browser)            │                        │
```

### Security Advantages

- Viewing key never leaves the user's browser
- Decryption happens entirely client-side
- Backend never sees sensitive key material
- No trust required in the server for key handling

### Configuration

- Environment variables for Zcash node connection (host, port, rpcuser, rpcpassword)
- Support for both mainnet and testnet

### Out of scope for Milestone 1

- User authentication
- Transaction history/scanning
- Database persistence
- Multiple transaction lookup
- Trial decryption across blocks
