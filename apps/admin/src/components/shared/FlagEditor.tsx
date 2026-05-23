import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  detectFlagKind,
  type CohortOrPercentageRollout,
  type CohortRollout,
  type FlagEditorKind,
  type FlagValue,
  type PercentageRollout,
} from "@/flags/types";

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
        <Input
          placeholder="Add user ID"
          value={draft}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
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

function RawEditor({ value, onChange }: EditorProps<Record<string, unknown>>) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const apply = (next: string): void => {
    setText(next);
    try {
      const parsed: unknown = JSON.parse(next);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("flag value must be a JSON object");
      }
      onChange(parsed as Record<string, unknown>);
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
  switch (kind) {
    case "boolean":
      return <BooleanEditor value={value as boolean} onChange={onChange} />;
    case "percentage":
      return <PercentageEditor value={value as PercentageRollout} onChange={onChange} />;
    case "cohort":
      return <CohortEditor value={value as CohortRollout} onChange={onChange} />;
    case "cohort_or_percentage":
      return (
        <CohortOrPercentageEditor value={value as CohortOrPercentageRollout} onChange={onChange} />
      );
    case "raw":
      return <RawEditor value={value as Record<string, unknown>} onChange={onChange} />;
  }
}
