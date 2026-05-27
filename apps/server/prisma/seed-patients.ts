// Dev-bootstrap script: seeds 15 mock patient households with sample
// glucose readings, medications, etc. so the admin console has data
// to render against on a fresh local stack. Run with:
//
//   pnpm --filter @swasth/server db:seed:patients
//
// One-shot CLI script: console is the user-facing output channel.
/* eslint-disable no-console */

import {
  Gender,
  Language,
  Condition,
  Tier,
  GlucoseReadingType,
  ReadingSource,
} from "@prisma/client";
import { prisma, disconnectDatabase } from "../src/shared/database.js";
import crypto from "node:crypto";

async function main() {
  console.log("Cleaning up old patient seed data...");
  await prisma.user.deleteMany({
    where: { phone: { startsWith: "+919000000" } },
  });

  console.log("Seeding mock patients and data...");

  for (let i = 1; i <= 15; i++) {
    const household = await prisma.household.create({ data: {} });

    const user = await prisma.user.create({
      data: {
        name: `Test Patient ${i}`,
        phone: `+919000000${i.toString().padStart(3, "0")}`,
        age: 30 + i,
        gender: i % 2 === 0 ? Gender.female : Gender.male,
        preferredLanguage: i % 3 === 0 ? Language.hi : Language.en,
        conditions:
          i % 4 === 0 ? [Condition.diabetes, Condition.hypertension] : [Condition.diabetes],
        householdId: household.id,
        onboardingComplete: true,
        tier: i % 5 === 0 ? Tier.premium : i % 7 === 0 ? Tier.family : Tier.free,
      },
    });

    // Create a few glucose readings for each user
    for (let j = 0; j < 3; j++) {
      await prisma.glucoseReading.create({
        data: {
          clientUuid: crypto.randomUUID(),
          userId: user.id,
          valueMgDl: 90 + Math.floor(Math.random() * 50),
          readingType: GlucoseReadingType.fasting,
          source: ReadingSource.device,
          measuredAt: new Date(Date.now() - j * 86400000),
          streakCreditedTo: new Date(Date.now() - j * 86400000),
        },
      });
    }

    // Create chat session for premium users
    if (user.tier === Tier.premium) {
      await prisma.chatSession.create({
        data: {
          userId: user.id,
          language: Language.en,
          messages: {
            create: [
              {
                clientUuid: crypto.randomUUID(),
                userId: user.id,
                role: "user",
                content: "Is this food healthy?",
                language: Language.en,
                costTier: "sonnet",
              },
              {
                clientUuid: crypto.randomUUID(),
                userId: user.id,
                role: "assistant",
                content: "Yes, in moderation.",
                language: Language.en,
                costTier: "sonnet",
              },
            ],
          },
        },
      });
    }
  }

  console.log("Seeding patient data complete.");
}

main()
  .then(async () => {
    await disconnectDatabase();
  })
  .catch(async (e) => {
    console.error(e);
    await disconnectDatabase();
    process.exit(1);
  });
