// Phase 4 Feature E — Cardiac log entry form.
//
// Layout sections (top → bottom, all TAP-ONLY per CLAUDE.md "core
// flows: TAP ONLY"):
//   1. Heart-rate numpad (3-digit, bpm).
//   2. Rhythm chips (regular / irregular / unknown).
//   3. Chest-pain toggle (yes / no). When yes:
//        3a. Pain-severity numpad (0–10).
//   4. Exercise-tolerance chips (normal / reduced / severe).
//
// Validation runs locally before save so the server's medical-correctness
// rules (HR ∈ [30,250], painSeverity gated by chestPain) produce instant
// feedback — not a 400 round-trip.

import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import {
  HR_VALID_MAX,
  HR_VALID_MIN,
  PAIN_SEVERITY_MAX,
  PAIN_SEVERITY_MIN,
  type ExerciseTolerance,
  type RhythmStatus,
} from "@swasth/shared-types";
import { useTranslation } from "react-i18next";

import { TOUCH_TARGET_MIN } from "@/utils/constants";

export interface ParsedCardiacInput {
  heartRate: number;
  rhythmStatus: RhythmStatus;
  chestPain: boolean;
  painSeverity?: number;
  exerciseTolerance: ExerciseTolerance;
}

interface CardiacInputProps {
  onSubmit: (params: ParsedCardiacInput) => void;
  // Phase 4 §E voice-integration follow-up: when the patient logs by
  // voice ("dil ki dhadkan 85"), the parsed HR seeds the numpad and the
  // user only taps the rhythm / chest-pain / exercise pills. Optional —
  // tap-only entry still starts blank.
  initialHeartRate?: number;
}

type Field = "hr" | "pain";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
const HR_DIGIT_LIMIT = 3;
const PAIN_DIGIT_LIMIT = 2;

const RHYTHM_OPTIONS: readonly RhythmStatus[] = ["regular", "irregular", "unknown"];
const EXERCISE_OPTIONS: readonly ExerciseTolerance[] = ["normal", "reduced", "severe"];

export const CardiacInput = ({ onSubmit, initialHeartRate }: CardiacInputProps): JSX.Element => {
  const { t } = useTranslation();
  const [hr, setHr] = useState(initialHeartRate !== undefined ? String(initialHeartRate) : "");
  const [rhythm, setRhythm] = useState<RhythmStatus>("unknown");
  const [chestPain, setChestPain] = useState(false);
  const [pain, setPain] = useState("");
  const [exercise, setExercise] = useState<ExerciseTolerance>("normal");
  const [active, setActive] = useState<Field>("hr");

  // When chest pain is toggled OFF, clear any prior severity entry —
  // sending painSeverity with chestPain=false trips the server's
  // cross-field validator (400) and would be a confusing client-side
  // round-trip. Also swap focus back to HR.
  useEffect(() => {
    if (!chestPain) {
      setPain("");
      setActive("hr");
    } else {
      setActive("pain");
    }
  }, [chestPain]);

  const setForField = (field: Field, value: string): void => {
    if (field === "hr") setHr(value);
    else setPain(value);
  };

  const valueFor = (field: Field): string => (field === "hr" ? hr : pain);
  const limitFor = (field: Field): number => (field === "hr" ? HR_DIGIT_LIMIT : PAIN_DIGIT_LIMIT);

  const handlePress = (key: string): void => {
    const cur = valueFor(active);
    if (key === "C") return setForField(active, "");
    if (key === "⌫") return setForField(active, cur.slice(0, -1));
    if (cur.length >= limitFor(active)) return;
    setForField(active, cur + key);
  };

  const hrNum = Number.parseInt(hr, 10);
  const painNum = pain.length > 0 ? Number.parseInt(pain, 10) : null;

  const hrValid = Number.isFinite(hrNum) && hrNum >= HR_VALID_MIN && hrNum <= HR_VALID_MAX;
  const painValid =
    painNum === null || (painNum >= PAIN_SEVERITY_MIN && painNum <= PAIN_SEVERITY_MAX);
  // Chest pain is allowed without a severity (the server's classifier
  // conservatively treats null severity as 0 → warn band, never bypass).
  // The patient can flag "haan, dard hai" and submit before picking a
  // slider value.
  const canSubmit = hrValid && painValid;

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit({
      heartRate: hrNum,
      rhythmStatus: rhythm,
      chestPain,
      ...(chestPain && painNum !== null ? { painSeverity: painNum } : {}),
      exerciseTolerance: exercise,
    });
  };

  const renderNumpad = () => (
    <View className="flex-row flex-wrap justify-between mt-2 mb-2">
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
  );

  return (
    <View className="gap-4">
      {/* ── Heart-rate field + chips ─── */}
      <View>
        <FieldChip
          label={t("cardiac.heartRate")}
          suffix={t("cardiac.bpm")}
          value={hr}
          active={active === "hr"}
          invalid={hr.length > 0 && !hrValid}
          onPress={() => setActive("hr")}
        />
        {active === "hr" && renderNumpad()}
      </View>

      {/* ── Rhythm pills ─── */}
      <View className="gap-2">
        <Text className="text-body text-neutral dark:text-gray-400">
          {t("cardiac.rhythm.label")}
        </Text>
        <View className="flex-row gap-2">
          {RHYTHM_OPTIONS.map((option) => (
            <ChipToggle
              key={option}
              label={t(`cardiac.rhythm.${option}`)}
              selected={rhythm === option}
              onPress={() => setRhythm(option)}
            />
          ))}
        </View>
      </View>

      {/* ── Chest pain ─── */}
      <View className="gap-2">
        <Text className="text-body text-neutral dark:text-gray-400">
          {t("cardiac.chestPain.label")}
        </Text>
        <View className="flex-row gap-2">
          <ChipToggle
            label={t("cardiac.chestPain.no")}
            selected={!chestPain}
            onPress={() => setChestPain(false)}
          />
          <ChipToggle
            label={t("cardiac.chestPain.yes")}
            selected={chestPain}
            onPress={() => setChestPain(true)}
            tone="warn"
          />
        </View>
        {chestPain && (
          <View className="mt-2">
            <FieldChip
              label={t("cardiac.painSeverity.label")}
              suffix={t("cardiac.painSeverity.scale")}
              value={pain}
              active={active === "pain"}
              invalid={pain.length > 0 && !painValid}
              onPress={() => setActive("pain")}
            />
            {active === "pain" && renderNumpad()}
          </View>
        )}
      </View>

      {/* ── Exercise tolerance ─── */}
      <View className="gap-2">
        <Text className="text-body text-neutral dark:text-gray-400">
          {t("cardiac.exerciseTolerance.label")}
        </Text>
        <View className="flex-row gap-2">
          {EXERCISE_OPTIONS.map((option) => (
            <ChipToggle
              key={option}
              label={t(`cardiac.exerciseTolerance.${option}`)}
              selected={exercise === option}
              onPress={() => setExercise(option)}
            />
          ))}
        </View>
      </View>

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

      <Text className="text-body text-neutral dark:text-gray-400">{t("cardiac.rangeHint")}</Text>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Local primitives (kept inline rather than ui/* because their
// presentation is opinionated to the logging surface — a thin two-line
// chip card and a 3-up segment row. Reused only inside this file +
// RespiratoryInput; a future shared `LoggingChip` is fine to extract.)
// ─────────────────────────────────────────────────────────────

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
  // Warn-tone chip (chest-pain "yes") uses the amber/warning palette
  // even when unselected so the affordance hints at "this is the
  // serious option" before tap. Standard chips stay neutral.
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
