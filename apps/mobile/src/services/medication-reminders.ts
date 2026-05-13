import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { i18n } from "@/i18n/config";
import { logError } from "@/services/analytics";

/**
 * Local medication-reminder scheduling.
 *
 * Why local notifications:
 *   The server-side BullMQ MED_REMINDER worker (session 3) sends an
 *   Expo push at slot time, but pushes are not reliable when the
 *   device is offline, on Doze, or behind a captive portal. CLAUDE.md
 *   mandates local notifications scheduled at med-setup time as the
 *   primary channel; push is the cross-device fallback.
 *
 * Identifier scheme:
 *   `med-<scheduleId>-<HH:MM>`
 *   Stable prefix lets us find / cancel "all reminders for this
 *   schedule" without storing a separate index.
 *
 * Trigger:
 *   `SchedulableTriggerInputTypes.DAILY` — fires every day at HH:MM,
 *   recurring without re-scheduling.
 *
 * Runtime constraints:
 *   - Expo Go on SDK 53+ removed the local-notification API for
 *     remote-style flows; we no-op there. Dev builds work.
 *   - Simulator / non-physical Device.isDevice → no-op.
 */

const isExpoGo = String(Constants.appOwnership) === "expo";
const ID_PREFIX = "med-";

const idFor = (scheduleId: string, slotHHMM: string): string =>
  `${ID_PREFIX}${scheduleId}-${slotHHMM}`;

const isOurReminderId = (id: string, scheduleId?: string): boolean =>
  scheduleId === undefined
    ? id.startsWith(ID_PREFIX)
    : id.startsWith(`${ID_PREFIX}${scheduleId}-`);

const ensurePermission = async (): Promise<boolean> => {
  if (isExpoGo || !Device.isDevice) return false;
  const existing = await Notifications.getPermissionsAsync();
  if (String(existing.status) === "granted") return true;
  const next = await Notifications.requestPermissionsAsync();
  return String(next.status) === "granted";
};

const parseSlot = (slot: string): { hour: number; minute: number } | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(slot);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
};

/** Cancels every previously-scheduled reminder for `scheduleId`. */
export const cancelMedReminders = async (scheduleId: string): Promise<void> => {
  if (isExpoGo) return;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) {
      if (isOurReminderId(n.identifier, scheduleId)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch (err) {
    logError("medication-reminders.cancel", err);
  }
};

/**
 * Idempotently schedules daily reminders for `scheduleId`. Cancels any
 * existing reminders for the same `scheduleId` first so edits and
 * re-syncs replace cleanly.
 */
export const syncMedReminders = async (
  scheduleId: string,
  medicineName: string,
  slots: string[],
): Promise<void> => {
  if (isExpoGo) return;
  const granted = await ensurePermission();
  if (!granted) return;

  await cancelMedReminders(scheduleId);

  const title = i18n.t("medications.localReminder.title", {
    defaultValue: "Dawai ka time",
  });
  const body = i18n.t("medications.localReminder.body", {
    name: medicineName,
    defaultValue: `${medicineName} lijiye`,
  });

  for (const slot of slots) {
    const parsed = parseSlot(slot);
    if (parsed === null) continue; // server validates HH:MM; defensive only.
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: idFor(scheduleId, slot),
        content: { title, body, sound: true },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: parsed.hour,
          minute: parsed.minute,
        },
      });
    } catch (err) {
      logError("medication-reminders.schedule", err);
    }
  }
};

/**
 * Reconciles the OS-scheduled reminders against the server's schedules
 * list — fixes drift after re-installs, force-quits, or mismatches
 * between expected and actual scheduled set. Idempotent.
 */
export const reconcileMedReminders = async (
  schedules: { id: string; medicineName: string; timeSlots: string[] }[],
): Promise<void> => {
  if (isExpoGo) return;
  try {
    const granted = await ensurePermission();
    if (!granted) return;

    const activeIds = new Set(schedules.map((s) => s.id));
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) {
      if (!isOurReminderId(n.identifier)) continue;
      // id shape: `med-<uuid>-<HH:MM>`. Extract scheduleId.
      const remainder = n.identifier.slice(ID_PREFIX.length);
      const lastDash = remainder.lastIndexOf("-");
      if (lastDash <= 0) continue;
      const scheduleId = remainder.slice(0, lastDash);
      if (!activeIds.has(scheduleId)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    for (const s of schedules) {
      await syncMedReminders(s.id, s.medicineName, s.timeSlots);
    }
  } catch (err) {
    logError("medication-reminders.reconcile", err);
  }
};
