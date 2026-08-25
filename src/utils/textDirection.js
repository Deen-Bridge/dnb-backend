const RTL_SCRIPTS = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * Detect text direction from string content.
 * Returns "rtl" if the first strong character is RTL, else "ltr".
 */
export function detectTextDirection(text) {
  if (!text || typeof text !== "string") return "ltr";

  for (const char of text) {
    if (RTL_SCRIPTS.test(char)) return "rtl";
    if (/[A-Za-z\u00C0-\u024F]/.test(char)) return "ltr";
  }

  return "ltr";
}

/**
 * Check whether a BCP-47 language code is an RTL language.
 */
export function isRTLLanguage(lang) {
  if (!lang || typeof lang !== "string") return false;
  const primary = lang.split("-")[0].toLowerCase();
  return ["ar", "ur", "fa", "he", "yi"].includes(primary);
}

/**
 * Return CSS dir attribute value for a language code.
 */
export function dirAttribute(lang) {
  return isRTLLanguage(lang) ? "rtl" : "ltr";
}

export default { detectTextDirection, isRTLLanguage, dirAttribute };
