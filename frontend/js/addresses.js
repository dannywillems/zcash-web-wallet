// Zcash Web Wallet - Address Viewer Module
// TODO: Full implementation - copied patterns from original app.js

import { getWasm } from "./wasm.js";
import { escapeHtml, truncateAddress, getExplorerAddressUrl } from "./utils.js";
import {
  loadWallets,
  saveWallets,
  getSelectedWalletId,
  getSelectedWallet,
} from "./storage/wallets.js";

let derivedAddressesData = [];
let derivedAddressesNetwork = "testnet";
let currentWalletId = null;

export function initAddressViewerUI() {
  const deriveBtn = document.getElementById("deriveAddressesBtn");
  const copyAllBtn = document.getElementById("copyAllAddressesBtn");
  const exportCsvBtn = document.getElementById("exportAddressesCsvBtn");
  const saveToWalletBtn = document.getElementById("saveAddressesToWalletBtn");
  const walletSelect = document.getElementById("addressWalletSelect");

  if (deriveBtn) {
    deriveBtn.addEventListener("click", deriveAddresses);
  }
  if (copyAllBtn) {
    copyAllBtn.addEventListener("click", copyAllAddresses);
  }
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", exportAddressesCsv);
  }
  if (saveToWalletBtn) {
    saveToWalletBtn.addEventListener("click", saveAddressesToWallet);
  }
  if (walletSelect) {
    walletSelect.addEventListener("change", () => {
      const wallet = getSelectedWallet();
      if (wallet) {
        const networkSelect = document.getElementById("addressNetwork");
        if (networkSelect && wallet.network) {
          networkSelect.value = wallet.network;
        }
      }
    });
  }

  populateAddressViewerWallets();
}

export function populateAddressViewerWallets() {
  const walletSelect = document.getElementById("addressWalletSelect");
  if (!walletSelect) return;

  const wallets = loadWallets();
  const selectedId = getSelectedWalletId();

  walletSelect.innerHTML = '<option value="">-- Select a wallet --</option>';

  for (const wallet of wallets) {
    const option = document.createElement("option");
    option.value = wallet.id;
    option.textContent = `${wallet.alias} (${wallet.network})`;
    if (wallet.id === selectedId) {
      option.selected = true;
    }
    walletSelect.appendChild(option);
  }
}

async function deriveAddresses() {
  const wasmModule = getWasm();
  const walletSelect = document.getElementById("addressWalletSelect");
  const fromIndexInput = document.getElementById("addressFromIndex");
  const toIndexInput = document.getElementById("addressToIndex");

  const walletId = walletSelect?.value;
  const fromIndex = parseInt(fromIndexInput?.value || "0", 10);
  const toIndex = parseInt(toIndexInput?.value || "10", 10);
  const count = Math.max(1, toIndex - fromIndex + 1);

  if (!walletId) {
    showAddressError("Please select a wallet.");
    return;
  }

  const wallets = loadWallets();
  const wallet = wallets.find((w) => w.id === walletId);

  if (!wallet || !wallet.seed_phrase) {
    showAddressError("Selected wallet has no seed phrase.");
    return;
  }

  if (!wasmModule) {
    showAddressError("WASM module not loaded.");
    return;
  }

  setAddressLoading(true);
  hideAddressError();

  try {
    const network = wallet.network || "testnet";
    const accountIndex = wallet.account_index || 0;

    // Get both unified and transparent addresses
    const unifiedResult = wasmModule.derive_unified_addresses(
      wallet.seed_phrase,
      network,
      accountIndex,
      fromIndex,
      count
    );
    const transparentResult = wasmModule.derive_transparent_addresses(
      wallet.seed_phrase,
      network,
      accountIndex,
      fromIndex,
      count
    );

    const unifiedAddresses = JSON.parse(unifiedResult);
    const transparentAddresses = JSON.parse(transparentResult);

    // Get already saved addresses from wallet
    const savedTransparent = new Set(wallet.transparent_addresses || []);
    const savedUnified = new Set(wallet.unified_addresses || []);

    // Combine into objects with index, transparent, unified, and saved status
    derivedAddressesData = unifiedAddresses.map((unified, idx) => ({
      index: fromIndex + idx,
      transparent: transparentAddresses[idx] || "",
      unified: unified,
      isSaved:
        savedTransparent.has(transparentAddresses[idx]) ||
        savedUnified.has(unified),
    }));

    derivedAddressesNetwork = network;
    currentWalletId = walletId;
    displayDerivedAddresses();
  } catch (error) {
    console.error("Address derivation error:", error);
    showAddressError(`Error: ${error.message}`);
  } finally {
    setAddressLoading(false);
  }
}

function displayDerivedAddresses() {
  const displayDiv = document.getElementById("addressesDisplay");
  if (!displayDiv) return;

  if (derivedAddressesData.length === 0) {
    displayDiv.innerHTML = `
      <div class="text-muted text-center py-5">
        <i class="bi bi-card-list fs-1"></i>
        <p class="mt-2 mb-0">No addresses derived.</p>
      </div>
    `;
    return;
  }

  // Detect duplicate unified addresses (due to Sapling diversifier behavior)
  // Track first occurrence index for each address
  const firstOccurrence = new Map();
  const duplicateIndices = new Set();

  for (const addr of derivedAddressesData) {
    if (firstOccurrence.has(addr.unified)) {
      // This is a duplicate (not the first occurrence)
      duplicateIndices.add(addr.index);
    } else {
      // First occurrence of this address
      firstOccurrence.set(addr.unified, addr.index);
    }
  }

  const duplicateCount = duplicateIndices.size;

  let html = "";

  // Show warning if there are duplicates
  if (duplicateCount > 0) {
    html += `
      <div class="alert alert-warning py-2 mb-3 sapling-note">
        <i class="bi bi-exclamation-triangle me-1"></i>
        <strong>Duplicate addresses detected:</strong> ${duplicateCount} indices produce duplicate unified addresses
        due to Sapling diversifier behavior. Avoid reusing these addresses.
      </div>
    `;
  }

  const rows = derivedAddressesData
    .map((addr, idx) => {
      const transparentId = `copy-transparent-${idx}`;
      const unifiedId = `copy-unified-${idx}`;
      const explorerUrl = getExplorerAddressUrl(
        addr.transparent,
        derivedAddressesNetwork
      );

      // Only flag as duplicate if this is NOT the first occurrence
      const isDuplicate = duplicateIndices.has(addr.index);
      const duplicateBadge = isDuplicate
        ? `<span class="badge bg-warning text-dark ms-1" title="This address is identical to index ${firstOccurrence.get(addr.unified)} due to Sapling diversifier behavior. Avoid reusing."><i class="bi bi-exclamation-triangle-fill"></i> Duplicate</span>`
        : "";
      const rowClass = isDuplicate ? "table-warning" : "";

      const savedIcon = addr.isSaved
        ? '<i class="bi bi-check-circle-fill text-success" title="Saved to wallet"></i>'
        : '<i class="bi bi-circle text-muted" title="Not saved"></i>';

      return `
        <tr class="${rowClass}">
          <td class="text-muted align-middle">${addr.index}</td>
          <td>
            <div class="d-flex align-items-center">
              <a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="mono small text-truncate" style="max-width: 150px;" title="${escapeHtml(addr.transparent)}">${truncateAddress(addr.transparent, 8, 6)}</a>
              <button id="${transparentId}" class="btn btn-sm btn-link p-0 text-muted ms-1" onclick="copyAddress('${escapeHtml(addr.transparent)}', '${transparentId}')" title="Copy address">
                <i class="bi bi-clipboard"></i>
              </button>
            </div>
          </td>
          <td>
            <div class="d-flex align-items-center">
              <span class="mono small text-truncate" style="max-width: 200px;" title="${escapeHtml(addr.unified)}">${truncateAddress(addr.unified, 10, 8)}</span>
              <button id="${unifiedId}" class="btn btn-sm btn-link p-0 text-muted ms-1" onclick="copyAddress('${escapeHtml(addr.unified)}', '${unifiedId}')" title="Copy address">
                <i class="bi bi-clipboard"></i>
              </button>
              ${duplicateBadge}
            </div>
          </td>
          <td class="text-center align-middle">${savedIcon}</td>
        </tr>
      `;
    })
    .join("");

  html += `
    <div class="table-responsive">
      <table class="table table-sm table-hover mb-0">
        <thead>
          <tr>
            <th style="width: 60px;">Index</th>
            <th>Transparent Address</th>
            <th>Unified Address</th>
            <th style="width: 60px;" class="text-center">Saved</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;

  displayDiv.innerHTML = html;

  // Show the export buttons
  const copyAllBtn = document.getElementById("copyAllAddressesBtn");
  const exportCsvBtn = document.getElementById("exportAddressesCsvBtn");
  const saveToWalletBtn = document.getElementById("saveAddressesToWalletBtn");
  if (copyAllBtn) copyAllBtn.classList.remove("d-none");
  if (exportCsvBtn) exportCsvBtn.classList.remove("d-none");
  if (saveToWalletBtn) saveToWalletBtn.classList.remove("d-none");
}

function copyAllAddresses() {
  if (derivedAddressesData.length === 0) return;

  const text = derivedAddressesData
    .map((addr) => `${addr.index}\t${addr.transparent}\t${addr.unified}`)
    .join("\n");

  navigator.clipboard.writeText(text);
}

function exportAddressesCsv() {
  if (derivedAddressesData.length === 0) return;

  const csv =
    "Index,Transparent,Unified\n" +
    derivedAddressesData
      .map((addr) => `${addr.index},"${addr.transparent}","${addr.unified}"`)
      .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zcash-addresses-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function saveAddressesToWallet() {
  if (derivedAddressesData.length === 0 || !currentWalletId) {
    showAddressError("No addresses to save or no wallet selected.");
    return;
  }

  const wallets = loadWallets();
  const walletIndex = wallets.findIndex((w) => w.id === currentWalletId);

  if (walletIndex === -1) {
    showAddressError("Wallet not found.");
    return;
  }

  const wallet = wallets[walletIndex];

  // Get existing addresses
  const existingTransparent = new Set(wallet.transparent_addresses || []);
  const existingUnified = new Set(wallet.unified_addresses || []);

  // Count new addresses
  let newTransparentCount = 0;
  let newUnifiedCount = 0;
  let duplicateCount = 0;

  for (const addr of derivedAddressesData) {
    if (addr.transparent && !existingTransparent.has(addr.transparent)) {
      existingTransparent.add(addr.transparent);
      newTransparentCount++;
    } else if (addr.transparent) {
      duplicateCount++;
    }

    if (addr.unified && !existingUnified.has(addr.unified)) {
      existingUnified.add(addr.unified);
      newUnifiedCount++;
    }
  }

  // Update wallet
  wallet.transparent_addresses = Array.from(existingTransparent);
  wallet.unified_addresses = Array.from(existingUnified);
  wallets[walletIndex] = wallet;
  saveWallets(wallets);

  // Update display to show saved status
  derivedAddressesData = derivedAddressesData.map((addr) => ({
    ...addr,
    isSaved: true,
  }));
  displayDerivedAddresses();

  // Show result message
  const totalNew = newTransparentCount + newUnifiedCount;
  if (totalNew === 0 && duplicateCount > 0) {
    showAddressInfo(
      `All ${duplicateCount} addresses are already saved to the wallet.`
    );
  } else if (duplicateCount > 0) {
    showAddressInfo(
      `Saved ${totalNew} new addresses. ${duplicateCount} were already saved.`
    );
  } else {
    showAddressSuccess(`Saved ${totalNew} addresses to the wallet.`);
  }
}

function showAddressInfo(message) {
  const displayDiv = document.getElementById("addressesDisplay");
  if (!displayDiv) return;

  // Insert alert before the table
  const existingAlert = displayDiv.querySelector(".alert");
  if (existingAlert) existingAlert.remove();

  const alert = document.createElement("div");
  alert.className = "alert alert-info alert-dismissible fade show mb-3";
  alert.innerHTML = `
    <i class="bi bi-info-circle me-1"></i> ${escapeHtml(message)}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  displayDiv.insertBefore(alert, displayDiv.firstChild);
}

function showAddressSuccess(message) {
  const displayDiv = document.getElementById("addressesDisplay");
  if (!displayDiv) return;

  // Insert alert before the table
  const existingAlert = displayDiv.querySelector(".alert");
  if (existingAlert) existingAlert.remove();

  const alert = document.createElement("div");
  alert.className = "alert alert-success alert-dismissible fade show mb-3";
  alert.innerHTML = `
    <i class="bi bi-check-circle me-1"></i> ${escapeHtml(message)}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  displayDiv.insertBefore(alert, displayDiv.firstChild);
}

function copyAddress(address, btnId) {
  navigator.clipboard.writeText(address).then(() => {
    const btn = document.getElementById(btnId);
    if (btn) {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check"></i>';
      setTimeout(() => {
        btn.innerHTML = originalHtml;
      }, 1500);
    }
  });
}

// Expose to window for onclick handlers
window.copyAddress = copyAddress;

function showAddressError(message) {
  const errorDiv = document.getElementById("addressError");
  if (errorDiv) {
    errorDiv.classList.remove("d-none");
    errorDiv.textContent = message;
  }
}

function hideAddressError() {
  const errorDiv = document.getElementById("addressError");
  if (errorDiv) {
    errorDiv.classList.add("d-none");
  }
}

function setAddressLoading(loading) {
  const btn = document.getElementById("deriveAddressesBtn");
  if (!btn) return;

  if (loading) {
    btn.disabled = true;
    btn.innerHTML =
      '<span class="spinner-border spinner-border-sm me-1"></span> Deriving...';
  } else {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-diagram-3 me-1"></i> Derive Addresses';
  }
}
