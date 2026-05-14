import Constants, { AppOwnership } from "expo-constants";

/**
 * True when running inside Expo Go (the sandboxed Expo client).
 *
 * Many native modules — `expo-speech-recognition`, `expo-notifications`
 * (remote-only APIs), WatermelonDB's SQLite adapter — are not bundled
 * into Expo Go on Android. Callers gate side-effects behind this flag
 * so the bundle loads cleanly and degrades to fallback UX.
 */
export const isExpoGo: boolean = Constants.appOwnership === AppOwnership.Expo;
