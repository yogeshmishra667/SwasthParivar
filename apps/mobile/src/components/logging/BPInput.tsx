// Phase 2 — BP entry form. Two numpads (systolic + diastolic) plus an
// optional pulse field. Validation runs locally before save so the
// medical correctness rule (systolic > diastolic) gives instant
// feedback — not a server 400 round-trip.

import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import {
  BP_DIASTOLIC_MAX,
  BP_DIASTOLIC_MIN,
  BP_PULSE_MAX,
  BP_PULSE_MIN,
  BP_SYSTOLIC_MAX,
  BP_SYSTOLIC_MIN,
} from "@swasth/shared-types";
import { useTranslation } from "react-i18next";

import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface BPInputProps {
  onSubmit: (params: { systolic: number; diastolic: number; pulse?: number }) => void;
}

type Field = "systolic" | "diastolic" | "pulse";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];

const NUMBER_LIMIT = 3;

export const BPInput = ({ onSubmit }: BPInputProps): JSX.Element => {
  const { t } = useTranslation();
  const [active, setActive] = useState<Field>("systolic");
  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const [pulse, setPulse] = useState("");

  const setForField = (field: Field, value: string): void => {
    if (field === "systolic") setSys(value);
    else if (field === "diastolic") setDia(value);
    else setPulse(value);
  };

  const valueFor = (field: Field): string =>
    field === "systolic" ? sys : field === "diastolic" ? dia : pulse;

  const handlePress = (key: string): void => {
    const cur = valueFor(active);
    if (key === "C") return setForField(active, "");
    if (key === "⌫") return setForField(active, cur.slice(0, -1));
    if (cur.length >= NUMBER_LIMIT) return;
    setForField(active, cur + key);
  };

  const sysNum = Number.parseInt(sys, 10);
  const diaNum = Number.parseInt(dia, 10);
  const pulseNum = pulse.length > 0 ? Number.parseInt(pulse, 10) : null;

  const sysValid =
    Number.isFinite(sysNum) && sysNum >= BP_SYSTOLIC_MIN && sysNum <= BP_SYSTOLIC_MAX;
  const diaValid =
    Number.isFinite(diaNum) && diaNum >= BP_DIASTOLIC_MIN && diaNum <= BP_DIASTOLIC_MAX;
  const pulseValid = pulseNum === null || (pulseNum >= BP_PULSE_MIN && pulseNum <= BP_PULSE_MAX);
  const pairValid = sysValid && diaValid && sysNum > diaNum;
  const canSubmit = pairValid && pulseValid;

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit({
      systolic: sysNum,
      diastolic: diaNum,
      ...(pulseNum !== null ? { pulse: pulseNum } : {}),
    });
  };

  return (
    <View className="gap-4">
      <Text className="text-hero font-bold">{t("bp.title")}</Text>

      <View className="flex-row gap-3">
        <FieldChip
          label={t("bp.systolic")}
          value={sys}
          active={active === "systolic"}
          invalid={sys.length > 0 && !sysValid}
          onPress={() => setActive("systolic")}
        />
        <FieldChip
          label={t("bp.diastolic")}
          value={dia}
          active={active === "diastolic"}
          invalid={dia.length > 0 && !diaValid}
          onPress={() => setActive("diastolic")}
        />
        <FieldChip
          label={t("bp.pulse")}
          value={pulse}
          active={active === "pulse"}
          invalid={pulse.length > 0 && !pulseValid}
          onPress={() => setActive("pulse")}
        />
      </View>

      {sysValid && diaValid && !pairValid && (
        <Text className="text-body text-warning">{t("bp.invalidPair")}</Text>
      )}

      <View className="flex-row flex-wrap justify-between">
        {KEYS.map((k) => (
          <Pressable
            key={k}
            onPress={() => handlePress(k)}
            accessibilityRole="button"
            accessibilityLabel={`Numpad ${k}`}
            className="mb-2 w-[31%] items-center justify-center rounded-xl bg-gray-100 active:bg-gray-200"
            style={{ minHeight: TOUCH_TARGET_MIN + 16 }}
          >
            <Text className="text-number font-semibold">{k}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        disabled={!canSubmit}
        onPress={submit}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        className={`items-center justify-center rounded-2xl px-5 ${
          canSubmit ? "bg-primary" : "bg-gray-300"
        }`}
        style={{ minHeight: TOUCH_TARGET_MIN }}
      >
        <Text className="text-important font-bold text-white">{t("common.next")}</Text>
      </Pressable>

      <Text className="text-body text-neutral">{t("bp.rangeHint")}</Text>
    </View>
  );
};

interface FieldChipProps {
  label: string;
  value: string;
  active: boolean;
  invalid: boolean;
  onPress: () => void;
}

const FieldChip = ({ label, value, active, invalid, onPress }: FieldChipProps): JSX.Element => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    className={`flex-1 rounded-2xl border-2 p-3 ${
      active
        ? "border-primary bg-blue-50"
        : invalid
          ? "border-warning bg-amber-50"
          : "border-gray-200 bg-white"
    }`}
    style={{ minHeight: TOUCH_TARGET_MIN + 24 }}
  >
    <Text className="text-body text-neutral">{label}</Text>
    <Text className="mt-1 text-2xl font-bold text-gray-900">{value || "—"}</Text>
  </Pressable>
);
