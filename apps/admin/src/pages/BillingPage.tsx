import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function BillingPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing &amp; plans</h1>
        <p className="text-sm text-muted-foreground">
          Tier distribution + tier-change audit ship in M3-T9. Subscription / payment surfaces
          arrive with Phase 4 (Razorpay + Apple IAP).
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Scaffolded for Phase 4</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The console's registries are designed to absorb Subscription / Payment models when they
          land — see docs/admin-dashboard-plan.md "Monetization readiness".
        </CardContent>
      </Card>
    </div>
  );
}
