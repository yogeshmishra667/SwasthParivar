import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AdminsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin users</h1>
        <p className="text-sm text-muted-foreground">
          RBAC + password reset land in M3-T7. The API is live at <code>/admin/admins</code>.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Coming in M3-T7</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          List, create, role-update, deactivate, and reset-password — super_admin only.
        </CardContent>
      </Card>
    </div>
  );
}
