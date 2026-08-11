/**
 * Server-side password policy — the actual security boundary.
 *
 * This is a deliberate mirror of dnb-frontend/lib/validation/password.js. The
 * browser copy exists to give live feedback while typing; this copy is what
 * stops a weak password, since anything client-side can be skipped by posting
 * straight to the API. Keep the two in sync — same rules, same wording, so a
 * user never sees the form accept something the server then rejects.
 *
 * Note: validation has to happen here, before hashing. A `minlength` on the
 * User model would measure the bcrypt hash, not the password.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

// bcrypt truncates silently past 72 bytes, so characters beyond that are not
// protecting the account. PASSWORD_MAX keeps us clear of it for ASCII, but
// multibyte characters can cross it on their own.
const BCRYPT_MAX_BYTES = 72;

const byteLength = (value) => Buffer.byteLength(value, "utf8");

/** Passwords common enough that an attacker tries them first. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234",
  "passw0rd", "p@ssword", "p@ssw0rd", "mypassword", "passwordpassword",
  "12345678", "123456789", "1234567890", "123123123", "111111111",
  "qwerty", "qwerty123", "qwertyuiop", "qwerty1234", "1qaz2wsx",
  "asdfghjkl", "zxcvbnm", "abc12345", "abcd1234", "a1b2c3d4",
  "iloveyou", "letmein", "welcome", "welcome1", "welcome123",
  "admin", "admin123", "administrator", "root", "guest", "test1234",
  "monkey", "dragon", "sunshine", "princess", "football", "baseball",
  "superman", "batman", "trustno1", "starwars", "pokemon", "computer",
  "michael", "jennifer", "jordan23", "master", "shadow", "freedom",
  "whatever", "qazwsxedc", "changeme", "secret", "login", "passcode",
  "deenbridge", "deenbridge1", "deenbridge123", "islam123", "muslim123",
  "bismillah", "alhamdulillah", "assalamualaikum", "allahuakbar",
]);

const characterClasses = (password) => ({
  lower: /[a-z]/.test(password),
  upper: /[A-Z]/.test(password),
  digit: /\d/.test(password),
  symbol: /[^A-Za-z0-9]/.test(password),
});

const classCount = (password) =>
  Object.values(characterClasses(password)).filter(Boolean).length;

/** Three or more identical characters in a row: "aaa", "111". */
const hasRun = (password) => /(.)\1{2,}/.test(password);

/** Four or more sequential characters: "abcd", "4321", "wxyz". */
function hasSequence(password) {
  const lower = password.toLowerCase();
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < lower.length; i += 1) {
    const delta = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= 4 || descending >= 4) return true;
  }
  return false;
}

const LEET = {
  0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b",
  "@": "a", $: "s", "!": "i", "+": "t",
};

const leet = (value) => value.replace(/[0134578@$!+]/g, (c) => LEET[c]);
const stripSeparators = (value) => value.replace(/[\s._-]/g, "");
const stripEdges = (value) =>
  value.replace(/^[^a-z]+/, "").replace(/[^a-z]+$/, "");

/**
 * A password counts as "common" if any plausible de-decoration of it lands in
 * the blocklist. Order matters: strip trailing digits BEFORE leet-substituting,
 * or "password123" becomes "passwordi2e" and slips through.
 */
function normalisedCandidates(password) {
  const lower = password.toLowerCase();
  const out = new Set();

  for (const base of [lower, stripSeparators(lower)]) {
    const trimmed = stripEdges(base);
    out.add(base);
    out.add(trimmed);
    out.add(leet(base));
    out.add(stripEdges(leet(base)));
    out.add(leet(trimmed));
  }

  out.delete("");
  return out;
}

const isCommon = (password) => {
  for (const candidate of normalisedCandidates(password)) {
    if (COMMON_PASSWORDS.has(candidate)) return true;
  }
  return false;
};

/**
 * Personal info is the first thing anyone guesses. Checks the name and the
 * email's local part, in fragments of 4+ characters.
 */
function containsPersonalInfo(password, { name = "", email = "" } = {}) {
  const haystack = password.toLowerCase();
  const fragments = [
    ...String(name || "").split(/\s+/),
    String(email || "").split("@")[0] || "",
  ]
    .map((f) => f.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((f) => f.length >= 4);

  return fragments.some((f) => haystack.includes(f));
}

/**
 * Every reason the password is unacceptable, most important first.
 * Empty array means it passes.
 */
export function passwordIssues(password, context = {}) {
  if (typeof password !== "string") {
    return ["Password must be a string"];
  }

  const issues = [];

  if (password.length < PASSWORD_MIN) {
    issues.push(`Password must be at least ${PASSWORD_MIN} characters`);
  }
  if (password.length > PASSWORD_MAX) {
    issues.push(`Password must be at most ${PASSWORD_MAX} characters`);
  } else if (byteLength(password) > BCRYPT_MAX_BYTES) {
    issues.push("Password is too long — please shorten it");
  }
  if (/^\s|\s$/.test(password)) {
    issues.push("Password can't start or end with a space");
  }
  if (classCount(password) < 3) {
    issues.push("Use at least three of: lowercase, uppercase, numbers, symbols");
  }
  if (isCommon(password)) {
    issues.push("This password is too common — please choose another");
  }
  if (containsPersonalInfo(password, context)) {
    issues.push("Password can't contain your name or email address");
  }
  if (hasRun(password)) {
    issues.push("Avoid repeating the same character three times or more");
  }
  if (hasSequence(password)) {
    issues.push("Avoid sequences like “abcd” or “1234”");
  }

  return issues;
}

/** True when the password satisfies the policy. */
export const isPasswordAcceptable = (password, context = {}) =>
  passwordIssues(password, context).length === 0;

/**
 * First policy violation, or null when acceptable. Handlers surface one
 * message at a time rather than a wall of text.
 */
export function firstPasswordIssue(password, context = {}) {
  const [issue] = passwordIssues(password, context);
  return issue ?? null;
}

export default {
  PASSWORD_MIN,
  PASSWORD_MAX,
  passwordIssues,
  isPasswordAcceptable,
  firstPasswordIssue,
};
