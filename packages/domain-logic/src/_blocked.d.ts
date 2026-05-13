// Stub for domain-logic purity enforcement. tsconfig `paths` redirects
// every forbidden module (Prisma, Redis, BullMQ, Express, axios, node:fs,
// etc.) here. The stub exports nothing, so any named import resolves to
// `undefined` and any default import errors at compile time.
//
// This is defense-in-depth alongside the `/verify` grep. The grep catches
// import strings; this file fails the typecheck before the grep ever runs.
export {};
