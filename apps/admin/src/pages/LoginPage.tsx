import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AlertCircle, ArrowLeft } from "lucide-react";
import type { AdminLoginResult, AdminTotpEnrollment } from "@swasth/shared-types";
import { adminApi } from "@/api/endpoints";
import { useAuth } from "@/auth/auth-context";
import { humanizeApiError } from "@/lib/errorMessage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Three-stage flow — password → TOTP (existing) OR enrolment → token.
type Stage =
  | { kind: "password" }
  | { kind: "totp"; challengeToken: string }
  | { kind: "enroll"; challengeToken: string; enrollment: AdminTotpEnrollment };

const credentialsSchema = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

const stageCopy = (stage: Stage): string => {
  switch (stage.kind) {
    case "password":
      return "Sign in with your admin email + password.";
    case "totp":
      return "Enter the 6-digit code from your authenticator app.";
    case "enroll":
      return "Scan the QR in your authenticator app, then confirm the 6-digit code.";
  }
};

const TOTP_LENGTH = 6;

export function LoginPage() {
  const [stage, setStage] = useState<Stage>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const auth = useAuth();
  const navigate = useNavigate();

  // Used to guard auto-submit from racing the user's first valid digit-only typing.
  const autoSubmittedRef = useRef(false);

  const resetToPassword = (): void => {
    setStage({ kind: "password" });
    setCode("");
    setError(null);
    autoSubmittedRef.current = false;
  };

  const advance = async (result: AdminLoginResult): Promise<void> => {
    switch (result.stage) {
      case "totp_required":
        setStage({ kind: "totp", challengeToken: result.challengeToken });
        setCode("");
        autoSubmittedRef.current = false;
        break;
      case "totp_enrollment_required": {
        const enrollment = await adminApi.totpEnroll(result.challengeToken);
        setStage({
          kind: "enroll",
          challengeToken: result.challengeToken,
          enrollment,
        });
        setCode("");
        autoSubmittedRef.current = false;
        break;
      }
      case "authenticated":
        auth.signIn({ accessToken: result.accessToken, admin: result.admin });
        await navigate({ to: "/" });
        break;
    }
  };

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      if (stage.kind === "password") {
        // Surface field errors inline rather than as a toast — keeps the
        // user's eye in the form.
        const parsed = credentialsSchema.safeParse({ email, password });
        if (!parsed.success) {
          const flat = z.flattenError(parsed.error);
          setEmailError(flat.fieldErrors.email?.[0] ?? null);
          setPasswordError(flat.fieldErrors.password?.[0] ?? null);
          return;
        }
        setEmailError(null);
        setPasswordError(null);
        await advance(await adminApi.login(parsed.data.email, parsed.data.password));
      } else if (stage.kind === "totp") {
        await advance(await adminApi.totpVerify(stage.challengeToken, code));
      } else {
        await advance(await adminApi.totpConfirm(stage.challengeToken, code));
      }
    } catch (err) {
      setError(humanizeApiError(err, "Sign-in failed."));
      // If a TOTP attempt fails, clear the code so the user can retype
      // without manually selecting + deleting.
      if (stage.kind !== "password") setCode("");
      autoSubmittedRef.current = false;
    } finally {
      setBusy(false);
    }
  };

  // Auto-submit the second the 6-digit code is fully entered.
  useEffect(() => {
    if (stage.kind === "password") return;
    if (code.length !== TOTP_LENGTH) {
      autoSubmittedRef.current = false;
      return;
    }
    if (autoSubmittedRef.current || busy) return;
    autoSubmittedRef.current = true;
    void submit();
    // We intentionally exclude `submit` — it captures state via closure;
    // re-creating it would loop. The guard ref keeps double-submits out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, stage.kind]);

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void submit();
  };

  const buttonLabel = busy
    ? "Working…"
    : stage.kind === "password"
      ? "Sign in"
      : stage.kind === "enroll"
        ? "Confirm & sign in"
        : "Verify";

  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            {stage.kind !== "password" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={resetToPassword}
                disabled={busy}
                aria-label="Start over"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <div>
              <CardTitle>Sign in to admin console</CardTitle>
              <CardDescription>{stageCopy(stage)}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            {error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {stage.kind === "password" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.currentTarget.value);
                      if (emailError) setEmailError(null);
                    }}
                    disabled={busy}
                    aria-invalid={emailError !== null}
                  />
                  {emailError ? <p className="text-xs text-destructive">{emailError}</p> : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.currentTarget.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    disabled={busy}
                    aria-invalid={passwordError !== null}
                  />
                  {passwordError ? (
                    <p className="text-xs text-destructive">{passwordError}</p>
                  ) : null}
                </div>
              </>
            ) : null}

            {stage.kind === "enroll" ? (
              <div className="flex flex-col items-center gap-2 rounded-md border bg-card p-4">
                <img src={stage.enrollment.qrDataUrl} alt="TOTP QR code" className="h-44 w-44" />
                <p className="text-xs text-muted-foreground">
                  Or enter this secret manually:{" "}
                  <code className="font-mono">{stage.enrollment.secret}</code>
                </p>
              </div>
            ) : null}

            {stage.kind === "totp" || stage.kind === "enroll" ? (
              <div className="space-y-1.5">
                <Label htmlFor="code">6-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={TOTP_LENGTH}
                  value={code}
                  autoFocus
                  className="text-center font-mono tracking-[0.4em]"
                  onChange={(e) => {
                    setCode(e.currentTarget.value.replace(/\D/g, "").slice(0, TOTP_LENGTH));
                  }}
                  disabled={busy}
                />
                <p className="text-xs text-muted-foreground">
                  Submits automatically once 6 digits are entered.
                </p>
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={busy}>
              {buttonLabel}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
