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
  Promise.all(messages.map(sendSms));
