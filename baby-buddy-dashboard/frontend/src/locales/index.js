import en from "./en";
import es from "./es";

const languages = {
  en,
  es,
};

const browserLanguage = navigator.language.toLowerCase();

const currentLanguage = browserLanguage.startsWith("es")
  ? "es"
  : "en";

function getNestedValue(obj, path) {
  return path
    .split(".")
    .reduce((value, key) => value?.[key], obj);
}

export function t(key, params) {
  let translated = getNestedValue(
    languages[currentLanguage],
    key,
  );

  if (translated === undefined) {
    translated = getNestedValue(languages.en, key);
  }

  if (translated === undefined) {
    console.warn(`Missing translation: ${key}`);
    return key;
  }

  if (params) {
    Object.entries(params).forEach(([paramKey, value]) => {
      translated = translated.replaceAll(
        `{${paramKey}}`,
        String(value),
      );
    });
  }

  return translated;
}
