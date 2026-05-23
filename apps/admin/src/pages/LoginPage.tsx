import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { AdminLoginResult, AdminTotpEnrollment } from "@swasth/shared-types";
import { ApiClientError } from "@/api/client";
import { adminApi } from "@/api/endpoints";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Three-stage flow — password → TOTP (existing) OR enrolment → token. M3-T1
// will polish copy, error states, recovery hints; this MVP is enough to
// drive end-to-end sign-in against the server.
type Stage =
  | { kind: "password" }
  | { kind: "totp"; challengeToken: string }
  | { kind: "enroll"; challengeToken: string; enrollment: AdminTotpEnrollment };

const stageCopy = (stage: Stage): string => {
  switch (stage.kind) {
    case "password":
      return "Enter your email and password.";
    case "totp":
      return "Enter the 6-digit code from your authenticator app.";
    case "enroll":
      return "Scan the QR code in your authenticator app, then enter the 6-digit code below.";
  }
};

export function LoginPage() {
  const [stage, setStage] = useState<Stage>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const auth = useAuth();
  const navigate = useNavigate();

  const advance = async (result: AdminLoginResult): Promise<void> => {
    switch (result.stage) {
      case "totp_required":
        setStage({ kind: "totp", challengeToken: result.challengeToken });
        setCode("");
        break;
      case "totp_enrollment_required": {
        const enrollment = await adminApi.totpEnroll(result.challengeToken);
        setStage({ kind: "enroll", challengeToken: result.challengeToken, enrollment });
        setCode("");
        break;
      }
      case "authenticated":
        auth.signIn({ accessToken: result.accessToken, admin: result.admin });
        await navigate({ to: "/" });
        break;
    }
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      if (stage.kind === "password") {
        await advance(await adminApi.login(email, password));
      } else if (stage.kind === "totp") {
        await advance(await adminApi.totpVerify(stage.challengeToken, code));
      } else {
        await advance(await adminApi.totpConfirm(stage.challengeToken, code));
      }
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Sign-in failed.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to admin console</CardTitle>
          <CardDescription>{stageCopy(stage)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              void submit(e);
            }}
          >
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
                    }}
                  />
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
                    }}
                  />
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
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    setCode(e.currentTarget.value.replace(/\D/g, ""));
                  }}
                />
              </div>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Working…" : stage.kind === "password" ? "Sign in" : "Verify"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
