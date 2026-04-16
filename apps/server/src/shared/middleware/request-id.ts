import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header("x-request-id");
  req.requestId = incoming && incoming.length > 0 ? incoming : uuidv4();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};
