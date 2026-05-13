import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

// Express 5 made `req.query` a lazy getter — each access reparses the
// URL, so `Object.assign(req.query, …)` mutates a throwaway object and
// the writes are lost. We replace the property descriptor with a cached
// getter that returns the validated/transformed payload, so downstream
// controllers see Zod's transformed output (e.g. "false" → false) on
// every read. `req.params` behaves the same way under Express 5; both
// helpers below use the same pattern.
//
// `req.body` is set by `express.json()` and is a plain own-property,
// so a straight assignment works for `validateBody`.

const replaceRequestProperty = <T>(req: Request, key: "query" | "params", value: T): void => {
  Object.defineProperty(req, key, {
    configurable: true,
    enumerable: true,
    get: () => value,
  });
};

export const validateBody =
  <S extends ZodTypeAny>(schema: S) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body);
    next();
  };

export const validateQuery =
  <S extends ZodTypeAny>(schema: S) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req.query);
    replaceRequestProperty(req, "query", parsed);
    next();
  };

export const validateParams =
  <S extends ZodTypeAny>(schema: S) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req.params);
    replaceRequestProperty(req, "params", parsed);
    next();
  };
