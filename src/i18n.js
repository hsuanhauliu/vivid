import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-TW': { translation: zhTW },
      zh: { translation: zhTW }, // map 'zh' → Traditional Chinese
      ja: { translation: ja },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      // Check user-saved preference first, then macOS system language via navigator
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'vivid-language',
      // Don't let the detector write the *detected* navigator language (e.g.
      // "en-US") back into vivid-language. That key represents the user's
      // explicit choice only ('' = system default); SettingsPage owns it.
      caches: [],
    },
  });

export default i18n;
