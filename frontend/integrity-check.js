// Zcash Web Wallet - Integrity Verification
// This script verifies that served files match the repository code
// Runs silently at startup, shows status in header/footer indicator

const REPO_OWNER = "LeakIX";
const REPO_NAME = "zcash-web-wallet";
const REPO_BRANCH = (() => {
  const script = document.currentScript;
  return (script && script.dataset.branch) || "main";
})();
const CHECKSUMS_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/CHECKSUMS.json`;

// Files to verify (relative to frontend/)
const FILES_TO_VERIFY = [
  "js/app.js",
  "js/wasm.js",
  "js/decrypt-viewer.js",
  "js/scanner.js",
  "js/wallet.js",
  "js/addresses.js",
  "js/send.js",
  "js/views.js",
  "js/theme.js",
  "js/utils.js",
  "js/rpc.js",
  "js/constants.js",
  "js/storage/endpoints.js",
  "js/storage/notes.js",
  "js/storage/wallets.js",
  "js/storage/ledger.js",
  "css/style.css",
  "index.html",
  "pkg/zcash_tx_viewer.js",
  "pkg/zcash_tx_viewer_bg.wasm",
];

class IntegrityVerifier {
  constructor() {
    this.status = "pending"; // pending, verified, failed
    this.checksums = null;
    this.error = null;
  }

  async sha256(data) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async fetchFile(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.statusText}`);
    }
    if (path.endsWith(".wasm")) {
      return await response.arrayBuffer();
    }
    const text = await response.text();
    return new TextEncoder().encode(text);
  }

  async fetchChecksums() {
    const response = await fetch(CHECKSUMS_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to fetch checksums: ${response.statusText}`);
    }
    return await response.json();
  }

  updateIndicator() {
    const indicators = [
      document.getElementById("verificationIndicator"),
      document.getElementById("verificationIndicatorMobile"),
    ].filter(Boolean);

    let buttonHTML;
    if (this.status === "verified") {
      buttonHTML = `
        <button class="btn btn-sm btn-outline-success verification-button"
                title="Code integrity verified - Click to verify again">
          <i class="bi bi-shield-check me-1"></i>Verified
        </button>
      `;
    } else if (this.status === "failed") {
      buttonHTML = `
        <button class="btn btn-sm btn-outline-danger verification-button"
                title="Verification failed - Click for details">
          <i class="bi bi-shield-x me-1"></i>Failed
        </button>
      `;
    } else {
      buttonHTML = `
        <button class="btn btn-sm btn-outline-secondary verification-button"
                title="Click to verify code integrity">
          <i class="bi bi-shield me-1"></i>Verify
        </button>
      `;
    }

    indicators.forEach((el) => {
      el.innerHTML = buttonHTML;
    });

    document.querySelectorAll(".verification-button").forEach((button) => {
      button.addEventListener("click", () => this.runManualVerification());
    });
  }

  getChecksumsUrl(ref) {
    const branch = ref || REPO_BRANCH;
    return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branch}/CHECKSUMS.json`;
  }

  async runManualVerification() {
    // Show modal with verification progress
    const modalHtml = `
      <div class="modal fade" id="integrityModal" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">
                <i class="bi bi-shield-check me-2"></i>Code Integrity Verification
              </h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <p>Verifying that served files match the
                <a href="https://github.com/${REPO_OWNER}/${REPO_NAME}" target="_blank" rel="noopener">GitHub repository</a>.</p>
              </div>
              <div class="mb-3">
                <label for="commitInput" class="form-label">Commit or branch to verify against:</label>
                <div class="input-group">
                  <input type="text" class="form-control font-monospace" id="commitInput"
                         placeholder="${REPO_BRANCH}" value="${REPO_BRANCH}">
                  <button class="btn btn-primary" type="button" id="startVerifyBtn">
                    <i class="bi bi-play-fill me-1"></i>Verify
                  </button>
                </div>
                <div class="form-text">Enter a commit SHA, branch name, or tag (default: ${REPO_BRANCH})</div>
              </div>
              <div id="verifyProgressContainer" style="display: none;">
                <div class="progress mb-3" style="height: 20px;">
                  <div id="verifyProgress" class="progress-bar progress-bar-striped progress-bar-animated"
                       role="progressbar" style="width: 0%">0%</div>
                </div>
                <div id="verifyStatus" class="small font-monospace" style="max-height: 200px; overflow-y: auto;"></div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHtml);
    const modalElement = document.getElementById("integrityModal");
    const modal = new bootstrap.Modal(modalElement);

    modalElement.addEventListener("hidden.bs.modal", () => {
      modalElement.remove();
    });

    modal.show();

    const commitInput = document.getElementById("commitInput");
    const startBtn = document.getElementById("startVerifyBtn");
    const progressContainer = document.getElementById(
      "verifyProgressContainer"
    );

    startBtn.addEventListener("click", () => {
      const ref = commitInput.value.trim() || REPO_BRANCH;
      progressContainer.style.display = "block";
      startBtn.disabled = true;
      commitInput.disabled = true;
      this.performVerification(ref);
    });
  }

  async performVerification(ref) {
    const statusDiv = document.getElementById("verifyStatus");
    const progressBar = document.getElementById("verifyProgress");

    // Reset progress bar
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    progressBar.classList.remove("bg-success", "bg-danger");
    progressBar.classList.add("progress-bar-animated");
    statusDiv.innerHTML = "";

    try {
      statusDiv.innerHTML = `<div class="text-muted">Fetching checksums from ${ref}...</div>`;
      const checksumsUrl = this.getChecksumsUrl(ref);
      const response = await fetch(checksumsUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to fetch checksums: ${response.statusText}`);
      }
      this.checksums = await response.json();
      statusDiv.innerHTML += `<div class="text-success"><i class="bi bi-check me-1"></i>Checksums loaded (${this.checksums.version.substring(0, 7)})</div>`;

      const total = FILES_TO_VERIFY.length;
      let verified = 0;

      for (let i = 0; i < FILES_TO_VERIFY.length; i++) {
        const file = FILES_TO_VERIFY[i];

        const content = await this.fetchFile(file);
        const actualHash = await this.sha256(content);
        const expectedHash = this.checksums.files[file];

        if (!expectedHash) {
          throw new Error(`No checksum found for ${file}`);
        }

        if (actualHash !== expectedHash) {
          throw new Error(`Hash mismatch for ${file}`);
        }

        statusDiv.innerHTML += `<div class="text-success"><i class="bi bi-check me-1"></i>${file}</div>`;
        verified++;

        const progress = Math.round(((i + 1) / total) * 100);
        progressBar.style.width = `${progress}%`;
        progressBar.textContent = `${progress}%`;
      }

      this.status = "verified";
      this.error = null;
      progressBar.classList.remove("progress-bar-animated");
      progressBar.classList.add("bg-success");
      statusDiv.innerHTML +=
        '<div class="text-success fw-bold mt-2"><i class="bi bi-shield-check me-1"></i>All files verified successfully</div>';
    } catch (error) {
      this.status = "failed";
      this.error = error;
      progressBar.classList.remove("progress-bar-animated");
      progressBar.classList.add("bg-danger");
      statusDiv.innerHTML += `<div class="text-danger fw-bold mt-2"><i class="bi bi-shield-x me-1"></i>Verification failed: ${error.message}</div>`;
    }

    // Re-enable inputs for another verification
    const commitInput = document.getElementById("commitInput");
    const startBtn = document.getElementById("startVerifyBtn");
    if (commitInput) commitInput.disabled = false;
    if (startBtn) startBtn.disabled = false;

    this.updateIndicator();
  }

  async runSilent() {
    try {
      this.checksums = await this.fetchChecksums();

      for (const file of FILES_TO_VERIFY) {
        const content = await this.fetchFile(file);
        const actualHash = await this.sha256(content);
        const expectedHash = this.checksums.files[file];

        if (!expectedHash || actualHash !== expectedHash) {
          throw new Error(`Verification failed for ${file}`);
        }
      }

      this.status = "verified";
      this.error = null;
      console.log("Integrity verification passed");
    } catch (error) {
      this.status = "failed";
      this.error = error;
      console.error("Integrity verification failed:", error);
    }

    this.updateIndicator();
  }
}

// Create verifier and run silent check at startup
window.integrityVerifier = new IntegrityVerifier();
document.addEventListener("DOMContentLoaded", () => {
  window.integrityVerifier.updateIndicator();
  window.integrityVerifier.runSilent();
});
