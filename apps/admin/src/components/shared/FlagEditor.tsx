import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  detectFlagKind,
  type CohortOrPercentageRollout,
  type CohortRollout,
  type FlagEditorKind,
  type FlagValue,
  type PercentageRollout,
  type RolloutConfig,
} from "@/flags/types";
import { UserSearchInput } from "@/components/shared/UserSearchInput";

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

interface EditorProps<T extends FlagValue> {
  value: T;
  onChange: (next: T) => void;
}

function BooleanEditor({ value, onChange }: EditorProps<boolean>) {
  return (
    <div className="flex items-center gap-3">
      <Switch checked={value} onCheckedChange={onChange} />
      <span className="text-sm">
        {value ? "Enabled (on for everyone)" : "Disabled (off for everyone)"}
      </span>
    </div>
  );
}

function PercentageEditor({ value, onChange }: EditorProps<PercentageRollout>) {
  const setPercent = (p: number): void => {
    onChange({ ...value, percent: clamp(p, 0, 100) });
  };
  return (
    <div className="flex items-center gap-3">
      <Slider
        min={0}
        max={100}
        step={1}
        value={value.percent}
        onChange={(e) => {
          setPercent(Number(e.currentTarget.value));
        }}
      />
      <span className="w-12 text-right text-sm font-medium tabular-nums">{value.percent}%</span>
    </div>
  );
}

function CohortEditor({ value, onChange }: EditorProps<CohortRollout>) {
  const [draft, setDraft] = useState("");
  const add = (): void => {
    const id = draft.trim();
    if (!id || value.userIds.includes(id)) {
      setDraft("");
      return;
    }
    onChange({ ...value, userIds: [...value.userIds, id] });
    setDraft("");
  };
  const remove = (id: string): void => {
    onChange({ ...value, userIds: value.userIds.filter((x) => x !== id) });
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <UserSearchInput
          className="flex-1"
          value={draft}
          onChange={setDraft}
          onSelect={add}
          placeholder="Search by name, phone, or enter user ID"
        />
        <Button type="button" variant="outline" onClick={add}>
          Add
        </Button>
      </div>
      {value.userIds.length === 0 ? (
        <p className="text-xs text-muted-foreground">No users in cohort yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {value.userIds.map((id) => (
            <li key={id}>
              <Badge
                variant="secondary"
                className="cursor-pointer"
                onClick={() => {
                  remove(id);
                }}
              >
                {id} ×
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CohortOrPercentageEditor({ value, onChange }: EditorProps<CohortOrPercentageRollout>) {
  return (
    <div className="space-y-4">
      <div>
        <Label className="mb-2 block">Percent rollout</Label>
        <PercentageEditor
          value={{ rollout: "percentage", percent: value.percent }}
          onChange={(p) => {
            onChange({ ...value, percent: p.percent });
          }}
        />
      </div>
      <Separator />
      <div>
        <Label className="mb-2 block">Cohort allowlist</Label>
        <CohortEditor
          value={{ rollout: "cohort", userIds: value.userIds }}
          onChange={(c) => {
            onChange({ ...value, userIds: c.userIds });
          }}
        />
      </div>
    </div>
  );
}

function RawEditor({ value, onChange }: EditorProps<Exclude<FlagValue, boolean | RolloutConfig>>) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const apply = (next: string): void => {
    setText(next);
    try {
      if (!next.trim()) {
        throw new Error("Cannot be empty");
      }
      const parsed: unknown = JSON.parse(next);
      onChange(parsed as Exclude<FlagValue, boolean | RolloutConfig>);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "invalid JSON");
    }
  };
  return (
    <div className="space-y-2">
      <textarea
        className="min-h-[140px] w-full rounded-md border bg-transparent p-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          apply(e.currentTarget.value);
        }}
      />
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
    </div>
  );
}

/**
 * Kind-keyed registry of flag-value editors. The plan calls for adding
 * a new editor (e.g. a Phase 4 `tier` rollout) to mean exactly one new
 * entry here — no rewrite of the page. Components are typed-narrow on
 * the underlying value shape; the public `<FlagEditor>` below picks one
 * based on `detectFlagKind`.
 */
export const flagEditorRegistry = {
  boolean: BooleanEditor,
  percentage: PercentageEditor,
  cohort: CohortEditor,
  cohort_or_percentage: CohortOrPercentageEditor,
  raw: RawEditor,
} as const;

interface FlagEditorProps {
  value: FlagValue;
  onChange: (next: FlagValue) => void;
}

/**
 * The single component pages render — it dispatches on the value's kind
 * and forwards to the matching registry entry. `onChange` receives a
 * fully-formed new `FlagValue`; the parent decides when to PUT.
 */
export function FlagEditor({ value, onChange }: FlagEditorProps) {
  const kind: FlagEditorKind = detectFlagKind(value);

  const handleKindChange = (newKind: string) => {
    if (newKind === kind) return;
    switch (newKind) {
      case "boolean":
        onChange(false);
        break;
      case "percentage":
        onChange({ rollout: "percentage", percent: 0 });
        break;
      case "cohort":
        onChange({ rollout: "cohort", userIds: [] });
        break;
      case "cohort_or_percentage":
        onChange({ rollout: "cohort_or_percentage", percent: 0, userIds: [] });
        break;
      case "raw":
        onChange({});
        break;
    }
  };

  const renderEditor = () => {
    switch (kind) {
      case "boolean":
        return <BooleanEditor value={value as boolean} onChange={onChange} />;
      case "percentage":
        return <PercentageEditor value={value as PercentageRollout} onChange={onChange} />;
      case "cohort":
        return <CohortEditor value={value as CohortRollout} onChange={onChange} />;
      case "cohort_or_percentage":
        return (
          <CohortOrPercentageEditor
            value={value as CohortOrPercentageRollout}
            onChange={onChange}
          />
        );
      case "raw":
        return (
          <RawEditor
            value={value as Exclude<FlagValue, boolean | RolloutConfig>}
            onChange={onChange}
          />
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Flag Type</Label>
        <Select value={kind} onValueChange={handleKindChange}>
          <SelectTrigger className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="boolean">Boolean (Global On/Off)</SelectItem>
            <SelectItem value="percentage">Percentage Rollout</SelectItem>
            <SelectItem value="cohort">Cohort (Allowlist)</SelectItem>
            <SelectItem value="cohort_or_percentage">Cohort + Percentage</SelectItem>
            <SelectItem value="raw">Raw Data / String</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-md border p-4 bg-card">{renderEditor()}</div>
    </div>
  );
}
