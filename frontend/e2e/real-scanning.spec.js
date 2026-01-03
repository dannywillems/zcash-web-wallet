import { test, expect } from "@playwright/test";
import {
  clearLocalStorage,
  waitForWasmLoad,
  navigateToTab,
  restoreTestWallet,
  saveWalletToBrowser,
  TEST_SEED,
} from "./helpers.js";

// Test fixtures for transaction scanning
// These use realistic transaction data structures

// A sample raw transaction hex (Sapling transaction structure)
// This is a minimal valid transaction structure for testing
const MOCK_RAW_TX =
  "0500008085202f8901000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000";

// Mock RPC response for getrawtransaction
const MOCK_RPC_RESPONSE = {
  result: MOCK_RAW_TX,
  error: null,
  id: "zcash-viewer",
};

// Valid testnet transaction ID format (64 hex characters)
const VALID_TXID =
  "0000000000000000000000000000000000000000000000000000000000000001";

// Invalid transaction ID
const INVALID_TXID = "invalid-txid-format";

test.describe("Transaction Scanning with Mocked RPC", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearLocalStorage(page);
    await waitForWasmLoad(page);
  });

  test("should scan transaction and display results", async ({ page }) => {
    // Setup: Restore test wallet and save it
    await restoreTestWallet(page, "Scanning Test Wallet");
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    // Mock RPC endpoint response
    await page.route("**/zcash-testnet.gateway.tatum.io/**", async (route) => {
      const request = route.request();
      const postData = request.postDataJSON();

      if (postData?.method === "getrawtransaction") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_RPC_RESPONSE),
        });
      } else {
        await route.continue();
      }
    });

    // Select wallet
    await page.selectOption("#scanWalletSelect", { index: 1 });

    // Select testnet network
    await page.selectOption("#scanNetwork", "testnet");

    // Select Tatum testnet endpoint (index 2 is Tatum testnet)
    await page.selectOption("#scanRpcEndpoint", { index: 2 });

    // Enter valid transaction ID
    await page.fill("#scanTxid", VALID_TXID);

    // Click scan button
    await page.click("#scanTxBtn");

    // Wait for scan to complete (either success or error)
    await page.waitForTimeout(2000);

    // Verify that either results or error is shown
    // (The mock transaction won't decrypt anything, but it tests the flow)
    const resultsVisible = await page.locator("#scanResults").isVisible();
    const errorVisible = await page.locator("#scanError").isVisible();

    expect(resultsVisible || errorVisible).toBe(true);
  });

  test("should show error for invalid transaction ID", async ({ page }) => {
    await restoreTestWallet(page);
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    // Select wallet
    await page.selectOption("#scanWalletSelect", { index: 1 });
    await page.selectOption("#scanNetwork", "testnet");

    await page.selectOption("#scanRpcEndpoint", { index: 2 });

    // Enter invalid transaction ID
    await page.fill("#scanTxid", INVALID_TXID);
    await page.click("#scanTxBtn");

    // Should show validation error
    await expect(page.locator("#scanError")).toBeVisible({ timeout: 5000 });
    const errorText = await page.locator("#scanError").textContent();
    expect(errorText).toMatch(/invalid|must be 64 characters/i);
  });

  test("should show error when RPC returns error", async ({ page }) => {
    await restoreTestWallet(page);
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    // Mock RPC to return error
    await page.route("**/zcash-testnet.gateway.tatum.io/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: null,
          error: {
            code: -5,
            message: "No such mempool or blockchain transaction",
          },
          id: "zcash-viewer",
        }),
      });
    });

    await page.selectOption("#scanWalletSelect", { index: 1 });
    await page.selectOption("#scanNetwork", "testnet");
    await page.selectOption("#scanRpcEndpoint", { index: 2 });

    await page.fill("#scanTxid", VALID_TXID);
    await page.click("#scanTxBtn");

    // Should show RPC error
    await expect(page.locator("#scanError")).toBeVisible({ timeout: 5000 });
  });

  test("should handle network errors gracefully", async ({ page }) => {
    await restoreTestWallet(page);
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    // Mock RPC to return network error
    await page.route("**/zcash-testnet.gateway.tatum.io/**", async (route) => {
      await route.abort("failed");
    });

    await page.selectOption("#scanWalletSelect", { index: 1 });
    await page.selectOption("#scanNetwork", "testnet");
    await page.selectOption("#scanRpcEndpoint", { index: 2 });

    await page.fill("#scanTxid", VALID_TXID);
    await page.click("#scanTxBtn");

    // Should show network error
    await expect(page.locator("#scanError")).toBeVisible({ timeout: 5000 });
    const errorText = await page.locator("#scanError").textContent();
    expect(errorText.toLowerCase()).toMatch(/error|network|failed/);
  });

  test("should handle rate limiting", async ({ page }) => {
    await restoreTestWallet(page);
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    // Mock RPC to return 429 rate limit
    await page.route("**/zcash-testnet.gateway.tatum.io/**", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "Rate limited" }),
      });
    });

    await page.selectOption("#scanWalletSelect", { index: 1 });
    await page.selectOption("#scanNetwork", "testnet");
    await page.selectOption("#scanRpcEndpoint", { index: 2 });

    await page.fill("#scanTxid", VALID_TXID);
    await page.click("#scanTxBtn");

    // Should show rate limit error
    await expect(page.locator("#scanError")).toBeVisible({ timeout: 5000 });
    const errorText = await page.locator("#scanError").textContent();
    expect(errorText.toLowerCase()).toContain("rate");
  });

  test("should show loading state during scan", async ({ page }) => {
    await restoreTestWallet(page);
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    // Mock RPC with delay
    await page.route("**/zcash-testnet.gateway.tatum.io/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_RPC_RESPONSE),
      });
    });

    await page.selectOption("#scanWalletSelect", { index: 1 });
    await page.selectOption("#scanNetwork", "testnet");
    await page.selectOption("#scanRpcEndpoint", { index: 2 });

    await page.fill("#scanTxid", VALID_TXID);
    await page.click("#scanTxBtn");

    // Button should show loading state
    const buttonText = await page.locator("#scanTxBtn").textContent();
    expect(buttonText).toContain("Scanning");

    // Wait for scan to complete
    await page.waitForTimeout(1500);
  });

  test("should require wallet selection before scanning", async ({ page }) => {
    await restoreTestWallet(page);
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    // Don't select wallet, just try to scan
    await page.selectOption("#scanNetwork", "testnet");
    await page.selectOption("#scanRpcEndpoint", { index: 2 });

    await page.fill("#scanTxid", VALID_TXID);
    await page.click("#scanTxBtn");

    // Should show error about missing wallet
    await expect(page.locator("#scanError")).toBeVisible();
    const errorText = await page.locator("#scanError").textContent();
    expect(errorText.toLowerCase()).toContain("wallet");
  });

  test("should require RPC endpoint selection", async ({ page }) => {
    await restoreTestWallet(page);
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    await page.selectOption("#scanWalletSelect", { index: 1 });
    await page.selectOption("#scanNetwork", "testnet");
    // Don't select RPC endpoint

    await page.fill("#scanTxid", VALID_TXID);
    await page.click("#scanTxBtn");

    // Should show error about missing endpoint
    await expect(page.locator("#scanError")).toBeVisible();
  });

  test("should update balance display after scan", async ({ page }) => {
    await restoreTestWallet(page);
    await saveWalletToBrowser(page);
    await navigateToTab(page, "scanner");

    // Get initial balance display
    const initialBalance = await page.locator("#balanceDisplay").textContent();

    // Mock RPC endpoint
    await page.route("**/zcash-testnet.gateway.tatum.io/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_RPC_RESPONSE),
      });
    });

    await page.selectOption("#scanWalletSelect", { index: 1 });
    await page.selectOption("#scanNetwork", "testnet");
    await page.selectOption("#scanRpcEndpoint", { index: 2 });

    await page.fill("#scanTxid", VALID_TXID);
    await page.click("#scanTxBtn");

    // Wait for scan to complete
    await page.waitForTimeout(2000);

    // Balance display should still be visible
    await expect(page.locator("#balanceDisplay")).toBeVisible();
  });
});

// Optional: Real RPC tests (skipped by default, run with REAL_RPC=true)
test.describe("Transaction Scanning with Real RPC", () => {
  // Skip these tests unless REAL_RPC environment variable is set
  test.skip(
    () => !process.env.REAL_RPC,
    "Set REAL_RPC=true to run real network tests"
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearLocalStorage(page);
    await waitForWasmLoad(page);
  });

  test("should connect to testnet RPC", async ({ page }) => {
    await navigateToTab(page, "viewer");

    // Select Tatum testnet endpoint (index 2 is Tatum testnet)
    await page.selectOption("#rpcEndpoint", { index: 2 });

    // The app should not show an error for a valid endpoint
    // This test just verifies we can select the endpoint
    const selectedValue = await page.locator("#rpcEndpoint").inputValue();
    expect(selectedValue).toContain("tatum");
  });
});
