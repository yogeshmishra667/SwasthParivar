export type Condition = "diabetes" | "hypertension" | "asthma" | "cardiac";

export type Tier = "free" | "premium" | "family";

export interface User {
  id: string;
  name: string;
  age: number;
  gender?: "male" | "female" | "other";
  preferredLanguage: "hi" | "en";
  conditions: Condition[];
  timezone: string;
  householdId: string;
  onboardingComplete: boolean;
  onboardingStep: number;
  tier: Tier;
}
