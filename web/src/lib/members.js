import { ROLE_LABELS } from './formation';

export const MEMBER_COLUMNS = 'MemberIDNo, Lastname, Firstname, PastoralService, AreaName, NameOfHouseholdHead, YearRegistered, Status, SpouseName, Phone, MobileNo, Email, Birthday';
export const ROLE_OPTION_CODES = Object.keys(ROLE_LABELS);
export const STATUS_OPTIONS = ['Active', 'Inactive', 'Deceased', 'SOLD', 'HANDMAID'];
export const STATUS_TONE = { Active: 'success', SOLD: 'warning', HANDMAID: 'accent' };

export function memberRoleLabel(code) {
  if (!code || code === 'All') return code || 'Member';
  return ROLE_LABELS[code.trim().toUpperCase()] || code;
}

export function memberInitials(member) {
  return (`${(member.Firstname || '').trim().charAt(0)}${(member.Lastname || '').trim().charAt(0)}`).toUpperCase() || '?';
}

export function formFromMember(member = {}) {
  return {
    MemberIDNo: member.MemberIDNo || '',
    Lastname: member.Lastname || '',
    Firstname: member.Firstname || '',
    Status: member.Status || 'Active',
    AreaName: member.AreaName || '',
    NameOfHouseholdHead: member.NameOfHouseholdHead || '',
    PastoralService: member.PastoralService || '',
    YearRegistered: member.YearRegistered != null ? String(member.YearRegistered) : '',
    SpouseName: member.SpouseName || '',
    MobileNo: member.MobileNo || '',
    Phone: member.Phone || '',
    Email: member.Email || '',
    Birthday: member.Birthday || '',
  };
}

// Returns { error } or { payload } with every editable column, blanks as null.
export function payloadFromForm(form) {
  const lastname = form.Lastname.trim();
  const firstname = form.Firstname.trim();
  if (!lastname || !firstname) return { error: ['Missing Information', 'Last Name and First Name are required.'] };

  const yearText = form.YearRegistered.trim();
  const yearRegistered = yearText ? Number(yearText) : null;
  if (yearText && !Number.isInteger(yearRegistered)) return { error: ['Invalid Year', 'Year Registered must be a whole number, e.g. 2024.'] };

  return {
    payload: {
      Lastname: lastname,
      Firstname: firstname,
      Status: form.Status || 'Active',
      AreaName: form.AreaName.trim() || null,
      NameOfHouseholdHead: form.NameOfHouseholdHead.trim() || null,
      PastoralService: form.PastoralService || null,
      YearRegistered: yearRegistered,
      SpouseName: form.SpouseName.trim() || null,
      MobileNo: form.MobileNo.trim() || null,
      Phone: form.Phone.trim() || null,
      Email: form.Email.trim() || null,
      Birthday: form.Birthday || null,
    },
  };
}

// "1954-01-21" -> "Jan 21, 1954", read as a calendar date (no time zone shift).
export function formatBirthday(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  if (!match) return value || '';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function buildSuggestions(members) {
  const unique = (key) => [...new Set(members.map((member) => member[key]?.trim()).filter(Boolean))].sort();
  return { areas: unique('AreaName'), households: unique('NameOfHouseholdHead') };
}
