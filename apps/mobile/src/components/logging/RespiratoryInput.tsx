// Phase 4 Feature E — Respiratory log entry form.
//
// Layout sections (top → bottom, all TAP-ONLY):
//   1. Peak-flow numpad (3-digit, L/min). Optional.
//   2. Symptom-severity chips (none / mild / moderate / severe).
//   3. Inhaler-used toggle (no / yes). When yes:
//        3a. Puffs numpad (1–10).
//
// Validation runs locally: at-least-one-signal (peakFlow OR
// inhalerUsed=true OR symptomSeverity != none) mirrors the server's
// cross-field validator so the patient doesn't blank-submit and bounce
// off a 400.

import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import {
  PEAK_FLOW_VALID_MAX,
  PEAK_FLOW_VALID_MIN,
  type SymptomSeverity,
} from "@swasth/shared-types";
import { useTranslation } from "react-i18next";

import { TOUCH_TARGET_MIN } from "@/utils/constants";

export interface ParsedRespiratoryInput {
  peakFlow?: number;
  inhalerUsed: boolean;
  puffs?: number;
  symptomSeverity: SymptomSeverity;
}

interface RespiratoryInputProps {
  onSubmit: (params: ParsedRespiratoryInput) => void;
}

type Field = "peakFlow" | "puffs";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
const PEAK_FLOW_DIGIT_LIMIT = 3;
const PUFFS_DIGIT_LIMIT = 2;

const SEVERITY_OPTIONS: readonly SymptomSeverity[] = ["none", "mild", "moderate", "severe"];

export const RespiratoryInput = ({ onSubmit }: RespiratoryInputProps): JSX.Element => {
  const { t } = useTranslation();
  const [peakFlow, setPeakFlow] = useState("");
  const [severity, setSeverity] = useState<SymptomSeverity>("none");
  const [inhalerUsed, setInhalerUsed] = useState(false);
  const [puffs, setPuffs] = useState("");
  const [active, setActive] = useState<Field>("peakFlow");

  // Symmetric to CardiacInput: when inhaler is toggled off, drop any
  // puff count and swap focus back to the peak-flow field. Sending
  // puffs without inhalerUsed=true trips the server validator.
  useEffect(() => {
    if (!inhalerUsed) {
      setPuffs("");
      setActive("peakFlow");
    } else {
      setActive("puffs");
    }
  }, [inhalerUsed]);

  const setForField = (field: Field, value: string): void => {
    if (field === "peakFlow") setPeakFlow(value);
    else setPuffs(value);
  };

  const valueFor = (field: Field): string => (field === "peakFlow" ? peakFlow : puffs);
  const limitFor = (field: Field): number =>
    field === "peakFlow" ? PEAK_FLOW_DIGIT_LIMIT : PUFFS_DIGIT_LIMIT;

  const handlePress = (key: string): void => {
    const cur = valueFor(active);
    if (key === "C") return setForField(active, "");
    if (key === "⌫") return setForField(active, cur.slice(0, -1));
    if (cur.length >= limitFor(active)) return;
    setForField(active, cur + key);
  };

  const peakFlowNum = peakFlow.length > 0 ? Number.parseInt(peakFlow, 10) : null;
  const puffsNum = puffs.length > 0 ? Number.parseInt(puffs, 10) : null;

  const peakFlowValid =
    peakFlowNum === null ||
    (peakFlowNum >= PEAK_FLOW_VALID_MIN && peakFlowNum <= PEAK_FLOW_VALID_MAX);
  const puffsValid = puffsNum === null || (puffsNum >= 1 && puffsNum <= 10);
  const hasSignal = peakFlowNum !== null || inhalerUsed || severity !== "none";
  const canSubmit = peakFlowValid && puffsValid && hasSignal;

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit({
      ...(peakFlowNum !== null ? { peakFlow: peakFlowNum } : {}),
      inhalerUsed,
      ...(inhalerUsed && puffsNum !== null ? { puffs: puffsNum } : {}),
      symptomSeverity: severity,
    });
  };

  return (
    <View className="gap-4">
      <Text className="text-hero font-bold text-gray-900 dark:text-gray-100">
        {t("respiratory.title")}
      </Text>

      {/* ── Peak flow ─── */}
      <FieldChip
        label={t("respiratory.peakFlow")}
        suffix={t("respiratory.lMin")}
        value={peakFlow}
        active={active === "peakFlow"}
        invalid={peakFlow.length > 0 && !peakFlowValid}
        onPress={() => setActive("peakFlow")}
      />

      {/* ── Symptom severity ─── */}
      <View className="gap-2">
        <Text className="text-body text-neutral dark:text-gray-400">
          {t("respiratory.symptom.label")}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {SEVERITY_OPTIONS.map((option) => (
            <ChipToggle
              key={option}
              label={t(`respiratory.symptom.${option}`)}
              selected={severity === option}
              onPress={() => setSeverity(option)}
              tone={option === "severe" ? "warn" : "default"}
            />
          ))}
        </View>
      </View>

      {/* ── Inhaler ─── */}
      <View className="gap-2">
        <Text className="text-body text-neutral dark:text-gray-400">
          {t("respiratory.inhaler.label")}
        </Text>
        <View className="flex-row gap-2">
          <ChipToggle
            label={t("respiratory.inhaler.no")}
            selected={!inhalerUsed}
            onPress={() => setInhalerUsed(false)}
          />
          <ChipToggle
            label={t("respiratory.inhaler.yes")}
            selected={inhalerUsed}
            onPress={() => setInhalerUsed(true)}
          />
        </View>
        {inhalerUsed && (
          <FieldChip
            label={t("respiratory.puffs.label")}
            value={puffs}
            active={active === "puffs"}
            invalid={puffs.length > 0 && !puffsValid}
            onPress={() => setActive("puffs")}
          />
        )}
      </View>

      {/* ── Numpad ─── */}
      <View className="flex-row flex-wrap justify-between">
        {KEYS.map((k) => (
          <Pressable
            key={k}
            onPress={() => handlePress(k)}
            accessibilityRole="button"
            accessibilityLabel={`Numpad ${k}`}
            className="mb-2 w-[31%] items-center justify-center rounded-xl bg-gray-100 active:bg-gray-200 dark:bg-gray-800"
            style={{ minHeight: TOUCH_TARGET_MIN + 16 }}
          >
            <Text className="text-number font-semibold text-gray-900 dark:text-gray-100">{k}</Text>
          </Pressable>
        ))}
      </View>

      {!hasSignal && peakFlow.length === 0 && (
        <Text className="text-body text-neutral dark:text-gray-400">
          {t("respiratory.needsSignal")}
        </Text>
      )}

      <Pressable
        disabled={!canSubmit}
        onPress={submit}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        className={`items-center justify-center rounded-2xl px-5 ${
          canSubmit ? "bg-primary" : "bg-gray-300 dark:bg-gray-700"
        }`}
        style={{ minHeight: TOUCH_TARGET_MIN }}
      >
        <Text className="text-important font-bold text-white">{t("common.next")}</Text>
      </Pressable>

      <Text className="text-body text-neutral dark:text-gray-400">
        {t("respiratory.rangeHint")}
      </Text>
    </View>
  );
};

// Local primitives — see CardiacInput.tsx for the same shapes.
interface FieldChipProps {
  label: string;
  suffix?: string;
  value: string;
  active: boolean;
  invalid: boolean;
  onPress: () => void;
}

const FieldChip = ({
  label,
  suffix,
  value,
  active,
  invalid,
  onPress,
}: FieldChipProps): JSX.Element => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    className={`rounded-2xl border-2 p-3 ${
      active
        ? "border-primary bg-blue-50 dark:bg-blue-950/40"
        : invalid
          ? "border-warning bg-amber-50 dark:bg-amber-950/40"
          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
    }`}
    style={{ minHeight: TOUCH_TARGET_MIN + 24 }}
  >
    <Text className="text-body text-neutral dark:text-gray-400">{label}</Text>
    <View className="mt-1 flex-row items-baseline gap-1">
      <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value || "—"}</Text>
      {suffix !== undefined && (
        <Text className="text-body text-neutral dark:text-gray-400">{suffix}</Text>
      )}
    </View>
  </Pressable>
);

interface ChipToggleProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  tone?: "default" | "warn";
}

const ChipToggle = ({
  label,
  selected,
  onPress,
  tone = "default",
}: ChipToggleProps): JSX.Element => {
  const selectedClass =
    tone === "warn"
      ? "border-warning bg-amber-50 dark:bg-amber-950/40"
      : "border-primary bg-blue-50 dark:bg-blue-950/40";
  const idleClass = "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`flex-1 items-center justify-center rounded-2xl border-2 px-3 py-2 ${
        selected ? selectedClass : idleClass
      }`}
      style={{ minHeight: TOUCH_TARGET_MIN }}
    >
      <Text
        className={`text-important font-semibold ${
          selected
            ? tone === "warn"
              ? "text-amber-900 dark:text-amber-200"
              : "text-primary dark:text-blue-300"
            : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
};
