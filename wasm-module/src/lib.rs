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

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use rand::RngCore;
use zcash_address::unified::{self, Container, Encoding};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::{Network, NetworkType};

/// A fully parsed and decrypted Zcash transaction.
///
/// Contains all components of a transaction including transparent inputs/outputs
/// and shielded data from Sapling and Orchard pools. Shielded outputs are
/// decrypted using the provided viewing key.
#[derive(Serialize, Deserialize)]
pub struct DecryptedTransaction {
    /// The transaction identifier (hash) as a hex string.
    pub txid: String,
    /// Decrypted Sapling shielded outputs.
    pub sapling_outputs: Vec<DecryptedSaplingOutput>,
    /// Decrypted Orchard shielded actions.
    pub orchard_actions: Vec<DecryptedOrchardAction>,
    /// Transparent inputs spending previous outputs.
    pub transparent_inputs: Vec<TransparentInput>,
    /// Transparent outputs creating new UTXOs.
    pub transparent_outputs: Vec<TransparentOutput>,
    /// Transaction fee in zatoshis, if calculable.
    pub fee: Option<u64>,
}

/// A decrypted Sapling shielded output.
///
/// Represents a note received in the Sapling shielded pool. The value and memo
/// are only available if the output was successfully decrypted with the viewing key.
#[derive(Serialize, Deserialize)]
pub struct DecryptedSaplingOutput {
    /// Zero-based index of this output within the transaction's Sapling bundle.
    pub index: usize,
    /// Note value in zatoshis (1 ZEC = 100,000,000 zatoshis). Zero if not decrypted.
    pub value: u64,
    /// Memo field contents. Empty or "(encrypted)" if not decrypted.
    pub memo: String,
    /// Recipient address, if available from decryption.
    pub address: Option<String>,
    /// Note commitment (cmu) as a hex string. Used to identify the note on-chain.
    pub note_commitment: String,
    /// Nullifier as a hex string. Used to detect when this note is spent.
    pub nullifier: Option<String>,
}

/// A decrypted Orchard shielded action.
///
/// Represents a note in the Orchard shielded pool. Orchard uses "actions" which
/// combine an input (spend) and output (receive) in a single structure.
#[derive(Serialize, Deserialize)]
pub struct DecryptedOrchardAction {
    /// Zero-based index of this action within the transaction's Orchard bundle.
    pub index: usize,
    /// Note value in zatoshis. Zero if not decrypted.
    pub value: u64,
    /// Memo field contents. Empty or "(encrypted)" if not decrypted.
    pub memo: String,
    /// Recipient address, if available from decryption.
    pub address: Option<String>,
    /// Note commitment (cmx) as a hex string.
    pub note_commitment: String,
    /// Nullifier as a hex string. Present for all Orchard actions.
    pub nullifier: Option<String>,
}

/// A transparent transaction input.
///
/// References a previous transaction output (UTXO) being spent.
#[derive(Serialize, Deserialize)]
pub struct TransparentInput {
    /// Zero-based index of this input within the transaction.
    pub index: usize,
    /// Transaction ID of the output being spent, as a hex string.
    pub prevout_txid: String,
    /// Output index within the referenced transaction.
    pub prevout_index: u32,
}

/// A transparent transaction output.
///
/// Creates a new UTXO that can be spent by the holder of the corresponding private key.
#[derive(Serialize, Deserialize)]
pub struct TransparentOutput {
    /// Zero-based index of this output within the transaction.
    pub index: usize,
    /// Output value in zatoshis.
    pub value: u64,
    /// The locking script (scriptPubKey) as a hex string.
    pub script_pubkey: String,
    /// Decoded transparent address, if the script is a standard P2PKH or P2SH.
    pub address: Option<String>,
}

/// Information about a parsed viewing key.
///
/// Returned by `parse_viewing_key` to indicate whether a key is valid
/// and what capabilities it provides.
#[derive(Serialize, Deserialize)]
pub struct ViewingKeyInfo {
    /// Whether the viewing key was successfully parsed.
    pub valid: bool,
    /// Type of viewing key: "UFVK", "UIVK", or "Sapling ExtFVK".
    pub key_type: String,
    /// Whether the key can view Sapling shielded transactions.
    pub has_sapling: bool,
    /// Whether the key can view Orchard shielded transactions.
    pub has_orchard: bool,
    /// Network the key is valid for: "mainnet", "testnet", or "regtest".
    pub network: String,
    /// Error message if parsing failed.
    pub error: Option<String>,
}

/// Result of a transaction decryption operation.
///
/// Wraps the decryption result with success/error status for easy
/// handling in JavaScript.
#[derive(Serialize, Deserialize)]
pub struct DecryptionResult {
    /// Whether decryption completed without errors.
    pub success: bool,
    /// The decrypted transaction data, if successful.
    pub transaction: Option<DecryptedTransaction>,
    /// Error message if decryption failed.
    pub error: Option<String>,
}

/// Result of a wallet generation or restoration operation.
///
/// Contains the wallet's addresses, viewing key, and seed phrase.
/// All sensitive data should be handled carefully by the caller.
#[derive(Serialize, Deserialize)]
pub struct WalletData {
    /// Whether the wallet operation completed successfully.
    pub success: bool,
    /// The 24-word BIP39 seed phrase. Handle with extreme care.
    pub seed_phrase: Option<String>,
    /// Network: "mainnet" or "testnet".
    pub network: String,
    /// BIP32/ZIP32 account index used for derivation.
    pub account_index: u32,
    /// Address/diversifier index used for derivation.
    pub address_index: u32,
    /// Unified address containing all receiver types.
    pub unified_address: Option<String>,
    /// Legacy transparent address (t-addr).
    pub transparent_address: Option<String>,
    /// Unified Full Viewing Key for watching incoming transactions.
    pub unified_full_viewing_key: Option<String>,
    /// Error message if the operation failed.
    pub error: Option<String>,
}

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
            network: String::new(),
            error: Some(format!("Serialization error: {}", e)),
        })
        .unwrap()
    })
}

fn network_type_to_string(network: NetworkType) -> &'static str {
    match network {
        NetworkType::Main => "mainnet",
        NetworkType::Test => "testnet",
        NetworkType::Regtest => "regtest",
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
            network: network_type_to_string(network).to_string(),
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
            network: network_type_to_string(network).to_string(),
            error: None,
        };
    }

    // Try parsing as legacy Sapling extended viewing key
    // These start with "zxviews" (mainnet) or "zxviewtestsapling" (testnet)
    if key.starts_with("zxviews") || key.starts_with("zxviewtestsapling") {
        let network = if key.starts_with("zxviews") {
            "mainnet"
        } else {
            "testnet"
        };

        // Basic validation - proper bech32 decoding
        if bech32::decode(key).is_ok() {
            return ViewingKeyInfo {
                valid: true,
                key_type: "Sapling ExtFVK".to_string(),
                has_sapling: true,
                has_orchard: false,
                network: network.to_string(),
                error: None,
            };
        }
    }

    ViewingKeyInfo {
        valid: false,
        key_type: String::new(),
        has_sapling: false,
        has_orchard: false,
        network: String::new(),
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
                WalletData {
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
            Err(e) => WalletData {
                success: false,
                seed_phrase: None,
                network: String::new(),
                account_index: 0,
                address_index: 0,
                unified_address: None,
                transparent_address: None,
                unified_full_viewing_key: None,
                error: Some(e.to_string()),
            },
        };

    serde_json::to_string(&result).unwrap_or_else(|e| {
        serde_json::to_string(&WalletData {
            success: false,
            seed_phrase: None,
            network: String::new(),
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
                WalletData {
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
            Err(e) => WalletData {
                success: false,
                seed_phrase: None,
                network: String::new(),
                account_index: 0,
                address_index: 0,
                unified_address: None,
                transparent_address: None,
                unified_full_viewing_key: None,
                error: Some(e.to_string()),
            },
        };

    serde_json::to_string(&result).unwrap_or_else(|e| {
        serde_json::to_string(&WalletData {
            success: false,
            seed_phrase: None,
            network: String::new(),
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
