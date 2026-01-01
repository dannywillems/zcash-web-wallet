// Zcash Web Wallet - Main Entry Point
// This file initializes all modules and sets up the application

import { initWasm } from "./wasm.js";
import { setTheme, getPreferredTheme, toggleTheme } from "./theme.js";
import { renderEndpoints } from "./storage/endpoints.js";
import { initDecryptViewerUI } from "./decrypt-viewer.js";
import {
  initScannerUI,
  populateScannerEndpoints,
  updateBalanceDisplay,
  updateNotesDisplay,
  updateLedgerDisplay,
} from "./scanner.js";
import { initWalletUI } from "./wallet.js";
import { initAddressViewerUI } from "./addresses.js";
import { initSendUI } from "./send.js";
import { initViewModeUI } from "./views.js";
import { initVersionCheck, dismissUpdateBanner } from "./version.js";

// Initialize application on page load
document.addEventListener("DOMContentLoaded", async () => {
  // Check for version updates
  initVersionCheck();

  // Set up version banner dismiss button
  const dismissBtn = document.getElementById("dismissVersionBanner");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", dismissUpdateBanner);
  }

  // Set initial theme
  setTheme(getPreferredTheme());

  // Theme toggle button
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  // Render RPC endpoints
  renderEndpoints();

  // Populate scanner endpoints
  populateScannerEndpoints();

  // Initialize UI modules
  initDecryptViewerUI();
  initWalletUI();
  initScannerUI();
  initAddressViewerUI();
  initSendUI();
  initViewModeUI();

  // Load WASM module
  const wasmLoaded = await initWasm();

  if (wasmLoaded) {
    // Update displays after WASM is loaded
    updateBalanceDisplay();
    updateNotesDisplay();
    updateLedgerDisplay();
  } else {
    // Show error if WASM failed to load
    const errorAlert = document.getElementById("errorAlert");
    const errorMessage = document.getElementById("errorMessage");
    if (errorAlert && errorMessage) {
      errorAlert.classList.remove("d-none");
      errorMessage.textContent =
        "Failed to load decryption module. Please refresh the page.";
    }
  }
});
