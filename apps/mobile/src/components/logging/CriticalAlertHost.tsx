import { useRef } from "react";
import { router } from "expo-router";

import { CriticalAlert } from "@/components/logging/CriticalAlert";
import { useCriticalAlertStore, type ShownCriticalAlert } from "@/stores/critical-alert.store";

/**
 * Renders the app's one fullscreen critical alert (audit P3). Mounted once
 * in the root layout, above every screen.
 */
export const CriticalAlertHost = (): JSX.Element => {
  const current = useCriticalAlertStore((s) => s.current);
  const dismiss = useCriticalAlertStore((s) => s.dismiss);
  // Keep the last alert's content while the modal fades out.
  const shown = useRef<ShownCriticalAlert | null>(null);
  if (current) shown.current = current;
  const alert = current ?? shown.current;

  return (
    <CriticalAlert
      visible={current !== null}
      alertKey={alert?.id ?? 0}
      audience={alert?.audience ?? "patient"}
      category={alert?.category ?? "glucose"}
      direction={alert?.direction ?? "low"}
      {...(alert?.reasonKey !== undefined ? { reasonKey: alert.reasonKey } : {})}
      {...(alert?.valueLabel !== undefined ? { valueLabel: alert.valueLabel } : {})}
      {...(alert?.title !== undefined ? { title: alert.title } : {})}
      {...(alert?.body !== undefined ? { body: alert.body } : {})}
      {...(alert?.audience === "guardian" && alert.patientId !== undefined
        ? {
            onOpenDetails: (): void => {
              // Navigate first: if it fails, the alert (with 112) stays up.
              router.push({ pathname: "/patient/[id]", params: { id: alert.patientId! } });
              dismiss();
            },
          }
        : {})}
      userId={alert?.userId ?? null}
      onDismiss={dismiss}
    />
  );
};
