// Zcash Web Wallet - Version Notification
// Notifies users when a new version of the app is available

import { STORAGE_KEYS } from "./constants.js";

/**
 * Get the current app version (commit hash) from the page.
 * The commit hash is embedded in the commitLink href during build.
 * @returns {string|null} The commit hash or null if not found/placeholder
 */
function getCurrentVersion() {
  const commitLink = document.getElementById("commitLink");
  if (!commitLink) return null;

  const href = commitLink.getAttribute("href");
  if (!href) return null;

  // Extract commit hash from URL: .../commit/{hash}
  const match = href.match(/\/commit\/([a-f0-9]+)$/i);
  if (!match) return null;

  const hash = match[1];

  // Ignore placeholder value (not yet injected)
  if (hash === "__COMMIT_HASH__") return null;

  return hash;
}

/**
 * Get the stored version from localStorage.
 * @returns {string|null} The stored version or null
 */
function getStoredVersion() {
  try {
    return localStorage.getItem(STORAGE_KEYS.appVersion);
  } catch {
    return null;
  }
}

/**
 * Store the current version in localStorage.
 * @param {string} version - The version to store
 */
function storeVersion(version) {
  try {
    localStorage.setItem(STORAGE_KEYS.appVersion, version);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get the short version of a commit hash.
 * @param {string} hash - Full commit hash
 * @returns {string} Short hash (first 7 characters)
 */
function shortHash(hash) {
  return hash.substring(0, 7);
}

/**
 * Show the version update notification banner.
 * @param {string} oldVersion - The previous version hash
 * @param {string} newVersion - The current version hash
 */
function showUpdateBanner(oldVersion, newVersion) {
  const banner = document.getElementById("versionUpdateBanner");
  const oldHashEl = document.getElementById("oldVersionHash");
  const newHashEl = document.getElementById("newVersionHash");

  if (oldHashEl) {
    oldHashEl.textContent = shortHash(oldVersion);
  }
  if (newHashEl) {
    newHashEl.textContent = shortHash(newVersion);
  }
  if (banner) {
    banner.classList.remove("d-none");
  }
}

/**
 * Hide the version update notification banner and update stored version.
 */
export function dismissUpdateBanner() {
  const banner = document.getElementById("versionUpdateBanner");
  if (banner) {
    banner.classList.add("d-none");
  }

  // Update stored version to current
  const currentVersion = getCurrentVersion();
  if (currentVersion) {
    storeVersion(currentVersion);
  }
}

/**
 * Initialize version checking.
 * Compares current version with stored version and shows notification if different.
 */
export function initVersionCheck() {
  const currentVersion = getCurrentVersion();

  // No version available (placeholder or missing)
  if (!currentVersion) return;

  const storedVersion = getStoredVersion();

  // First visit - store current version
  if (!storedVersion) {
    storeVersion(currentVersion);
    return;
  }

  // Version changed - show notification
  if (storedVersion !== currentVersion) {
    showUpdateBanner(storedVersion, currentVersion);
  }
}
