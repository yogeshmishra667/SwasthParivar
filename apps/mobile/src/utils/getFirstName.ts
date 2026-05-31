/** Extracts the first word from a full name. Returns the original string if it's a single word. */
export const getFirstName = (fullName: string): string => {
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  return spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
};
