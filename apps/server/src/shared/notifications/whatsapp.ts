import { env } from "../../config/env.js";
import { logger } from "../logger.js";

export interface WhatsappOtpResult {
  success: boolean;
  errorCode?: string;
}

const GRAPH_VERSION = "v21.0";

/**
 * Send an OTP via WhatsApp Business Cloud API using an approved template.
 * Business-initiated WhatsApp messages MUST use a template; raw text is
 * only allowed inside an active 24h conversation window — which a fresh
 * OTP recipient is by definition not in.
 *
 * Template requirements (configured in Meta Business Manager):
 *   - name: env.WHATSAPP_OTP_TEMPLATE_NAME (default "swasth_otp")
 *   - category: AUTHENTICATION
 *   - one body variable {{1}} for the OTP code
 *
 * Returns success=true only if the Graph API accepts the message for
 * dispatch. Actual delivery is reported via webhook (not implemented
 * yet) — the auth service treats a send-side error as the fallback
 * trigger, not a delivery callback.
 */
export const sendWhatsappOtp = async (phone: string, otp: string): Promise<WhatsappOtpResult> => {
  if (
    !env.WHATSAPP_BUSINESS_API_TOKEN ||
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_OTP_TEMPLATE_NAME
  ) {
    return { success: false, errorCode: "NOT_CONFIGURED" };
  }

  const to = phone.replace(/^\+/, "");
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.WHATSAPP_BUSINESS_API_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: env.WHATSAPP_OTP_TEMPLATE_NAME,
          language: { code: env.WHATSAPP_OTP_TEMPLATE_LANGUAGE },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: otp }],
            },
            // AUTHENTICATION templates also require a button component
            // when configured with the one-tap copy-code button. Including
            // it is safe even if the template has no button — Meta
            // ignores extras silently.
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: otp }],
            },
          ],
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, phone, body }, "whatsapp otp http error");
      return { success: false, errorCode: `HTTP_${res.status}` };
    }
    return { success: true };
  } catch (err) {
    logger.error({ err, phone }, "whatsapp otp send failed");
    return { success: false, errorCode: "NETWORK_ERROR" };
  }
};
