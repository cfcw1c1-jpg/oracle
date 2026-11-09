#!/usr/bin/env node

// Imports members scraped from CFC Global Data (the cfc-scraper tool) into
// the members table. Member fields only; formation data is a separate step.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-cfc-members.js [members.jsonl] [--dry-run]
//
// Defaults to ~/cfc-scraper/output/members.jsonl. Needs the columns from
// scripts/sql/add-member-contact-columns.sql. Upserts by MemberIDNo, so
// re-running just refreshes the same rows. "Area" from the site (West 1C1,
// West 1C1A, ...) goes into AreaName, which prefix-matches the "West 1C1"
// Area for scoping.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://efelttlcyjfsvpxwmwjd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SOURCE = args.find((a) => !a.startsWith('--')) || path.join(os.homedir(), 'cfc-scraper/output/members.jsonl');
const EXPECTED_AREA_PREFIX = 'West 1C1';

// members.Status only allows the app's own values (members_status_check).
const STATUS_MAP = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  DECEASED: 'Deceased',
  'MOVED TO HOLD': 'Inactive',
  'MOVED TO OTHER COMMUNITY': 'Inactive',
};

const blank = (v) => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

function toMember(record) {
  const row = Object.fromEntries(record.headers.map((h, i) => [h, record.cells[i]]));
  const fullName = row['Member Name'].trim();
  const comma = fullName.indexOf(',');
  const siteStatus = blank(row.Status)?.toUpperCase() ?? null;
  const yearMatch = /^PM-(\d{4})-/.exec(row['Member ID #']);

  if (siteStatus && !STATUS_MAP[siteStatus]) {
    throw new Error(`Unmapped status "${siteStatus}" for ${row['Member ID #']}`);
  }

  return {
    MemberIDNo: row['Member ID #'].trim(),
    Lastname: comma === -1 ? fullName : fullName.slice(0, comma).trim(),
    Firstname: comma === -1 ? null : fullName.slice(comma + 1).trim(),
    AreaName: blank(row.Area),
    PastoralService: blank(row.Service),
    SpouseName: blank(row['Spouse Name']),
    Phone: blank(row.Phone),
    MobileNo: blank(row['Mobile #']),
    Email: blank(row.Email),
    SiteStatus: siteStatus,
    Status: siteStatus ? STATUS_MAP[siteStatus] : 'Active',
    YearRegistered: yearMatch ? Number(yearMatch[1]) : null,
  };
}

async function main() {
  const members = fs.readFileSync(SOURCE, 'utf8').trim().split('\n').map((l) => toMember(JSON.parse(l)));

  const ids = new Set(members.map((m) => m.MemberIDNo));
  if (ids.size !== members.length) throw new Error('Duplicate MemberIDNo in source file');
  const outside = members.filter((m) => !m.AreaName?.startsWith(EXPECTED_AREA_PREFIX));
  if (outside.length) throw new Error(`${outside.length} members are outside ${EXPECTED_AREA_PREFIX}: ${outside.map((m) => m.MemberIDNo).join(', ')}`);

  console.log(`${members.length} members from ${SOURCE}`);
  if (DRY_RUN) {
    console.log(JSON.stringify(members.slice(0, 3), null, 2));
    return;
  }

  if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  for (let i = 0; i < members.length; i += 100) {
    const chunk = members.slice(i, i + 100);
    const { error } = await supabase.from('members').upsert(chunk, { onConflict: 'MemberIDNo' });
    if (error) throw error;
    console.log(`  upserted ${i + chunk.length}/${members.length}`);
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
