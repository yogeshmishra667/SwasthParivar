import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "@/components/ui/Icon";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

const iconFor = (routeName: string): IconName => {
  switch (routeName) {
    case "dashboard":
      return "home-outline";
    case "log":
      return "add-circle-outline";
    case "medications":
      return "medkit-outline";
    case "settings":
      return "settings-outline";
    default:
      return "ellipse-outline";
  }
};

export default function TabsLayout(): JSX.Element {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { minHeight: TOUCH_TARGET_MIN + 16, paddingTop: 4 },
        tabBarLabelStyle: { fontSize: 12 },
        tabBarActiveTintColor: "#2563EB",
        tabBarInactiveTintColor: "#6B7280",
        tabBarIcon: ({ color, size }) => (
          <Icon name={iconFor(route.name)} size={size} color={color} />
        ),
      })}
    >
      <Tabs.Screen name="dashboard" options={{ title: t("tabs.home") }} />
      <Tabs.Screen name="log" options={{ title: t("tabs.log") }} />
      <Tabs.Screen name="medications" options={{ title: t("tabs.medications") }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings") }} />
    </Tabs>
  );
}
