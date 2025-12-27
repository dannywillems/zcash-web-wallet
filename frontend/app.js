// Zcash Shielded Transaction Viewer - Frontend Application

// WASM module instance
let wasmModule = null;

// API endpoint for fetching raw transactions
const API_BASE_URL = window.location.origin + "/api";

// Initialize WASM module
async function initWasm() {
  try {
    const wasm = await import("./pkg/zcash_tx_viewer.js");
    await wasm.default();
    wasmModule = wasm;
    console.log("WASM module loaded successfully");
    return true;
  } catch (error) {
    console.error("Failed to load WASM module:", error);
    showError("Failed to load decryption module. Please refresh the page.");
    return false;
  }
}

// DOM Elements
const form = document.getElementById("decryptForm");
const viewingKeyInput = document.getElementById("viewingKey");
const txidInput = document.getElementById("txid");
const networkSelect = document.getElementById("network");
const submitBtn = document.getElementById("submitBtn");
const keyInfo = document.getElementById("keyInfo");
const resultsDiv = document.getElementById("results");
const placeholderDiv = document.getElementById("placeholder");
const errorAlert = document.getElementById("errorAlert");
const errorMessage = document.getElementById("errorMessage");

// Validate viewing key on input
viewingKeyInput.addEventListener("input", debounce(validateViewingKey, 300));

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

async function validateViewingKey() {
  const key = viewingKeyInput.value.trim();
  if (!key) {
    keyInfo.innerHTML = "";
    return;
  }

  if (!wasmModule) {
    keyInfo.innerHTML =
      '<span class="text-warning">WASM module not loaded</span>';
    return;
  }

  try {
    const resultJson = wasmModule.parse_viewing_key(key);
    const result = JSON.parse(resultJson);

    if (result.valid) {
      const capabilities = [];
      if (result.has_sapling) capabilities.push("Sapling");
      if (result.has_orchard) capabilities.push("Orchard");

      keyInfo.innerHTML = `
        <span class="text-success">
          Valid ${result.key_type} (${result.network})
          ${capabilities.length > 0 ? "- " + capabilities.join(", ") : ""}
        </span>
      `;

      // Auto-select network if detected
      if (result.network === "mainnet" || result.network === "testnet") {
        networkSelect.value = result.network;
      }
    } else {
      keyInfo.innerHTML = `<span class="text-danger">${result.error || "Invalid viewing key"}</span>`;
    }
  } catch (error) {
    console.error("Key validation error:", error);
    keyInfo.innerHTML = '<span class="text-danger">Error validating key</span>';
  }
}

// Form submission
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await decryptTransaction();
});

async function decryptTransaction() {
  const viewingKey = viewingKeyInput.value.trim();
  const txid = txidInput.value.trim();
  const network = networkSelect.value;

  if (!viewingKey || !txid) {
    showError("Please enter both a viewing key and transaction ID.");
    return;
  }

  if (!wasmModule) {
    showError("WASM module not loaded. Please refresh the page.");
    return;
  }

  // Validate txid format (64 hex characters)
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
    showError(
      "Invalid transaction ID format. Expected 64 hexadecimal characters."
    );
    return;
  }

  setLoading(true);
  hideError();

  try {
    // Fetch raw transaction from backend
    const rawTx = await fetchRawTransaction(txid, network);

    if (!rawTx) {
      showError("Failed to fetch transaction. Please check the transaction ID.");
      setLoading(false);
      return;
    }

    // Decrypt transaction using WASM
    const resultJson = wasmModule.decrypt_transaction(rawTx, viewingKey, network);
    const result = JSON.parse(resultJson);

    if (result.success && result.transaction) {
      displayResults(result.transaction);
    } else {
      showError(result.error || "Failed to decrypt transaction.");
    }
  } catch (error) {
    console.error("Decryption error:", error);
    showError(`Error: ${error.message}`);
  } finally {
    setLoading(false);
  }
}

async function fetchRawTransaction(txid, network) {
  try {
    const response = await fetch(
      `${API_BASE_URL}/transaction/${txid}?network=${network}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.hex;
  } catch (error) {
    console.error("Failed to fetch transaction:", error);
    throw error;
  }
}

function displayResults(tx) {
  placeholderDiv.classList.add("d-none");
  resultsDiv.classList.remove("d-none");

  document.getElementById("txidValue").textContent = tx.txid;

  // Transparent section
  const transparentSection = document.getElementById("transparentSection");
  const transparentInputs = document.getElementById("transparentInputs");
  const transparentOutputs = document.getElementById("transparentOutputs");

  if (tx.transparent_inputs.length > 0 || tx.transparent_outputs.length > 0) {
    transparentSection.classList.remove("d-none");

    // Inputs
    if (tx.transparent_inputs.length > 0) {
      transparentInputs.innerHTML = `
        <p class="fw-semibold mb-2">Inputs (${tx.transparent_inputs.length})</p>
        ${tx.transparent_inputs
          .map(
            (input) => `
          <div class="card output-card transparent mb-2">
            <div class="card-body py-2 px-3">
              <small class="text-muted">Input #${input.index}</small>
              <div class="mono small text-truncate">
                Prev: ${input.prevout_txid}:${input.prevout_index}
              </div>
            </div>
          </div>
        `
          )
          .join("")}
      `;
    } else {
      transparentInputs.innerHTML = "";
    }

    // Outputs
    if (tx.transparent_outputs.length > 0) {
      transparentOutputs.innerHTML = `
        <p class="fw-semibold mb-2">Outputs (${tx.transparent_outputs.length})</p>
        ${tx.transparent_outputs
          .map(
            (output) => `
          <div class="card output-card transparent mb-2">
            <div class="card-body py-2 px-3">
              <small class="text-muted">Output #${output.index}</small>
              <div><strong>${formatZatoshi(output.value)}</strong> ZEC</div>
              ${output.address ? `<div class="mono small text-truncate">${output.address}</div>` : ""}
            </div>
          </div>
        `
          )
          .join("")}
      `;
    } else {
      transparentOutputs.innerHTML = "";
    }
  } else {
    transparentSection.classList.add("d-none");
  }

  // Sapling section
  const saplingSection = document.getElementById("saplingSection");
  const saplingOutputs = document.getElementById("saplingOutputs");

  if (tx.sapling_outputs.length > 0) {
    saplingSection.classList.remove("d-none");
    saplingOutputs.innerHTML = tx.sapling_outputs
      .map(
        (output) => `
        <div class="card output-card sapling mb-2">
          <div class="card-body py-2 px-3">
            <small class="text-muted">Output #${output.index}</small>
            ${output.value > 0 ? `<div><strong>${formatZatoshi(output.value)}</strong> ZEC</div>` : ""}
            ${output.memo && output.memo !== "(encrypted)" ? `<div class="small">Memo: ${escapeHtml(output.memo)}</div>` : ""}
            <div class="mono small text-truncate text-muted">
              Commitment: ${output.note_commitment}
            </div>
            ${output.nullifier ? `<div class="mono small text-truncate text-muted">Nullifier: ${output.nullifier}</div>` : ""}
          </div>
        </div>
      `
      )
      .join("");
  } else {
    saplingSection.classList.add("d-none");
  }

  // Orchard section
  const orchardSection = document.getElementById("orchardSection");
  const orchardActions = document.getElementById("orchardActions");

  if (tx.orchard_actions.length > 0) {
    orchardSection.classList.remove("d-none");
    orchardActions.innerHTML = tx.orchard_actions
      .map(
        (action) => `
        <div class="card output-card orchard mb-2">
          <div class="card-body py-2 px-3">
            <small class="text-muted">Action #${action.index}</small>
            ${action.value > 0 ? `<div><strong>${formatZatoshi(action.value)}</strong> ZEC</div>` : ""}
            ${action.memo && action.memo !== "(encrypted)" ? `<div class="small">Memo: ${escapeHtml(action.memo)}</div>` : ""}
            <div class="mono small text-truncate text-muted">
              Commitment: ${action.note_commitment}
            </div>
            ${action.nullifier ? `<div class="mono small text-truncate text-muted">Nullifier: ${action.nullifier}</div>` : ""}
          </div>
        </div>
      `
      )
      .join("");
  } else {
    orchardSection.classList.add("d-none");
  }

  // No shielded data message
  const noShieldedData = document.getElementById("noShieldedData");
  if (tx.sapling_outputs.length === 0 && tx.orchard_actions.length === 0) {
    noShieldedData.classList.remove("d-none");
  } else {
    noShieldedData.classList.add("d-none");
  }
}

function formatZatoshi(zatoshi) {
  return (zatoshi / 100000000).toFixed(8);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setLoading(loading) {
  if (loading) {
    submitBtn.classList.add("loading");
    submitBtn.disabled = true;
  } else {
    submitBtn.classList.remove("loading");
    submitBtn.disabled = false;
  }
}

function showError(message) {
  placeholderDiv.classList.add("d-none");
  resultsDiv.classList.remove("d-none");
  errorAlert.classList.remove("d-none");
  errorMessage.textContent = message;
}

function hideError() {
  errorAlert.classList.add("d-none");
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", async () => {
  await initWasm();
});
