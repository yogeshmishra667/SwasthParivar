import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
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
 * For a critical log the family hasn't been alerted about yet (stored
 * offline, or not saved at all; audit P8): the fullscreen alert can be closed
 * after 30s, so calling stays one tap here. The profile's priority-1
 * contact, cached when the alert opened, and 112 — like the alert. Nothing
 * renders until the cache is read, so no button moves under the finger.
 */
export const OfflineCriticalCallButton = ({
  userId,
}: {
  userId: string | null;
}): JSX.Element | null => {
  const { t } = useTranslation();
  // undefined until the cache has been read.
  const [contact, setContact] = useState<CallTarget | null | undefined>(
    userId === null ? null : undefined,
  );

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

  if (contact === undefined) return null;
  return (
    <View className="gap-2">
      {contact && (
        <Button
          label={t("critical.callContact", { name: contact.name })}
          variant="critical"
          onPress={() => openDialer(contact.phone)}
        />
      )}
      <Button
        label={t("critical.callEmergency")}
        variant={contact ? "secondary" : "critical"}
        onPress={() => openDialer(EMERGENCY_NUMBER)}
      />
    </View>
  );
};
