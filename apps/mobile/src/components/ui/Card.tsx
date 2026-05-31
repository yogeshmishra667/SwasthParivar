import { View, type ViewProps } from "react-native";

export const Card = ({ children, className = "", ...rest }: ViewProps): JSX.Element => (
  <View
    className={`rounded-2xl border border-transparent bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:shadow-none ${className}`}
    {...rest}
  >
    {children}
  </View>
);
