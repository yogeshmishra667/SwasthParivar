// Side-effecting module — importing this starts a BullMQ listener.
// Tests should import `./sos-escalation.processor.js` instead.
import type { Worker } from "bullmq";
import { createWorker, QUEUE_NAMES } from "../shared/queue.js";
import { processSOSEscalation, type SOSEscalationJob } from "./sos-escalation.processor.js";

export type { SOSEscalationJob } from "./sos-escalation.processor.js";

export const sosEscalationWorker: Worker<SOSEscalationJob> = createWorker<SOSEscalationJob>(
  QUEUE_NAMES.SOS_ESCALATION,
  processSOSEscalation,
);
