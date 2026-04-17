import { Tabs } from "expo-router";
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
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { minHeight: TOUCH_TARGET_MIN + 16, paddingTop: 4 },
        tabBarLabelStyle: { fontSize: 12 },
        tabBarActiveTintColor: "#2563EB",
        tabBarInactiveTintColor: "#6B7280",
        tabBarIcon: ({ color, size }) => <Icon name={iconFor(route.name)} size={size} color={color} />,
      })}
    >
      <Tabs.Screen name="dashboard" options={{ title: "Home" }} />
      <Tabs.Screen name="log" options={{ title: "Log" }} />
      <Tabs.Screen name="medications" options={{ title: "Dawai" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
