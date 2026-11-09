export const CHANGE_STATUS = {
  pending: { label: 'Awaiting Approval', tone: 'warning' },
  on_going: { label: 'On-Going', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export function requestDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatChangeValue(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
