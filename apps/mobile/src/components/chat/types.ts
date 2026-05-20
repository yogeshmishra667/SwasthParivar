// Phase 3 — AI Chat mobile component prop types (phase3.md M.1).
//
// Prop signatures are taken verbatim from the M.1 component-tree spec.
// DTO/transport types live in `src/services/chat.ts`.

import type { ReactNode } from "react";

export interface MessageBubbleProps {
  message: { id: string; content: string; role: "user" | "assistant"; createdAt: string };
  tier?: "template" | "cached" | "sonnet";
  flagged: boolean;
  flaggedByUser: boolean;
  onFlag: (messageId: string) => void;
  onLongPress?: (messageId: string) => void; // copy / share
}

export interface ChatInputBarProps {
  onSend: (text: string) => Promise<void>;
  disabled: boolean;
  dailyRemaining: number; // 0 → shows rate-limit message instead of input
  isOffline: boolean; // disables send, shows "wait for online" hint
}

export interface EmergencyChatGuardProps {
  criticalBypassActive: boolean;
  onResolveCritical: () => void; // opens existing critical bypass screen
  children: ReactNode;
}
