#!/usr/bin/env node

// Imports formation (talk) progress scraped from CFC Global Data (the
// cfc-scraper tool) into pfo_members, the table behind PFO Trainings.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-cfc-formations.js [members.jsonl] [--dry-run]
//
// Run scripts/import-cfc-members.js first. Each scraped talk maps to the
// TRAINING_COLUMNS id in src/screens/PfoList.js with the same formation code
// and talk number (e.g. ET talk 2 -> "ET_2-2. Evangelization in CFC"); the
// talk titles are also compared so a reordered formation fails loudly
// instead of shifting checkmarks into the wrong talk. A checked talk is
// stored as "Y" and an unchecked one as null, same as the PFO grid.
//
// Formations the site has no talks for (SMB, UM) and columns the site
// doesn't track (MWPR) are left out of the payload, so whatever is already
// stored there is kept.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://efelttlcyjfsvpxwmwjd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SOURCE = args.find((a) => !a.startsWith('--')) || path.join(os.homedir(), 'cfc-scraper/output/members.jsonl');

// Read the column ids straight out of PfoList.js so this script can never
// drift from what the grid actually renders.
function loadTrainingColumnIds() {
  const src = fs.readFileSync(path.join(__dirname, '../src/screens/PfoList.js'), 'utf8');
  const block = src.slice(src.indexOf('export const TRAINING_COLUMNS'), src.indexOf('];', src.indexOf('export const TRAINING_COLUMNS')));
  return [...block.matchAll(/\{ id: '([^']*)'/g)].map((m) => m[1]);
}

// "CODE_N-Title" -> { code, n, title }
function parseColumnId(id) {
  const m = /^(.+?)_(\d+)-(.*)$/.exec(id);
  return m ? { code: m[1], n: Number(m[2]), title: m[3] } : null;
}

// Compare titles loosely: the column ids were truncated / punctuated
// differently in places ("Purpose| Dynamic" vs "Purpose, Dynamic",
// "...through our Fina" vs "...through our Finances").
const squash = (s) => s.toLowerCase().replace(/^(talk \d+:|[a-z]+\d+:|\d+\.)\s*/, '').replace(/[^a-z0-9]/g, '');
function titlesMatch(columnTitle, siteTitle) {
  const a = squash(columnTitle);
  const b = squash(siteTitle);
  return a === b || (a.length >= 20 && b.startsWith(a));
}

function buildColumnMap() {
  const map = new Map(); // "CODE#n" -> column id
  for (const id of loadTrainingColumnIds()) {
    const parsed = parseColumnId(id);
    if (parsed) map.set(`${parsed.code}#${parsed.n}`, { id, title: parsed.title });
  }
  return map;
}

function toPfoRow(record, columnMap) {
  const row = { MemberIDNo: record.cells[record.headers.indexOf('Member ID #')].trim() };
  for (const formation of record.formations) {
    formation.talks.forEach((talk, i) => {
      const column = columnMap.get(`${formation.code}#${i + 1}`);
      if (!column) throw new Error(`No PFO column for ${formation.code} talk ${i + 1} ("${talk.label}")`);
      if (!titlesMatch(column.title, talk.label)) {
        throw new Error(`${formation.code} talk ${i + 1}: site says "${talk.label}" but column is "${column.id}"`);
      }
      row[column.id] = talk.checked ? 'Y' : null;
    });
  }
  return row;
}

async function main() {
  const columnMap = buildColumnMap();
  const records = fs.readFileSync(SOURCE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const rows = records.map((r) => toPfoRow(r, columnMap));

  const checked = rows.reduce((n, r) => n + Object.values(r).filter((v) => v === 'Y').length, 0);
  console.log(`${rows.length} members, ${Object.keys(rows[0]).length - 1} talk columns each, ${checked} completed talks from ${SOURCE}`);
  if (DRY_RUN) return;

  if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // pfo_members has no FK to members; refuse to create rows for members
  // that were never imported.
  const ids = rows.map((r) => r.MemberIDNo);
  const { data: known, error: knownError } = await supabase.from('members').select('MemberIDNo').in('MemberIDNo', ids);
  if (knownError) throw knownError;
  const knownIds = new Set(known.map((m) => m.MemberIDNo));
  const missing = ids.filter((id) => !knownIds.has(id));
  if (missing.length) throw new Error(`${missing.length} members not in members table yet (run import-cfc-members.js): ${missing.slice(0, 5).join(', ')}`);

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase.from('pfo_members').upsert(chunk, { onConflict: 'MemberIDNo' });
    if (error) throw error;
    console.log(`  upserted ${i + chunk.length}/${rows.length}`);
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
