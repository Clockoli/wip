export function popupControlState(state, currentIssue) {
  const pending = state?.pendingWrites ?? [];
  return {
    stopDisabled: !state?.active,
    startDisabled: !currentIssue || pending.length > 0,
  };
}
