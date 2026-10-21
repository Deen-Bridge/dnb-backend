// Predefined security questions for account recovery (issue #136).
// Only these ids are accepted; free-form/custom questions are rejected.
export const SECURITY_QUESTIONS = [
  { id: "first_pet", text: "What was the name of your first pet?" },
  { id: "childhood_street", text: "What street did you grow up on?" },
  { id: "first_school", text: "What was the name of your first school?" },
  { id: "maternal_grandmother", text: "What is your maternal grandmother's first name?" },
  { id: "birth_city", text: "In what city were you born?" },
  { id: "favorite_teacher", text: "What was the last name of your favorite teacher?" },
  { id: "first_job", text: "What was your first job?" },
  { id: "childhood_friend", text: "What was the name of your childhood best friend?" },
  { id: "first_phone_model", text: "What was the model of your first phone?" },
  { id: "favorite_book", text: "What is the title of your favorite book as a child?" },
];

export const SECURITY_QUESTION_IDS = SECURITY_QUESTIONS.map((q) => q.id);
export const REQUIRED_QUESTION_COUNT = 3;
export const MIN_ANSWER_LENGTH = 3;
