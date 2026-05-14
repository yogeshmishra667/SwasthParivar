import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

export type IconName = ComponentProps<typeof Ionicons>["name"];

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
}

export const Icon = ({
  name,
  size = 20,
  color = "#111827",
  accessibilityLabel,
}: IconProps): JSX.Element => (
  <Ionicons
    name={name}
    size={size}
    color={color}
    accessibilityLabel={accessibilityLabel}
    accessibilityElementsHidden={accessibilityLabel === undefined}
  />
);
