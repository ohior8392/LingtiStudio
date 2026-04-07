"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Locale = "zh" | "en";

type LanguageContextValue = {
  locale: Locale;
  isZh: boolean;
  setLocale: (locale: Locale) => void;
};

const LANGUAGE_STORAGE_KEY = "lingti.locale";

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh");

  useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "zh" || stored === "en") {
      setLocaleState(stored);
      return;
    }

    const nextLocale: Locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
    setLocaleState(nextLocale);
  }, []);

  function setLocale(locale: Locale) {
    setLocaleState(locale);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  }

  const value = useMemo(
    () => ({
      locale,
      isZh: locale === "zh",
      setLocale,
    }),
    [locale]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return context;
}

