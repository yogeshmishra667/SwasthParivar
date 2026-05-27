import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, KeyRound, Pencil, Plus } from "lucide-react";
import type { AdminRole, AdminUserDto } from "@swasth/shared-types";
import { useAdmins, useCreateAdmin, useResetAdminPassword, useUpdateAdmin } from "@/api/queries";
import { useAuth } from "@/auth/auth-context";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { humanizeApiError } from "@/lib/errorMessage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ROLES: readonly AdminRole[] = ["analyst", "support", "ops", "super_admin"];

// ── Create dialog ─────────────────────────────────────────────────

interface CreateAdminDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateAdminDialog({ open, onOpenChange }: CreateAdminDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("support");
  const [password, setPassword] = useState("");
  const mutation = useCreateAdmin();

  const reset = (): void => {
    setEmail("");
    setName("");
    setRole("support");
    setPassword("");
  };

  const submit = async (): Promise<void> => {
    try {
      await mutation.mutateAsync({ email, name, role, password });
      toast.success(`Admin "${email}" created. They must enrol TOTP on first login.`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(humanizeApiError(err, "Could not create admin."));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New admin account</DialogTitle>
          <DialogDescription>
            The new admin signs in with this password, then enrols TOTP on their first login.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="create-email">Email</Label>
            <Input
              id="create-email"
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.currentTarget.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-name">Name</Label>
            <Input
              id="create-name"
              required
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v as AdminRole);
              }}
            >
              <SelectTrigger id="create-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-password">Initial password</Label>
            <Input
              id="create-password"
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(e) => {
                setPassword(e.currentTarget.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Share this securely with the operator; they should change it after login.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create admin"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────

interface EditAdminDialogProps {
  admin: AdminUserDto | null;
  onOpenChange: (open: boolean) => void;
  isSelf: boolean;
}

function EditAdminDialog({ admin, onOpenChange, isSelf }: EditAdminDialogProps) {
  const [role, setRole] = useState<AdminRole>(admin?.role ?? "support");
  const [active, setActive] = useState<boolean>(admin?.active ?? true);
  const mutation = useUpdateAdmin();

  // When the dialog opens for a different admin, re-seed local state.
  // (We key the dialog by admin.id externally instead to avoid this.)
  if (admin && (admin.role !== role || admin.active !== active)) {
    // no-op — keep local edits; user reopens to discard
  }

  const submit = async (): Promise<void> => {
    if (!admin) return;
    const body: { id: string; role?: AdminRole; active?: boolean } = { id: admin.id };
    if (role !== admin.role) body.role = role;
    if (active !== admin.active) body.active = active;
    if (body.role === undefined && body.active === undefined) {
      onOpenChange(false);
      return;
    }
    try {
      await mutation.mutateAsync(body);
      toast.success("Admin updated.");
      onOpenChange(false);
    } catch (err) {
      toast.error(humanizeApiError(err, "Update failed."));
    }
  };

  return (
    <Dialog
      open={admin !== null}
      onOpenChange={(o) => {
        if (!o) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {admin?.name ?? ""}</DialogTitle>
          <DialogDescription>{admin?.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-role">Role</Label>
            <Select
              value={role}
              disabled={isSelf}
              onValueChange={(v) => {
                setRole(v as AdminRole);
              }}
            >
              <SelectTrigger id="edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf ? (
              <p className="text-xs text-muted-foreground">
                You can't change your own role — ask another super_admin.
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Active</Label>
              <p className="text-xs text-muted-foreground">Deactivated admins cannot sign in.</p>
            </div>
            <Switch checked={active} disabled={isSelf} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              void submit();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reset password dialog ─────────────────────────────────────────

interface ResetPasswordDialogProps {
  admin: AdminUserDto | null;
  onOpenChange: (open: boolean) => void;
}

function ResetPasswordDialog({ admin, onOpenChange }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const mutation = useResetAdminPassword();

  const submit = async (): Promise<void> => {
    if (!admin) return;
    try {
      await mutation.mutateAsync({ id: admin.id, password });
      toast.success("Password reset. Share it with the operator securely.");
      setPassword("");
      onOpenChange(false);
    } catch (err) {
      toast.error(humanizeApiError(err, "Reset failed."));
    }
  };

  return (
    <Dialog
      open={admin !== null}
      onOpenChange={(o) => {
        if (!o) {
          setPassword("");
          onOpenChange(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password — {admin?.name ?? ""}</DialogTitle>
          <DialogDescription>
            Sets a new password. The operator should change it again after they sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reset-password">New password</Label>
          <Input
            id="reset-password"
            type="password"
            minLength={12}
            value={password}
            onChange={(e) => {
              setPassword(e.currentTarget.value);
            }}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              void submit();
            }}
            disabled={mutation.isPending || password.length < 12}
          >
            {mutation.isPending ? "Resetting…" : "Reset password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────

export function AdminsPage() {
  const { admin: me } = useAuth();
  const { data, isLoading, isError, error } = useAdmins();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUserDto | null>(null);
  const [resetting, setResetting] = useState<AdminUserDto | null>(null);

  return (
    <AccessDenied allow={["super_admin"]}>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">Admin users</h1>
            <p className="text-sm text-muted-foreground">
              Staff accounts with console access. Super-admin only.
            </p>
          </header>
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New admin
          </Button>
        </div>

        {isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load admins</AlertTitle>
            <AlertDescription>{humanizeApiError(error)}</AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>TOTP</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ) : !data || data.admins.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No admins.
                  </TableCell>
                </TableRow>
              ) : (
                data.admins.map((a) => {
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="font-mono text-xs">{a.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.active ? "success" : "secondary"}>
                          {a.active ? "active" : "disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.totpEnabled ? "success" : "warning"}>
                          {a.totpEnabled ? "enrolled" : "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(a);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setResetting(a);
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            Reset
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <CreateAdminDialog open={creating} onOpenChange={setCreating} />
        <EditAdminDialog
          admin={editing}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          isSelf={editing?.id === me?.id}
        />
        <ResetPasswordDialog
          admin={resetting}
          onOpenChange={(o) => {
            if (!o) setResetting(null);
          }}
        />
      </div>
    </AccessDenied>
  );
}
