import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import es from './locales/es.json';
import zhCN from './locales/zh-CN.json';
import ko from './locales/ko.json';
import hi from './locales/hi.json';
import vi from './locales/vi.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import pt from './locales/pt.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-TW': { translation: zhTW },
      zh: { translation: zhTW }, // map 'zh' → Traditional Chinese
      ja: { translation: ja },
      es: { translation: es },
      'zh-CN': { translation: zhCN },
      ko: { translation: ko },
      hi: { translation: hi },
      vi: { translation: vi },
      fr: { translation: fr },
      de: { translation: de },
      pt: { translation: pt },
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
