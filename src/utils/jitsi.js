export const sanitizeDomain = (domain = "") => {
  if (!domain) return "meet.jit.si";
  const withoutProtocol = domain.replace(/^https?:\/\//i, "");
  return withoutProtocol.replace(/\/+$/, "");
};

export const buildMeetingUrl = (domain, roomName) => {
  if (!roomName) {
    throw new Error("Meeting room name is required to build the meeting URL.");
  }

  const normalizedDomain = sanitizeDomain(domain);
  return `https://${normalizedDomain}/${roomName}`;
};

