import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Router } from "express";
import { QUEUE_NAMES, createQueue, type QueueName } from "./queue.js";

type Queue = ReturnType<typeof createQueue>;

// Memoize queue instances for the board
const boardQueues = new Map<QueueName, Queue>();

export const setupBullBoard = (): Router => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  const names = Object.values(QUEUE_NAMES);
  const adapters = names.map((name) => {
    let q = boardQueues.get(name);
    if (!q) {
      q = createQueue(name);
      boardQueues.set(name, q);
    }
    return new BullMQAdapter(q);
  });

  createBullBoard({
    queues: adapters,
    serverAdapter: serverAdapter,
  });

  return serverAdapter.getRouter() as Router;
};
