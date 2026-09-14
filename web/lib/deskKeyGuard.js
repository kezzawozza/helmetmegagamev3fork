// Shared guard for the adjudication desk's window-level single-key shortcuts (QueueRail's
// j/k/arrows/m/r/c/h, Workspace's Escape). Must catch `Select` (web/app/components/Select.js), a
// custom listbox whose tagName is "BUTTON" not SELECT, and any held modifier (⌘C, ⌘K).
export function isFieldFocused(activeElement) {
  if (!activeElement) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName)) return true;
  if (activeElement.isContentEditable) return true;
  return Boolean(activeElement.closest('[role="combobox"], [role="listbox"]'));
}

export function hasModifier(e) {
  return e.metaKey || e.ctrlKey || e.altKey;
}
