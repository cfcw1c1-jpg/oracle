// Wedding anniversaries from the Church Wedding Date saved on members. When
// both spouses are members they share one wedding date, so they are listed
// once as a couple.

export function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

const plain = (value) => (value || '').toLowerCase().replace(/[^a-z]/g, '');
const lastFirst = (member) => plain(`${member.Lastname}${member.Firstname}`);

// "Dela Cruz, Maria" → { last: 'Dela Cruz', first: 'Maria' }; "Maria Dela Cruz" → { first: 'Maria Dela Cruz' }.
function splitName(value) {
  const text = (value || '').trim();
  if (!text) return null;
  const comma = text.indexOf(',');
  return comma > 0 ? { last: text.slice(0, comma).trim(), first: text.slice(comma + 1).trim() } : { last: '', first: text };
}

// The spouse's saved name names this member ("Lastname, Firstname"; the
// member's first name may be longer than the one written, e.g. a second name).
function names(spouseName, member) {
  const spouse = splitName(spouseName);
  if (!spouse) return false;
  if (spouse.last) {
    return plain(spouse.last) === plain(member.Lastname)
      && (plain(member.Firstname).startsWith(plain(spouse.first)) || plain(spouse.first).startsWith(plain(member.Firstname)));
  }
  return plain(spouse.first) === plain(`${member.Firstname}${member.Lastname}`) || plain(spouse.first) === lastFirst(member);
}

/** Two members are spouses: same wedding date, and one names the other as spouse or they share a household head. */
function isCouple(a, b) {
  if (a.WeddingDate !== b.WeddingDate) return false;
  if (names(a.SpouseName, b) || names(b.SpouseName, a)) return true;
  const head = plain(a.NameOfHouseholdHead);
  return Boolean(head) && head === plain(b.NameOfHouseholdHead) && !a.SpouseName && !b.SpouseName;
}

/** "Juan & Maria Dela Cruz", or "Juan Dela Cruz & Maria Santos" when the last names differ. */
export function coupleName(first, second) {
  const one = { first: (first.first || '').trim(), last: (first.last || '').trim() };
  if (!second) return [one.first, one.last].filter(Boolean).join(' ');
  const two = { first: (second.first || '').trim(), last: (second.last || '').trim() };
  if (!two.last || plain(one.last) === plain(two.last)) return `${one.first} & ${two.first} ${one.last}`.replace(/\s+/g, ' ').trim();
  return `${one.first} ${one.last} & ${two.first} ${two.last}`.replace(/\s+/g, ' ').trim();
}

/**
 * Couples from the members that have a Church Wedding Date: spouses who are
 * both members become one couple; a member whose spouse is not a member is a
 * couple with the spouse's saved name. Each couple:
 *   { key, wedding: {year, month, day}, WeddingDate, name, members: [member, ...] }
 */
export function buildCouples(members) {
  const dated = members.filter((member) => parseDate(member.WeddingDate));
  const used = new Set();
  const couples = [];
  for (const member of dated) {
    if (used.has(member.MemberIDNo)) continue;
    used.add(member.MemberIDNo);
    const partner = dated.find((other) => !used.has(other.MemberIDNo) && isCouple(member, other));
    if (partner) used.add(partner.MemberIDNo);
    const self = { first: member.Firstname, last: member.Lastname };
    const spouse = partner ? { first: partner.Firstname, last: partner.Lastname } : splitName(member.SpouseName);
    couples.push({
      key: partner ? `${member.MemberIDNo}+${partner.MemberIDNo}` : member.MemberIDNo,
      wedding: parseDate(member.WeddingDate),
      WeddingDate: member.WeddingDate.slice(0, 10),
      name: coupleName(self, spouse),
      members: partner ? [member, partner] : [member],
      spouseName: partner ? '' : (member.SpouseName || ''),
    });
  }
  return couples;
}

/** Years married on this year's anniversary (null when the year isn't known or is this year). */
export function yearsMarried(couple, year) {
  const married = couple.wedding.year;
  return married > 1900 && married < year ? year - married : null;
}

export function ordinal(value) {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th');
  return `${value}${suffix}`;
}
