import { Pressable, Text, type PressableProps } from "react-native";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export type ButtonVariant = "primary" | "secondary" | "critical" | "ghost";

interface ButtonProps extends Omit<PressableProps, "children"> {
  label: string;
  variant?: ButtonVariant;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary active:bg-blue-700",
  secondary: "bg-neutral active:bg-gray-600",
  critical: "bg-critical active:bg-red-700",
  ghost: "bg-transparent border border-neutral active:bg-gray-100",
};

const LABEL_CLASS: Record<ButtonVariant, string> = {
  primary: "text-white",
  secondary: "text-white",
  critical: "text-white",
  ghost: "text-neutral",
};

export const Button = ({ label, variant = "primary", ...rest }: ButtonProps): JSX.Element => (
  <Pressable
    className={`items-center justify-center rounded-2xl px-5 ${VARIANT_CLASS[variant]}`}
    style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
    accessibilityRole="button"
    {...rest}
  >
    <Text className={`text-important font-semibold ${LABEL_CLASS[variant]}`}>{label}</Text>
  </Pressable>
);
