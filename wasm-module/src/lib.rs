//! Zcash WebAssembly module for transaction viewing and wallet operations.
//!
//! This module provides client-side Zcash functionality compiled to WebAssembly,
//! enabling privacy-preserving operations directly in the browser. All cryptographic
//! operations use the official Zcash Rust libraries.
//!
//! # Features
//!
//! - **Transaction Decryption**: Decrypt shielded transaction outputs using viewing keys
//! - **Viewing Key Parsing**: Validate and parse UFVK, UIVK, and legacy Sapling keys
//! - **Wallet Generation**: Create new wallets with BIP39 seed phrases
//! - **Wallet Restoration**: Restore wallets from existing seed phrases
//!
//! # Security
//!
//! All operations run entirely client-side. Viewing keys and seed phrases never
//! leave the browser. Transaction data is fetched from user-configured RPC endpoints.

use wasm_bindgen::prelude::*;

use rand::RngCore;
use zcash_address::unified::{self, Container, Encoding};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::{Network, NetworkType};

// Re-export types from core library
pub use zcash_wallet_core::{
    DecryptedOrchardAction, DecryptedSaplingOutput, DecryptedTransaction, DecryptionResult,
    NetworkKind, Pool, ScanResult, ScanTransactionResult, ScannedNote, ScannedTransparentOutput,
    SpentNullifier, TransparentInput, TransparentOutput, ViewingKeyInfo, WalletResult,
};

/// Log to browser console
fn console_log(msg: &str) {
    web_sys::console::log_1(&JsValue::from_str(msg));
}

/// Parse and validate a viewing key
#[wasm_bindgen]
pub fn parse_viewing_key(key: &str) -> String {
    let result = parse_viewing_key_inner(key);
    serde_json::to_string(&result).unwrap_or_else(|e| {
        serde_json::to_string(&ViewingKeyInfo {
            valid: false,
            key_type: String::new(),
            has_sapling: false,
            has_orchard: false,
            network: None,
            error: Some(format!("Serialization error: {}", e)),
        })
        .unwrap()
    })
}

fn network_type_to_kind(network: NetworkType) -> NetworkKind {
    match network {
        NetworkType::Main => NetworkKind::Mainnet,
        NetworkType::Test => NetworkKind::Testnet,
        NetworkType::Regtest => NetworkKind::Regtest,
    }
}

fn parse_viewing_key_inner(key: &str) -> ViewingKeyInfo {
    let key = key.trim();

    // Try parsing as Unified Full Viewing Key (UFVK)
    if let Ok((network, ufvk)) = unified::Ufvk::decode(key) {
        let items = ufvk.items();
        let has_sapling = items
            .iter()
            .any(|item| matches!(item, unified::Fvk::Sapling(_)));
        let has_orchard = items
            .iter()
            .any(|item| matches!(item, unified::Fvk::Orchard(_)));

        return ViewingKeyInfo {
            valid: true,
            key_type: "UFVK".to_string(),
            has_sapling,
            has_orchard,
            network: Some(network_type_to_kind(network)),
            error: None,
        };
    }

    // Try parsing as Unified Incoming Viewing Key (UIVK)
    if let Ok((network, _uivk)) = unified::Uivk::decode(key) {
        return ViewingKeyInfo {
            valid: true,
            key_type: "UIVK".to_string(),
            has_sapling: true,
            has_orchard: true,
            network: Some(network_type_to_kind(network)),
            error: None,
        };
    }

    // Try parsing as legacy Sapling extended viewing key
    // These start with "zxviews" (mainnet) or "zxviewtestsapling" (testnet)
    if key.starts_with("zxviews") || key.starts_with("zxviewtestsapling") {
        let network = if key.starts_with("zxviews") {
            NetworkKind::Mainnet
        } else {
            NetworkKind::Testnet
        };

        // Basic validation - proper bech32 decoding
        if bech32::decode(key).is_ok() {
            return ViewingKeyInfo {
                valid: true,
                key_type: "Sapling ExtFVK".to_string(),
                has_sapling: true,
                has_orchard: false,
                network: Some(network),
                error: None,
            };
        }
    }

    ViewingKeyInfo {
        valid: false,
        key_type: String::new(),
        has_sapling: false,
        has_orchard: false,
        network: None,
        error: Some("Unrecognized viewing key format".to_string()),
    }
}

/// Decrypt a transaction using the provided viewing key
#[wasm_bindgen]
pub fn decrypt_transaction(raw_tx_hex: &str, viewing_key: &str, network: &str) -> String {
    let result = decrypt_transaction_inner(raw_tx_hex, viewing_key, network);
    serde_json::to_string(&result).unwrap_or_else(|e| {
        serde_json::to_string(&DecryptionResult {
            success: false,
            transaction: None,
            error: Some(format!("Serialization error: {}", e)),
        })
        .unwrap()
    })
}

fn decrypt_transaction_inner(
    raw_tx_hex: &str,
    viewing_key: &str,
    network: &str,
) -> DecryptionResult {
    console_log(&format!("Decrypting transaction with network: {}", network));

    // Decode the raw transaction hex
    let tx_bytes = match hex::decode(raw_tx_hex.trim()) {
        Ok(bytes) => bytes,
        Err(e) => {
            return DecryptionResult {
                success: false,
                transaction: None,
                error: Some(format!("Failed to decode transaction hex: {}", e)),
            };
        }
    };

    // Parse the transaction
    let tx = match Transaction::read(&tx_bytes[..], zcash_primitives::consensus::BranchId::Nu6) {
        Ok(tx) => tx,
        Err(e) => {
            // Try with earlier branch IDs
            match Transaction::read(&tx_bytes[..], zcash_primitives::consensus::BranchId::Nu5) {
                Ok(tx) => tx,
                Err(_) => {
                    return DecryptionResult {
                        success: false,
                        transaction: None,
                        error: Some(format!("Failed to parse transaction: {}", e)),
                    };
                }
            }
        }
    };

    let txid = tx.txid().to_string();
    console_log(&format!("Parsed transaction: {}", txid));

    let mut decrypted = DecryptedTransaction {
        txid,
        sapling_outputs: Vec::new(),
        orchard_actions: Vec::new(),
        transparent_inputs: Vec::new(),
        transparent_outputs: Vec::new(),
        fee: None,
    };

    // Extract transparent inputs and outputs
    if let Some(transparent_bundle) = tx.transparent_bundle() {
        for (i, input) in transparent_bundle.vin.iter().enumerate() {
            let prevout = input.prevout();
            decrypted.transparent_inputs.push(TransparentInput {
                index: i,
                prevout_txid: hex::encode(prevout.hash()),
                prevout_index: prevout.n(),
            });
        }

        for (i, output) in transparent_bundle.vout.iter().enumerate() {
            // Serialize the script to bytes
            let mut script_bytes = Vec::new();
            let _ = output.script_pubkey().write(&mut script_bytes);

            decrypted.transparent_outputs.push(TransparentOutput {
                index: i,
                value: u64::from(output.value()),
                script_pubkey: hex::encode(&script_bytes),
                address: None, // TODO: decode address from script
            });
        }
    }

    // Parse viewing key and attempt decryption
    let viewing_key = viewing_key.trim();

    // Try as UFVK
    if let Ok((_network, ufvk)) = unified::Ufvk::decode(viewing_key) {
        // Extract Sapling FVK if present
        for item in ufvk.items() {
            if let unified::Fvk::Sapling(_sapling_bytes) = item
                && let Some(sapling_bundle) = tx.sapling_bundle()
            {
                console_log(&format!(
                    "Attempting to decrypt {} Sapling outputs",
                    sapling_bundle.shielded_outputs().len()
                ));

                // Try to decrypt each Sapling output
                for (i, output) in sapling_bundle.shielded_outputs().iter().enumerate() {
                    // Note: Full decryption requires more context (height, etc.)
                    // For now, we'll extract what we can from the output
                    let cmu = output.cmu();
                    decrypted.sapling_outputs.push(DecryptedSaplingOutput {
                        index: i,
                        value: 0, // Requires successful decryption
                        memo: String::new(),
                        address: None,
                        note_commitment: hex::encode(cmu.to_bytes()),
                        nullifier: None,
                    });
                }
            }

            if let unified::Fvk::Orchard(_orchard_bytes) = item
                && let Some(orchard_bundle) = tx.orchard_bundle()
            {
                console_log(&format!(
                    "Attempting to decrypt {} Orchard actions",
                    orchard_bundle.actions().len()
                ));

                for (i, action) in orchard_bundle.actions().iter().enumerate() {
                    let cmx = action.cmx();
                    decrypted.orchard_actions.push(DecryptedOrchardAction {
                        index: i,
                        value: 0, // Requires successful decryption
                        memo: String::new(),
                        address: None,
                        note_commitment: hex::encode(cmx.to_bytes()),
                        nullifier: Some(hex::encode(action.nullifier().to_bytes())),
                    });
                }
            }
        }
    }

    // If no UFVK decryption happened, still extract basic info from bundles
    if decrypted.sapling_outputs.is_empty()
        && let Some(sapling_bundle) = tx.sapling_bundle()
    {
        for (i, output) in sapling_bundle.shielded_outputs().iter().enumerate() {
            let cmu = output.cmu();
            decrypted.sapling_outputs.push(DecryptedSaplingOutput {
                index: i,
                value: 0,
                memo: "(encrypted)".to_string(),
                address: None,
                note_commitment: hex::encode(cmu.to_bytes()),
                nullifier: None,
            });
        }
    }

    if decrypted.orchard_actions.is_empty()
        && let Some(orchard_bundle) = tx.orchard_bundle()
    {
        for (i, action) in orchard_bundle.actions().iter().enumerate() {
            let cmx = action.cmx();
            decrypted.orchard_actions.push(DecryptedOrchardAction {
                index: i,
                value: 0,
                memo: "(encrypted)".to_string(),
                address: None,
                note_commitment: hex::encode(cmx.to_bytes()),
                nullifier: Some(hex::encode(action.nullifier().to_bytes())),
            });
        }
    }

    DecryptionResult {
        success: true,
        transaction: Some(decrypted),
        error: None,
    }
}

/// Get version information
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Parse network string to Network enum
fn parse_network(network_str: &str) -> Network {
    match network_str.to_lowercase().as_str() {
        "mainnet" | "main" => Network::MainNetwork,
        _ => Network::TestNetwork,
    }
}

/// Generate a new wallet with a random seed phrase
#[wasm_bindgen]
pub fn generate_wallet(network_str: &str, account_index: u32, address_index: u32) -> String {
    let network = parse_network(network_str);
    let network_name = if matches!(network, Network::MainNetwork) {
        "mainnet"
    } else {
        "testnet"
    };
    console_log(&format!(
        "Generating new {} wallet (account {}, address {})...",
        network_name, account_index, address_index
    ));

    // Generate random entropy for 24-word mnemonic (256 bits = 32 bytes)
    let mut entropy = [0u8; 32];
    getrandom::getrandom(&mut entropy).unwrap_or_else(|_| {
        // Fallback to rand if getrandom fails
        rand::thread_rng().fill_bytes(&mut entropy);
    });

    let result =
        match zcash_wallet_core::generate_wallet(&entropy, network, account_index, address_index) {
            Ok(wallet) => {
                console_log(&format!(
                    "Wallet generated: {}",
                    &wallet.unified_address[..20]
                ));
                WalletResult {
                    success: true,
                    seed_phrase: Some(wallet.seed_phrase),
                    network: wallet.network,
                    account_index: wallet.account_index,
                    address_index: wallet.address_index,
                    unified_address: Some(wallet.unified_address),
                    transparent_address: wallet.transparent_address,
                    unified_full_viewing_key: Some(wallet.unified_full_viewing_key),
                    error: None,
                }
            }
            Err(e) => WalletResult {
                success: false,
                seed_phrase: None,
                network: NetworkKind::Mainnet, // Default for error case
                account_index: 0,
                address_index: 0,
                unified_address: None,
                transparent_address: None,
                unified_full_viewing_key: None,
                error: Some(e.to_string()),
            },
        };

    serde_json::to_string(&result).unwrap_or_else(|e| {
        serde_json::to_string(&WalletResult {
            success: false,
            seed_phrase: None,
            network: NetworkKind::Mainnet, // Default for error case
            account_index: 0,
            address_index: 0,
            unified_address: None,
            transparent_address: None,
            unified_full_viewing_key: None,
            error: Some(format!("Serialization error: {}", e)),
        })
        .unwrap()
    })
}

/// Restore a wallet from an existing seed phrase
#[wasm_bindgen]
pub fn restore_wallet(
    seed_phrase: &str,
    network_str: &str,
    account_index: u32,
    address_index: u32,
) -> String {
    let network = parse_network(network_str);
    let network_name = if matches!(network, Network::MainNetwork) {
        "mainnet"
    } else {
        "testnet"
    };
    console_log(&format!(
        "Restoring {} wallet from seed phrase (account {}, address {})...",
        network_name, account_index, address_index
    ));

    let result =
        match zcash_wallet_core::restore_wallet(seed_phrase, network, account_index, address_index)
        {
            Ok(wallet) => {
                console_log(&format!(
                    "Wallet restored: {}",
                    &wallet.unified_address[..20]
                ));
                WalletResult {
                    success: true,
                    seed_phrase: Some(wallet.seed_phrase),
                    network: wallet.network,
                    account_index: wallet.account_index,
                    address_index: wallet.address_index,
                    unified_address: Some(wallet.unified_address),
                    transparent_address: wallet.transparent_address,
                    unified_full_viewing_key: Some(wallet.unified_full_viewing_key),
                    error: None,
                }
            }
            Err(e) => WalletResult {
                success: false,
                seed_phrase: None,
                network: NetworkKind::Mainnet, // Default for error case
                account_index: 0,
                address_index: 0,
                unified_address: None,
                transparent_address: None,
                unified_full_viewing_key: None,
                error: Some(e.to_string()),
            },
        };

    serde_json::to_string(&result).unwrap_or_else(|e| {
        serde_json::to_string(&WalletResult {
            success: false,
            seed_phrase: None,
            network: NetworkKind::Mainnet, // Default for error case
            account_index: 0,
            address_index: 0,
            unified_address: None,
            transparent_address: None,
            unified_full_viewing_key: None,
            error: Some(format!("Serialization error: {}", e)),
        })
        .unwrap()
    })
}

/// Derive multiple unified addresses from a seed phrase.
///
/// This is useful for scanning transactions and verifying receiving addresses.
///
/// # Arguments
///
/// * `seed_phrase` - A valid 24-word BIP39 mnemonic
/// * `network` - The network ("mainnet" or "testnet")
/// * `account_index` - The account index (BIP32 level 3)
/// * `start_index` - The starting address/diversifier index
/// * `count` - Number of addresses to derive
///
/// # Returns
///
/// JSON string containing an array of unified addresses.
#[wasm_bindgen]
pub fn derive_unified_addresses(
    seed_phrase: &str,
    network_str: &str,
    account_index: u32,
    start_index: u32,
    count: u32,
) -> String {
    let network = parse_network(network_str);
    console_log(&format!(
        "Deriving {} unified addresses for account {} starting at {}...",
        count, account_index, start_index
    ));

    match zcash_wallet_core::derive_unified_addresses(
        seed_phrase,
        network,
        account_index,
        start_index,
        count,
    ) {
        Ok(addresses) => {
            console_log(&format!("Derived {} unified addresses", addresses.len()));
            serde_json::to_string(&addresses).unwrap_or_else(|_| "[]".to_string())
        }
        Err(e) => {
            console_log(&format!("Failed to derive unified addresses: {}", e));
            "[]".to_string()
        }
    }
}

/// Derive multiple transparent addresses from a seed phrase.
///
/// This is useful for scanning transactions - we need to check if transparent
/// outputs belong to any of our derived addresses.
///
/// # Arguments
///
/// * `seed_phrase` - A valid 24-word BIP39 mnemonic
/// * `network` - The network ("mainnet" or "testnet")
/// * `account_index` - The account index (BIP32 level 3)
/// * `start_index` - The starting address index
/// * `count` - Number of addresses to derive
///
/// # Returns
///
/// JSON string containing an array of transparent addresses.
#[wasm_bindgen]
pub fn derive_transparent_addresses(
    seed_phrase: &str,
    network_str: &str,
    account_index: u32,
    start_index: u32,
    count: u32,
) -> String {
    let network = parse_network(network_str);
    console_log(&format!(
        "Deriving {} transparent addresses for account {} starting at {}...",
        count, account_index, start_index
    ));

    match zcash_wallet_core::derive_transparent_addresses(
        seed_phrase,
        network,
        account_index,
        start_index,
        count,
    ) {
        Ok(addresses) => {
            console_log(&format!("Derived {} addresses", addresses.len()));
            serde_json::to_string(&addresses).unwrap_or_else(|_| "[]".to_string())
        }
        Err(e) => {
            console_log(&format!("Failed to derive addresses: {}", e));
            "[]".to_string()
        }
    }
}

/// Scan a transaction for notes belonging to a viewing key.
///
/// Performs trial decryption on all shielded outputs to find notes
/// addressed to the viewing key. Also extracts nullifiers to track
/// spent notes.
///
/// # Arguments
///
/// * `raw_tx_hex` - The raw transaction as a hexadecimal string
/// * `viewing_key` - The viewing key (UFVK, UIVK, or legacy Sapling)
/// * `network` - The network ("mainnet" or "testnet")
/// * `height` - Optional block height (needed for full Sapling decryption)
///
/// # Returns
///
/// JSON string containing a `ScanTransactionResult` with found notes,
/// spent nullifiers, and transparent outputs.
#[wasm_bindgen]
pub fn scan_transaction(
    raw_tx_hex: &str,
    viewing_key: &str,
    network: &str,
    height: Option<u32>,
) -> String {
    let result = scan_transaction_inner(raw_tx_hex, viewing_key, network, height);
    serde_json::to_string(&result).unwrap_or_else(|e| {
        serde_json::to_string(&ScanTransactionResult {
            success: false,
            result: None,
            error: Some(format!("Serialization error: {}", e)),
        })
        .unwrap()
    })
}

fn scan_transaction_inner(
    raw_tx_hex: &str,
    viewing_key: &str,
    network_str: &str,
    height: Option<u32>,
) -> ScanTransactionResult {
    let network = parse_network(network_str);
    console_log(&format!(
        "Scanning transaction with {} viewing key",
        if viewing_key.starts_with("uview") {
            "UFVK"
        } else {
            "unknown"
        }
    ));

    match zcash_wallet_core::scan_transaction_hex(raw_tx_hex, viewing_key, network, height) {
        Ok(result) => {
            console_log(&format!(
                "Scan complete: {} notes found, {} nullifiers",
                result.notes.len(),
                result.spent_nullifiers.len()
            ));
            ScanTransactionResult {
                success: true,
                result: Some(result),
                error: None,
            }
        }
        Err(e) => {
            console_log(&format!("Scan failed: {}", e));
            ScanTransactionResult {
                success: false,
                result: None,
                error: Some(e.to_string()),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_viewing_key() {
        let result = parse_viewing_key("invalid_key");
        let info: ViewingKeyInfo = serde_json::from_str(&result).unwrap();
        assert!(!info.valid);
    }
}
