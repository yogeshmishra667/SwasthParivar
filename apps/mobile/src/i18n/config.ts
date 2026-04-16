import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import en from "./en.json";
import hi from "./hi.json";

const deviceLocale = getLocales()[0]?.languageCode ?? "hi";
const initialLanguage = deviceLocale === "en" ? "en" : "hi";

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
  },
  lng: initialLanguage,
  fallbackLng: "hi",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export { i18n };
