import {
  Pressable,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export type ButtonVariant = "primary" | "secondary" | "critical" | "ghost";

interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: ButtonVariant;
  /**
   * Container style override. Merged AFTER the built-in 48dp touch
   * target floor, so callers can raise the height (e.g. SOS panic
   * surface uses 60dp) or paint a custom background without losing
   * the accessibility minimum. Pass an array if you want to layer
   * multiple style objects yourself.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Text style override for the label. Use sparingly — variant-driven
   * styling should cover most cases. SOS surfaces use this to bump
   * label weight + size for high-stress visibility.
   */
  textStyle?: StyleProp<TextStyle>;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary active:bg-blue-700",
  secondary: "bg-neutral active:bg-gray-600",
  critical: "bg-critical active:bg-red-700",
  ghost: "bg-transparent border border-neutral active:bg-gray-100 dark:bg-gray-800",
};

const LABEL_CLASS: Record<ButtonVariant, string> = {
  primary: "text-white",
  secondary: "text-white",
  critical: "text-white",
  ghost: "text-neutral dark:text-gray-400",
};

export const Button = ({
  label,
  variant = "primary",
  style,
  textStyle,
  ...rest
}: ButtonProps): JSX.Element => (
  <Pressable
    className={`items-center justify-center rounded-2xl px-5 ${VARIANT_CLASS[variant]}`}
    accessibilityRole="button"
    {...rest}
    style={[{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }, style]}
  >
    <Text className={`text-important font-semibold ${LABEL_CLASS[variant]}`} style={textStyle}>
      {label}
    </Text>
  </Pressable>
);
