//! Shared data types for Zcash wallet operations.
//!
//! This module contains data structures used across the codebase for
//! representing transactions, viewing keys, and wallet data.

use serde::{Deserialize, Serialize};
use zcash_protocol::consensus::Network;

/// Network identifier for Zcash operations.
///
/// This enum provides a serde-compatible wrapper around network identification,
/// serializing as lowercase strings ("mainnet", "testnet", "regtest") for
/// JSON compatibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NetworkKind {
    /// Zcash mainnet - real value transactions.
    Mainnet,
    /// Zcash testnet - for development and testing.
    Testnet,
    /// Zcash regtest - local regression testing.
    Regtest,
}

impl NetworkKind {
    /// Convert to the zcash_protocol Network type.
    ///
    /// Note: Regtest is treated as TestNetwork since zcash_protocol
    /// doesn't have a separate Regtest variant.
    pub fn to_network(self) -> Network {
        match self {
            NetworkKind::Mainnet => Network::MainNetwork,
            NetworkKind::Testnet | NetworkKind::Regtest => Network::TestNetwork,
        }
    }

    /// Get the string representation of the network.
    pub fn as_str(&self) -> &'static str {
        match self {
            NetworkKind::Mainnet => "mainnet",
            NetworkKind::Testnet => "testnet",
            NetworkKind::Regtest => "regtest",
        }
    }
}

impl From<Network> for NetworkKind {
    fn from(network: Network) -> Self {
        match network {
            Network::MainNetwork => NetworkKind::Mainnet,
            Network::TestNetwork => NetworkKind::Testnet,
        }
    }
}

impl std::fmt::Display for NetworkKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl Serialize for NetworkKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for NetworkKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.to_lowercase().as_str() {
            "mainnet" | "main" => Ok(NetworkKind::Mainnet),
            "testnet" | "test" => Ok(NetworkKind::Testnet),
            "regtest" => Ok(NetworkKind::Regtest),
            _ => Err(serde::de::Error::custom(format!("unknown network: {}", s))),
        }
    }
}

/// A fully parsed and decrypted Zcash transaction.
///
/// Contains all components of a transaction including transparent inputs/outputs
/// and shielded data from Sapling and Orchard pools. Shielded outputs are
/// decrypted using the provided viewing key.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewingKeyInfo {
    /// Whether the viewing key was successfully parsed.
    pub valid: bool,
    /// Type of viewing key: "UFVK", "UIVK", or "Sapling ExtFVK".
    pub key_type: String,
    /// Whether the key can view Sapling shielded transactions.
    pub has_sapling: bool,
    /// Whether the key can view Orchard shielded transactions.
    pub has_orchard: bool,
    /// Network the key is valid for.
    pub network: Option<NetworkKind>,
    /// Error message if parsing failed.
    pub error: Option<String>,
}

/// Result of a transaction decryption operation.
///
/// Wraps the decryption result with success/error status for easy
/// handling in JavaScript.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletResult {
    /// Whether the wallet operation completed successfully.
    pub success: bool,
    /// The 24-word BIP39 seed phrase. Handle with extreme care.
    pub seed_phrase: Option<String>,
    /// Network the wallet was generated for.
    pub network: NetworkKind,
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
