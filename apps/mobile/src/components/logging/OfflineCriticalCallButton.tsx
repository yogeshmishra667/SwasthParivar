import { useEffect, useState } from "react";
import { Linking } from "react-native";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { logError } from "@/services/analytics";
import { readCachedPriorityContact, type CallTarget } from "@/services/priority-contact";
import { isDialablePhone, sanitizePhoneForTelUri } from "@/utils/phone";

const EMERGENCY_NUMBER = "112";

const openDialer = (phone: string): void => {
  const tel = sanitizePhoneForTelUri(phone);
  if (tel.length === 0) return;
  Linking.openURL(`tel:${tel}`).catch((err: unknown) => logError("offlineCriticalCall.dial", err));
};

/**
 * On the saved screen of a critical log stored offline (audit P8): the
 * family alert waits for sync and the fullscreen alert can be closed after
 * 30s, so calling stays one tap here. The profile's priority-1 contact,
 * cached when the alert opened; 112 when there is none.
 */
export const OfflineCriticalCallButton = ({ userId }: { userId: string | null }): JSX.Element => {
  const { t } = useTranslation();
  const [contact, setContact] = useState<CallTarget | null>(null);

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    void readCachedPriorityContact(userId).then((found) => {
      if (!cancelled) setContact(found && isDialablePhone(found.phone) ? found : null);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return contact ? (
    <Button
      label={t("critical.callContact", { name: contact.name })}
      variant="critical"
      onPress={() => openDialer(contact.phone)}
    />
  ) : (
    <Button
      label={t("critical.callEmergency")}
      variant="critical"
      onPress={() => openDialer(EMERGENCY_NUMBER)}
    />
  );
};
