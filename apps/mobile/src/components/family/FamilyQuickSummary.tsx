import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";

interface Props {
  connectedCount: number;
  pendingCount: number;
  /** Initials of the connected patients (rendered as an avatar stack). */
  patientInitials: readonly string[];
}

// Hero card at the top of the Family tab. Two visual states:
//   - empty (no connected patients): "your family network starts here"
//   - populated: shows count + avatar stack so the user can read the
//     current state at a glance instead of having to scroll the list.
export const FamilyQuickSummary = ({
  connectedCount,
  pendingCount,
  patientInitials,
}: Props): JSX.Element => {
  const { t } = useTranslation();
  const empty = connectedCount === 0;

  return (
    <View className="overflow-hidden rounded-3xl border border-indigo-100 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40">
      <View className="p-5">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm dark:bg-indigo-900/60">
            <Icon name={empty ? "people-outline" : "people"} size={26} color="#6366F1" />
          </View>
          <View className="flex-1">
            <Text className="text-important font-bold text-gray-900 dark:text-gray-100">
              {empty
                ? t("family.quickSummary.titleEmpty", { defaultValue: "Family health network" })
                : t("family.quickSummary.titleCount", {
                    count: connectedCount,
                    defaultValue: `${connectedCount} connected`,
                  })}
            </Text>
            <Text className="mt-0.5 text-body text-gray-700 dark:text-gray-300">
              {empty
                ? t("family.quickSummary.subtitleEmpty", {
                    defaultValue: "Invite someone to share logs and get alerts together.",
                  })
                : pendingCount > 0
                  ? t("family.quickSummary.subtitlePending", {
                      count: pendingCount,
                      defaultValue: `${pendingCount} invite${pendingCount === 1 ? "" : "s"} waiting for you`,
                    })
                  : t("family.quickSummary.subtitle", {
                      defaultValue: "Your loved ones, monitored together.",
                    })}
            </Text>
          </View>
        </View>

        {!empty && patientInitials.length > 0 && (
          <View className="mt-4 flex-row items-center">
            {patientInitials.slice(0, 5).map((init, i) => (
              <View
                key={`${init}-${i}`}
                style={{ marginLeft: i === 0 ? 0 : -10 }}
                className="h-10 w-10 items-center justify-center rounded-full border-2 border-indigo-50 bg-indigo-600 dark:border-indigo-950"
              >
                <Text className="text-body font-bold text-white">{init}</Text>
              </View>
            ))}
            {patientInitials.length > 5 && (
              <View
                style={{ marginLeft: -10 }}
                className="h-10 w-10 items-center justify-center rounded-full border-2 border-indigo-50 bg-white dark:border-indigo-950 dark:bg-indigo-900"
              >
                <Text className="text-body font-bold text-indigo-700 dark:text-indigo-200">
                  +{patientInitials.length - 5}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
};
