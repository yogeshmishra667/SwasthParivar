import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";

interface Props {
  /** Days between today and the latest reading. ≥ 3 → banner shows. */
  daysSinceLatest: number;
  /** Hide if the user already has a reading today (no nudge needed). */
  loggedToday: boolean;
}

/**
 * In-app welcome-back banner.
 *
 * CLAUDE.md re-engagement section: "Return: 'Welcome back! Naya streak
 * 💪' — NEVER guilt." This banner is the in-app counterpart to the
 * push that the re-engagement worker (PR #7) emits across days 3-7.
 *
 * Visibility rule:
 *   - daysSinceLatest ≥ 3
 *   - AND user hasn't already logged today
 *   - AND there IS a latest reading on file (Infinity from
 *     `daysSinceLatestReading` for never-logged users → suppressed,
 *     since the cold-start onboarding flow handles them differently)
 */
const SHOW_THRESHOLD_DAYS = 3;
const NEVER_LOGGED = Number.POSITIVE_INFINITY;

export const WelcomeBackBanner = ({
  daysSinceLatest,
  loggedToday,
}: Props): JSX.Element | null => {
  const { t } = useTranslation();
  if (loggedToday) return null;
  if (daysSinceLatest < SHOW_THRESHOLD_DAYS) return null;
  if (!Number.isFinite(daysSinceLatest) || daysSinceLatest === NEVER_LOGGED) return null;

  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-3 rounded-xl border border-celebration bg-violet-50 p-3"
    >
      <Icon name="sparkles" size={24} color="#8B5CF6" />
      <View className="flex-1">
        <Text className="text-important font-semibold text-celebration">
          {t("dashboard.welcomeBackTitle", { defaultValue: "Welcome back!" })}
        </Text>
        <Text className="mt-0.5 text-body text-neutral">
          {t("dashboard.welcomeBackBody", {
            days: daysSinceLatest,
            defaultValue: `${daysSinceLatest} din ho gaye — naya streak shuru karein 💪`,
          })}
        </Text>
      </View>
    </View>
  );
};
