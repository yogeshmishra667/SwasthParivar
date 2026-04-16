import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, View, Text } from "react-native";
import { TIMEOUTS } from "@/utils/constants";

interface Props {
  loading: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

export const TimeoutFallback = ({ loading, children, fallback }: Props): JSX.Element => {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading) {
      setTimedOut(false);
      return;
    }
    const id = setTimeout(() => setTimedOut(true), TIMEOUTS.apiRequestMs);
    return () => clearTimeout(id);
  }, [loading]);

  if (loading && !timedOut) {
    return (
      <View className="items-center justify-center p-6">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (timedOut) {
    return (
      <View className="p-6">
        <Text className="text-important">
          Internet dheema hai — purana data dikh raha hai.
        </Text>
        {fallback}
      </View>
    );
  }

  return <>{children}</>;
};
