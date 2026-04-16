import { View, type ViewProps } from "react-native";

export const Card = ({ children, className = "", ...rest }: ViewProps): JSX.Element => (
  <View
    className={`rounded-2xl bg-white p-4 shadow-sm ${className}`}
    {...rest}
  >
    {children}
  </View>
);
