// Phase 4 Feature K.3 — Apple verifyReceipt wrapper.
//
// Server-side receipt validation ONLY (CLAUDE.md "never trust the
// client's 'I bought premium' message"). We POST the base64 receipt +
// the app shared secret to Apple's legacy verifyReceipt endpoint,
// starting at production and transparently retrying against sandbox on
// status 21007 (a sandbox receipt sent to prod) — Apple's documented
// pattern. Network/timeouts throw; the caller maps to a typed error.
//
// Docs: https://developer.apple.com/documentation/appstorereceipts/verifyreceipt

import { env } from "../../config/env.js";
import { logger } from "../logger.js";

const PROD_URL = "https://buy.itunes.apple.com/verifyReceipt";
const SANDBOX_URL = "https://sandbox.itunes.apple.com/verifyReceipt";
const REQUEST_TIMEOUT_MS = 10_000;
const SANDBOX_RECEIPT_STATUS = 21007;

export const appleIapConfigured = (): boolean => Boolean(env.APPLE_IAP_SHARED_SECRET);

export interface AppleReceiptInfo {
  productId: string;
  originalTransactionId: string;
  /** Subscription expiry in epoch ms, when present. */
  expiresDateMs: number | null;
  bundleId: string | null;
}

export interface VerifyReceiptResult {
  /** Apple status code — 0 means the receipt is valid. */
  status: number;
  info: AppleReceiptInfo | null;
}

interface AppleReceiptResponse {
  status?: number;
  receipt?: { bundle_id?: string };
  latest_receipt_info?: {
    product_id?: string;
    original_transaction_id?: string;
    expires_date_ms?: string;
  }[];
}

const callApple = async (url: string, receiptData: string): Promise<AppleReceiptResponse> => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      "receipt-data": receiptData,
      password: env.APPLE_IAP_SHARED_SECRET,
      "exclude-old-transactions": true,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Apple verifyReceipt HTTP ${res.status}`);
  return (await res.json()) as AppleReceiptResponse;
};

/**
 * Validate a receipt with Apple. Returns the status + the latest
 * transaction info (product, original transaction id, expiry). Throws
 * only on transport failure — a non-zero Apple status is returned so the
 * caller can map it to PAYMENT_RECEIPT_INVALID.
 */
export const verifyAppleReceipt = async (receiptData: string): Promise<VerifyReceiptResult> => {
  if (!appleIapConfigured()) {
    throw new Error("Apple IAP not configured (APPLE_IAP_SHARED_SECRET)");
  }

  let body = await callApple(PROD_URL, receiptData);
  if (body.status === SANDBOX_RECEIPT_STATUS) {
    logger.info("apple verifyReceipt: sandbox receipt at prod — retrying sandbox");
    body = await callApple(SANDBOX_URL, receiptData);
  }

  const status = body.status ?? -1;
  const latest = body.latest_receipt_info?.at(-1);
  const info: AppleReceiptInfo | null =
    status === 0 && latest?.product_id && latest.original_transaction_id
      ? {
          productId: latest.product_id,
          originalTransactionId: latest.original_transaction_id,
          expiresDateMs: latest.expires_date_ms ? Number(latest.expires_date_ms) : null,
          bundleId: body.receipt?.bundle_id ?? null,
        }
      : null;

  return { status, info };
};
