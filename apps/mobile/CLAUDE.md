# SwasthParivar Mobile — Claude Code Instructions

## Scope

This file covers the mobile app (React Native + Expo). For backend, database, domain logic, testing, and edge cases, see the root `/CLAUDE.md`.

## Core Stack

- **Framework:** React Native + Expo (latest stable SDK, New Architecture mandatory)
- **Router:** Expo Router v4 (file-based navigation)
- **UI Framework:** NativeWind v4 (Tailwind for RN) + gluestack UI v3 (accessible headless components)
- **Charts:** Victory Native XL (Skia-accelerated)
- **Local DB:** WatermelonDB (SQLite-backed, offline-first)
- **i18n:** react-i18next + expo-localization
- **State:** Zustand (lightweight, no boilerplate)
- **Forms:** React Hook Form + Zod (shared validation with backend)

## Expo Packages

```
expo-router                  — file-based navigation
expo-notifications           — push + local scheduled notifications (med reminders)
expo-location                — GPS for SOS
expo-sensors                 — pedometer for activity tracking
expo-camera                  — prescription photo capture
expo-speech                  — TTS for elderly accessibility
expo-speech-recognition      — STT for voice logging
expo-localization            — device language detection
expo-haptics                 — tactile feedback on every save/milestone
expo-secure-store            — encrypted credential storage
expo-linking                 — deep links + emergency phone dialing
expo-local-authentication    — biometric auth (Phase 2+)
expo-keep-awake              — keep screen during SOS
```

## Peer Dependencies (for Victory Native XL)

```
react-native-skia            — GPU-accelerated chart rendering
react-native-reanimated      — smooth animations (charts, transitions, celebrations)
react-native-gesture-handler — pinch-to-zoom on trend charts
react-native-svg             — SVG rendering fallback
```

## Why These Choices

**NativeWind + gluestack over Tamagui:** Tamagui v2 is still RC with compiler bugs. NativeWind gives Tailwind DX (faster development). gluestack adds accessible, headless components with built-in WCAG support — critical for elderly users who need high contrast, large text, and screen reader compatibility. This is mobile-only, so Tamagui's web+native parity isn't needed.

**Zustand over Redux/Jotai:** Minimal boilerplate, works with React Native out of the box, supports persist middleware (for user preferences). The app's state is simple: active profile, onboarding step, sync status, notification state. No need for Redux's complexity.

**WatermelonDB over PowerSync:** Free, no vendor lock-in, built for React Native, handles 10K+ records. Sync protocol is manual but well-documented — implemented via root CLAUDE.md's sync endpoints.

## Project Structure

```
apps/mobile/
├── app/                          ← Expo Router file-based routes
│   ├── _layout.tsx               ← Root layout (providers, profile switcher)
│   ├── index.tsx                 ← Home/Dashboard
│   ├── (auth)/
│   │   ├── login.tsx             ← Phone OTP entry
│   │   └── verify.tsx            ← OTP verification
│   ├── (onboarding)/
│   │   ├── language.tsx
│   │   ├── condition.tsx
│   │   ├── profile.tsx           ← Name, age
│   │   ├── first-reading.tsx     ← First glucose log + celebration
│   │   └── medications.tsx       ← Optional med setup
│   ├── (tabs)/
│   │   ├── _layout.tsx           ← Tab navigation
│   │   ├── dashboard.tsx
│   │   ├── log.tsx               ← Voice + numpad logging
│   │   ├── medications.tsx
│   │   ├── insights.tsx          ← Phase 2+
│   │   └── settings.tsx
│   ├── reading/[id].tsx          ← Edit reading
│   ├── chat.tsx                  ← AI chat (Phase 3+)
│   └── sos.tsx                   ← SOS emergency screen
├── src/
│   ├── components/
│   │   ├── ui/                   ← Design system (gluestack-based)
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── Toast.tsx
│   │   ├── logging/
│   │   │   ├── VoiceInput.tsx
│   │   │   ├── NumpadInput.tsx
│   │   │   ├── ConfirmationScreen.tsx    ← MANDATORY: shows profile + type toggle
│   │   │   └── CriticalAlert.tsx         ← Fullscreen blocking alert
│   │   ├── dashboard/
│   │   │   ├── GlucoseChart.tsx          ← Victory Native XL
│   │   │   ├── StreakCard.tsx
│   │   │   ├── MedicationCard.tsx
│   │   │   └── QuickLogButton.tsx
│   │   ├── profile/
│   │   │   ├── ProfileSwitcher.tsx       ← Netflix-style avatars
│   │   │   └── ActiveProfileBadge.tsx    ← "👤 Ramesh ji" on all screens
│   │   └── shared/
│   │       ├── OfflineBanner.tsx
│   │       ├── SyncStatusBadge.tsx       ← "💾 Saved locally" / "☁️ Synced"
│   │       ├── TimeoutFallback.tsx       ← Max 10s spinner → fallback UI
│   │       └── UndoToast.tsx             ← 5s undo after save
│   ├── hooks/
│   │   ├── useActiveProfile.ts
│   │   ├── useVoiceInput.ts
│   │   ├── useStreak.ts
│   │   ├── useSyncStatus.ts
│   │   └── useAccessibility.ts          ← High contrast + large text
│   ├── stores/
│   │   ├── auth.store.ts                ← Zustand: token, user
│   │   ├── profile.store.ts             ← Zustand: active profile, household
│   │   └── preferences.store.ts         ← Zustand: language, accessibility, theme
│   ├── db/
│   │   ├── schema.ts                    ← WatermelonDB schema
│   │   ├── models/                      ← WatermelonDB model classes
│   │   │   ├── GlucoseReading.ts
│   │   │   ├── MedicationSchedule.ts
│   │   │   ├── MedicationLog.ts
│   │   │   └── UserStreak.ts
│   │   ├── sync.ts                      ← WatermelonDB ↔ backend sync
│   │   └── database.ts                  ← DB initialization
│   ├── services/
│   │   ├── api.ts                       ← Axios/fetch wrapper with auth
│   │   ├── notifications.ts             ← Push + local notification manager
│   │   └── analytics.ts                 ← PostHog wrapper
│   ├── i18n/
│   │   ├── config.ts
│   │   ├── hi.json                      ← Hindi translations
│   │   └── en.json                      ← English translations
│   └── utils/
│       ├── constants.ts                 ← Touch targets, font sizes, timeouts
│       └── haptics.ts                   ← Haptic feedback helper
├── assets/
│   ├── fonts/
│   └── images/
├── app.json
├── tailwind.config.js                   ← NativeWind config
└── package.json
```

## Design System Rules (ENFORCE)

### Accessibility (Elderly-First)

```
FONT_SIZE_BODY     = 14px minimum (16px preferred)
FONT_SIZE_IMPORTANT = 16px minimum
FONT_SIZE_NUMBERS  = 20px+ (glucose values, BP values)
FONT_SIZE_LARGE_MODE = 1.3× all above
TOUCH_TARGET_MIN   = 48dp × 48dp (Android Material guideline)
CONTRAST_RATIO     = 4.5:1 minimum (WCAG AA), 7:1 for high contrast mode (AAA)
```

### Themes

```ts
// Three modes, user-selectable:
type Theme = "light" | "dark" | "high-contrast";

// High contrast mode:
//   - Black background, white text, yellow accents
//   - Borders on ALL interactive elements (not just color differentiation)
//   - No gradients, no transparency
//   - 1.3x font scale automatically applied
```

### Color Palette

```
Primary:     #2563EB (blue-600) — trust, health
Success:     #16A34A (green-600) — good readings, streaks
Warning:     #D97706 (amber-600) — gentle alerts, elevated readings
Critical:    #DC2626 (red-600) — critical bypass, SOS
Neutral:     #6B7280 (gray-500) — secondary text
Background:  #F9FAFB (gray-50) light / #111827 (gray-900) dark

Celebration: #8B5CF6 (violet-500) — milestones, confetti
Streak:      #F59E0B (amber-500) — fire emoji, streak visuals
```

### Touch Interactions

- **Core flows: TAP ONLY.** No swipe, no long-press, no drag for logging/meds/dashboard.
- Swipe allowed for: tab navigation, chart scroll (non-critical).
- Every tappable: 48dp minimum, visual press feedback (opacity or scale).
- Haptic on: every save (light), celebrate (medium), milestone (heavy), critical alert (continuous).

### Animations

```ts
// Use react-native-reanimated for all animations
// Keep animations SHORT for elderly users:
ANIMATION_SAVE       = 200ms  // light scale bounce on save
ANIMATION_CELEBRATE  = 800ms  // sparkle/confetti on good reading
ANIMATION_MILESTONE  = 1500ms // fullscreen celebration
ANIMATION_TRANSITION = 250ms  // screen transitions
ANIMATION_CHART      = 300ms  // chart line drawing

// NEVER: auto-playing loops, flashing, parallax (motion sickness risk)
// Respect: AccessibilityInfo.isReduceMotionEnabled → skip all animations
```

## Component Patterns

### Every Screen Must:

1. Show `<ActiveProfileBadge />` in header — "👤 Ramesh ji"
2. Handle offline state — show `<OfflineBanner />` when no connection
3. Never show spinner > 10s — use `<TimeoutFallback />` wrapper
4. Never show blank screen — always cached/fallback content
5. Use `<SafeAreaView>` + proper keyboard avoidance

### Logging Screen Pattern

```tsx
// The logging screen is THE most important screen.
// It MUST follow this exact flow:

// 1. Profile check (top of screen, always visible)
<ActiveProfileBadge profile={activeProfile} />

// 2. Input method (side by side)
<VoiceInput />     // Big mic button, always visible
<NumpadInput />    // Auto-show numpad on voice fail

// 3. Confirmation (MANDATORY before save)
<ConfirmationScreen
  value={parsedValue}
  type={inferredType}         // with 1-tap toggle
  profile={activeProfile}     // "👤 Ramesh ji ke liye save ho raha hai"
  onConfirm={handleSave}
  onEdit={handleEdit}
/>

// 4. Post-save feedback
<FeedbackDisplay tone={feedback.tone} message={feedback.message} />
<UndoToast duration={5000} onUndo={handleUndo} />
```

### API Call Pattern

```ts
// EVERY API call uses this wrapper:
async function apiCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s max

  try {
    const result = await fn();
    clearTimeout(timeout);
    return result;
  } catch (error) {
    clearTimeout(timeout);
    Sentry.captureException(error);
    return fallback; // NEVER throw to UI — always return fallback
  }
}
```

## WatermelonDB Sync Protocol

```ts
// Sync follows WatermelonDB's push/pull protocol:
// POST /api/v1/sync/push   — send local changes to server
// GET  /api/v1/sync/pull    — pull server changes since last_synced_at

// Sync triggers:
// 1. App foreground (after 5+ min background)
// 2. After successful reading save (debounced 2s)
// 3. Manual pull-to-refresh on dashboard
// 4. Every 15 min while app is active

// Conflict resolution: per root CLAUDE.md (client_uuid + version)
// Sync errors: silent retry with exponential backoff. Never show to user.
// Offline: all logging works. Sync queues locally. Resumes on connectivity.
```

## Navigation Structure

```
(auth)          — unauthenticated stack
  login         — phone number entry
  verify        — OTP verification

(onboarding)    — post-auth, pre-app setup
  language → condition → profile → first-reading → medications

(tabs)          — main app (authenticated + onboarded)
  dashboard     — home: latest readings, streak, meds, chart
  log           — voice + numpad glucose logging
  medications   — schedule view + taken/skipped logging
  insights      — Phase 2+ (locked until Day 14)
  settings      — profile, accessibility, language, reminders

Modal routes:
  reading/[id]  — edit past reading (numpad pre-filled)
  chat          — AI chat (Phase 3+)
  sos           — emergency screen (fullscreen, blocking)
```

## Notification Handling

```ts
// Local notifications (work offline):
// - Medication reminders: scheduled at med setup time via expo-notifications
// - Streak risk: scheduled locally if streak ≥ 7 and no log today by 8 PM

// Push notifications (require backend):
// - Critical bypass alerts
// - Guardian alerts
// - Contextual reminders (best_log_time)

// On notification tap:
// - Med reminder → navigate to medications tab
// - Reading reminder → navigate to log tab with mic ready
// - Critical alert → navigate to critical alert screen
// - Guardian alert → navigate to patient dashboard (guardian app)

// Token management:
// - Register Expo push token on app launch + on token refresh
// - Store token on server: POST /api/v1/auth/push-token
```

## Testing (Mobile-Specific)

Use React Native Testing Library (RNTL). Test behavior, not rendered output.

**Critical test cases (from root CLAUDE.md):**

- VoiceConfirmation: profile name shown, type toggle works, 3s delay on extreme values
- ProfileSwitcher: mic locks switcher, recent switch → extra friction
- FailSafe UI: spinner never >10s, backend down → cached data + stale warning
- OfflineBanner: shows when offline >1hr
- CriticalAlert: fullscreen, cannot dismiss 30s, call button works

**No Detox (E2E) in Phase 1.** Add Phase 2+ once flows are stable.
**No snapshot tests.** Test behavior only.

## Performance Rules

- **FlatList for all lists** (readings history, medications). Never ScrollView for >20 items.
- **useMemo/useCallback** for chart data transformations. Victory Native XL re-renders are expensive.
- **Image optimization:** All prescription/medicine photos compressed via expo-image-manipulator before upload.
- **Bundle size:** Monitor with `npx expo-doctor`. Tree-shake unused Expo packages.
- **Startup:** Splash screen covers WatermelonDB initialization. Target <2s cold start.

## Build & Deploy

```
Development:  npx expo start          — local dev server
Preview:      eas build --profile preview --platform android
Production:   eas build --profile production --platform android
OTA Update:   eas update --branch production --message "description"
Submit:       eas submit --platform android
```

EAS Build profiles in `eas.json`. Free tier: 30 builds/month.
OTA updates (EAS Update) for JS-only changes — skip full build for bug fixes.

## What This File Does NOT Cover

These are in root `/CLAUDE.md`:

- Voice parser rules (Hindi dictionary, confidence, past-tense rejection)
- Streak engine (3AM boundary, grace period, anti-cheat)
- Feedback engine (same-type comparison, festive tag, noise floor)
- Critical bypass chain (4-step parallel execution, cooldown, escalation)
- Notification priority resolver + anti-fatigue
- Database schema and API routes
- All 22 edge case fixes
- Testing strategy (domain logic, integration, coverage targets)
