import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    auth?: {
      sub: string;
      householdId: string;
    };
  }
}
