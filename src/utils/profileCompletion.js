/**
 * Default weighted fields for profile completion tracking.
 * Total weights sum to 100.
 */
export const DEFAULT_PROFILE_FIELDS = [
  {
    key: "avatar",
    label: "Profile Picture",
    weight: 20,
    category: "profile",
    suggestion: "Upload a profile photo to personalize your account and build trust with the community.",
    check: (user) => {
      return Boolean(user?.avatar && typeof user.avatar === "string" && user.avatar.trim().length > 0);
    },
  },
  {
    key: "bio",
    label: "Bio / About Me",
    weight: 20,
    category: "profile",
    suggestion: "Add a bio describing yourself, your learning goals, and Islamic studies interests.",
    check: (user) => {
      return Boolean(user?.bio && typeof user.bio === "string" && user.bio.trim().length > 0);
    },
  },
  {
    key: "country",
    label: "Country / Location",
    weight: 10,
    category: "personal",
    suggestion: "Specify your country or region to find local study circles, events, and educators.",
    check: (user) => {
      return Boolean(user?.country && typeof user.country === "string" && user.country.trim().length > 0);
    },
  },
  {
    key: "interests",
    label: "Interests & Topics",
    weight: 15,
    category: "preferences",
    suggestion: "Select your areas of interest to receive tailored course, book, and space recommendations.",
    check: (user) => {
      if (!Array.isArray(user?.interests)) return false;
      return user.interests.some(
        (item) => typeof item === "string" && item.trim().length > 0
      );
    },
  },
  {
    key: "language",
    label: "Preferred Language",
    weight: 10,
    category: "preferences",
    suggestion: "Set your preferred language for courses and platform communication.",
    check: (user) => {
      return Boolean(user?.language && typeof user.language === "string" && user.language.trim().length > 0);
    },
  },
  {
    key: "gender",
    label: "Gender",
    weight: 5,
    category: "personal",
    suggestion: "Specify your gender to help customize relevant community spaces and study groups.",
    check: (user) => {
      return Boolean(user?.gender && ["male", "female"].includes(user.gender));
    },
  },
  {
    key: "age",
    label: "Age",
    weight: 5,
    category: "personal",
    suggestion: "Provide your age to help us curate age-appropriate learning material.",
    check: (user) => {
      const ageNum = Number(user?.age);
      return typeof user?.age !== "undefined" && user?.age !== null && !isNaN(ageNum) && ageNum >= 2 && ageNum <= 120;
    },
  },
  {
    key: "stellarWallet",
    label: "Stellar Wallet",
    weight: 10,
    category: "wallet",
    suggestion: "Connect your Stellar wallet to enable digital micropayments, gifts, and Sadaqah donations.",
    check: (user) => {
      return Boolean(
        user?.stellarWallet?.publicKey &&
        typeof user.stellarWallet.publicKey === "string" &&
        user.stellarWallet.publicKey.trim().length > 0
      );
    },
  },
  {
    key: "twoFactor",
    label: "Two-Factor Authentication",
    weight: 5,
    category: "security",
    suggestion: "Enable Two-Factor Authentication (2FA) to enhance your account security.",
    check: (user) => {
      return Boolean(user?.twoFactor?.enabled === true);
    },
  },
];

/**
 * Determine progress badge/level from completion percentage.
 * @param {number} percentage
 * @returns {"Beginner" | "Intermediate" | "Advanced" | "Complete"}
 */
export const getCompletionLevel = (percentage) => {
  if (percentage >= 100) return "Complete";
  if (percentage >= 70) return "Advanced";
  if (percentage >= 35) return "Intermediate";
  return "Beginner";
};

/**
 * Calculate user profile completion metrics.
 *
 * @param {Object} [user] User document or plain object
 * @param {Array} [fieldDefinitions] Optional custom field definitions
 * @returns {Object} Comprehensive profile completion result
 */
export const calculateProfileCompletion = (
  user,
  fieldDefinitions = DEFAULT_PROFILE_FIELDS
) => {
  const normalizedUser = user
    ? typeof user.toObject === "function"
      ? user.toObject()
      : user
    : {};

  let earnedPoints = 0;
  let totalPossiblePoints = 0;
  let completedCount = 0;

  const completedFields = [];
  const missingFields = [];
  const fieldResults = [];
  const missingFieldDefs = [];

  for (const def of fieldDefinitions) {
    totalPossiblePoints += def.weight;
    const isCompleted = Boolean(def.check(normalizedUser));

    if (isCompleted) {
      earnedPoints += def.weight;
      completedCount += 1;
      completedFields.push(def.key);
    } else {
      missingFields.push(def.key);
      missingFieldDefs.push(def);
    }

    fieldResults.push({
      key: def.key,
      label: def.label,
      category: def.category,
      weight: def.weight,
      completed: isCompleted,
      pointsAwarded: isCompleted ? def.weight : 0,
      suggestion: def.suggestion,
    });
  }

  const rawPercentage = totalPossiblePoints > 0 ? (earnedPoints / totalPossiblePoints) * 100 : 0;
  const percentage = Math.min(100, Math.max(0, Math.round(rawPercentage)));
  const isComplete = percentage === 100;
  const level = getCompletionLevel(percentage);

  // Sort missing fields by weight descending so highest-impact suggestions come first
  missingFieldDefs.sort((a, b) => b.weight - a.weight);
  const suggestions = missingFieldDefs.map((item) => item.suggestion);
  const nextStep = suggestions.length > 0 ? suggestions[0] : null;

  return {
    percentage,
    earnedPoints,
    totalPossiblePoints,
    completedCount,
    totalCount: fieldDefinitions.length,
    isComplete,
    level,
    completedFields,
    missingFields,
    fields: fieldResults,
    suggestions,
    nextStep,
  };
};

export default calculateProfileCompletion;
