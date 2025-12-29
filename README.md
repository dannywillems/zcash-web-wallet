# Zcash Shielded Transaction Viewer

A privacy-preserving tool for viewing Zcash shielded transaction details using viewing keys. All decryption happens client-side - your viewing keys never leave your browser.

## Features

- **Web Interface**: View shielded transaction details directly in your browser
- **CLI Tool**: Generate testnet wallets and track notes/balances locally
- **Privacy First**: Viewing keys stay local - no server-side processing
- **Orchard Support**: Full trial decryption for Orchard shielded pools

## Quick Start

### Web Interface

```bash
make install    # Install dependencies
make build      # Build WASM module and Sass
make serve      # Serve on http://localhost:3000
```

### CLI Tool

```bash
make build-cli  # Build the CLI

# Generate a new testnet wallet
./target/release/zcash-wallet generate --output wallet.json

# Restore from seed phrase
./target/release/zcash-wallet restore --seed "your 24 words here" --output wallet.json

# Get testnet faucet instructions
./target/release/zcash-wallet faucet
```

## Development

```bash
make test       # Run all tests (Rust + e2e)
make lint       # Lint all code (clippy, prettier, shellcheck)
make format     # Format all code
make help       # Show all available commands
```

## Architecture

```
Browser                              Zcash Node
   |                                     |
   |  1. User enters txid + viewing key  |
   |  2. Fetch raw tx via RPC            |
   |------------------------------------>|
   |  3. Raw transaction hex             |
   |<------------------------------------|
   |  4. WASM decrypts locally           |
   |     (keys never leave browser)      |
```

## Project Structure

- `wasm-module/` - Rust WASM library for transaction decryption
- `cli/` - Command-line wallet and note tracking tool
- `frontend/` - Web interface (Bootstrap + vanilla JS)

## License

MIT
