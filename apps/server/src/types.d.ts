import "express-serve-static-core";
import type { AdminRole } from "@swasth/shared-types";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    // Verbatim request body bytes, captured by the express.json `verify`
    // hook. Webhook handlers (Razorpay HMAC, Apple JWS) MUST sign over
    // these raw bytes — re-serialising the parsed JSON would not
    // byte-match the provider's payload.
    rawBody?: Buffer;
    auth?: {
      sub: string;
      householdId: string;
    };
    // Set by `requireAdminAuth` on /admin routes. The patient `auth`
    // claim and this admin claim are deliberately separate — an /admin
    // route never carries a patient token and vice versa.
    admin?: {
      id: string;
      email: string;
      name: string;
      role: AdminRole;
    };
  }
}
