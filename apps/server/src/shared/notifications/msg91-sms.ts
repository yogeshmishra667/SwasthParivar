import { env } from "../../config/env.js";
import { logger } from "../logger.js";

export interface SmsMessage {
  phone: string;
  message: string;
}

export interface SmsResult {
  phone: string;
  success: boolean;
  errorCode?: string;
}

const MSG91_ENDPOINT = "https://api.msg91.com/api/v5/flow/";

export const sendSms = async (msg: SmsMessage): Promise<SmsResult> => {
  if (!env.MSG91_API_KEY || !env.MSG91_SENDER_ID) {
    logger.warn({ phone: msg.phone }, "MSG91 not configured — skipping SMS");
    return { phone: msg.phone, success: false, errorCode: "NOT_CONFIGURED" };
  }

  const phone = msg.phone.replace(/^\+/, "");

  try {
    const res = await fetch(MSG91_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: env.MSG91_API_KEY,
      },
      body: JSON.stringify({
        sender: env.MSG91_SENDER_ID,
        route: "4",
        country: "91",
        sms: [{ message: msg.message, to: [phone] }],
      }),
    });

    if (!res.ok) {
      logger.error({ status: res.status, phone }, "MSG91 http error");
      return { phone: msg.phone, success: false, errorCode: `HTTP_${res.status}` };
    }
    return { phone: msg.phone, success: true };
  } catch (err) {
    logger.error({ err, phone }, "MSG91 send failed");
    return { phone: msg.phone, success: false, errorCode: "NETWORK_ERROR" };
  }
};

export const sendSmsBatch = async (messages: SmsMessage[]): Promise<SmsResult[]> =>
  await Promise.all(messages.map(sendSms));

const MSG91_OTP_ENDPOINT = "https://control.msg91.com/api/v5/otp";

/**
 * Send a server-generated OTP via MSG91's dedicated OTP API. Distinct
 * from `sendSms` (Flow API) because the OTP endpoint accepts a custom
 * `otp` parameter and routes through a pre-approved DLT template tied
 * to MSG91_OTP_TEMPLATE_ID — required by Indian telecom regulators.
 */
export const sendMsg91Otp = async (phone: string, otp: string): Promise<SmsResult> => {
  if (!env.MSG91_API_KEY || !env.MSG91_OTP_TEMPLATE_ID) {
    logger.warn({ phone }, "MSG91 OTP not configured — skipping SMS fallback");
    return { phone, success: false, errorCode: "NOT_CONFIGURED" };
  }

  const mobile = phone.replace(/^\+/, "");
  const url = new URL(MSG91_OTP_ENDPOINT);
  url.searchParams.set("template_id", env.MSG91_OTP_TEMPLATE_ID);
  url.searchParams.set("mobile", mobile);
  url.searchParams.set("authkey", env.MSG91_API_KEY);
  url.searchParams.set("otp", otp);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      logger.error({ status: res.status, phone }, "msg91 otp http error");
      return { phone, success: false, errorCode: `HTTP_${res.status}` };
    }
    return { phone, success: true };
  } catch (err) {
    logger.error({ err, phone }, "msg91 otp send failed");
    return { phone, success: false, errorCode: "NETWORK_ERROR" };
  }
};
