import i18next from 'i18next';
import arTranslations from './locales/ar.json' assert { type: 'json' };
import urTranslations from './locales/ur.json' assert { type: 'json' };
import msTranslations from './locales/ms.json' assert { type: 'json' };
import enTranslations from './locales/en.json' assert { type: 'json' };

const resources = {
  en: {
    translation: enTranslations,
  },
  ar: {
    translation: arTranslations,
  },
  ur: {
    translation: urTranslations,
  },
  ms: {
    translation: msTranslations,
  },
};

i18next.init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  debug: false,
  interpolation: {
    escapeValue: false,
  },
});

export const changeLanguage = (lng: string) => {
  return i18next.changeLanguage(lng);
};

export const getCurrentLanguage = () => {
  return i18next.language;
};

export const t = (key: string, options?: any) => {
  return i18next.t(key, options);
};

export default i18next;
