import auth, { type FirebaseAuthTypes } from "@react-native-firebase/auth";

/**
 * Firebase Phone Auth wrapper. Used ONLY when the server returns
 * `otpProvider: "firebase"` from /auth/config — see auth-config.ts.
 * For "whatsapp" and "log" providers the screens take a different
 * branch entirely.
 *
 * Why a module-level singleton for `pending`: the auth flow spans two
 * screens (login → verify), and the ConfirmationResult object is not
 * serializable so we can't push it through router params. Auth is
 * inherently single-flight (one phone number at a time), so a module
 * singleton is the simplest fit. cancelPendingFirebaseAuth() must be
 * called if the user backs out of the verify screen to avoid a stale
 * confirmation lingering across attempts.
 */

let pending: FirebaseAuthTypes.ConfirmationResult | null = null;

export const startFirebasePhoneAuth = async (phoneE164: string): Promise<void> => {
  // signInWithPhoneNumber triggers SafetyNet/Play Integrity on Android
  // (silent if the device is genuine, falls back to SMS otherwise) and
  // a silent reCAPTCHA on iOS. Errors here include
  // - auth/invalid-phone-number   (bad format — should be caught client-side)
  // - auth/too-many-requests      (Firebase rate limit per number)
  // - auth/missing-client-identifier (Firebase project missing iOS/Android config)
  pending = await auth().signInWithPhoneNumber(phoneE164);
};

/**
 * Confirm the SMS code the user typed. Returns a fresh Firebase ID
 * token for the resulting authenticated user — POST that to
 * /api/v1/auth/verify-firebase so the server can verify it and mint our
 * own JWT pair. We force-refresh the token to avoid sending a stale
 * one if anything else (rare) signed the user in during this session.
 */
export const confirmFirebaseOtp = async (otp: string): Promise<string> => {
  if (!pending) {
    throw new Error("No pending Firebase verification — restart the login flow.");
  }
  await pending.confirm(otp);
  const current = auth().currentUser;
  if (!current) {
    throw new Error("Firebase sign-in succeeded but no current user is set.");
  }
  const idToken = await current.getIdToken(/* forceRefresh */ true);
  pending = null;
  return idToken;
};

export const cancelPendingFirebaseAuth = (): void => {
  pending = null;
};

/**
 * Sign the user out of Firebase. Called when our own JWTs are cleared
 * (logout) so the next login starts fresh. Firebase keeps its own
 * session independent of ours; without this, currentUser stays set
 * forever and confirmFirebaseOtp would return a stale ID token.
 */
export const signOutFirebase = async (): Promise<void> => {
  try {
    if (auth().currentUser) {
      await auth().signOut();
    }
  } catch {
    // Best-effort cleanup — never block app-level logout on this.
  }
};
