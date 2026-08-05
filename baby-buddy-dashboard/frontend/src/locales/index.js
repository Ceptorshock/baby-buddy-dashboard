import es from "./es";

function getNestedValue(obj, path) {
  return path
    .split(".")
    .reduce((value, key) => value?.[key], obj);
}

export function t(key, params) {
  let translated = getNestedValue(es, key);

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
