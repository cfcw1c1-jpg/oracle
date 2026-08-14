#!/usr/bin/env node

// Seeds a demo Area, a demo login account scoped to that Area, and a
// handful of demo members under it -- lets you try out area-scoped
// Portal Users / Directory behavior without touching real membership
// data. Everything created here is prefixed "Demo"/"DEMO-" so it's
// obvious at a glance and easy to find and delete later.
//
// Needs your project's service_role key (never the anon key -- creating a
// login account requires it, same as the create-portal-user Edge
// Function does). Get it from Supabase Dashboard -> Project Settings ->
// API -> service_role, then run:
//
//   SUPABASE_SERVICE_ROLE_KEY=<paste-it-here> node scripts/seed-dummy-data.js
//
// Never commit that key anywhere -- pass it inline as shown above so it
// only ever lives in your shell history/environment.
//
// Safe to re-run: the Area/members are upserted by their unique keys, and
// the login account is looked up by email before creating one, so running
// this again just confirms the same demo data still exists.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://efelttlcyjfsvpxwmwjd.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_SERVICE_ROLE_KEY.\n' +
    'Get it from Supabase Dashboard -> Project Settings -> API -> service_role, then run:\n\n' +
    '  SUPABASE_SERVICE_ROLE_KEY=<paste-it-here> node scripts/seed-dummy-data.js\n'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DEMO_AREA_NAME = 'Demo Area';
const DEMO_LOGIN_EMAIL = 'demo.moderator@oracle.test';
const DEMO_LOGIN_PASSWORD = 'DemoPass123!';
const DEMO_ROLE_NAME = 'Moderator';

// PastoralService codes match ROLE_LABELS in src/screens/MembersList.js.
const DEMO_MEMBERS = [
  { MemberIDNo: 'DEMO-00001', Lastname: 'Santos', Firstname: 'Juan', Gender: 'Male', Status: 'Active', PastoralService: 'CH', NameOfHouseholdHead: 'Juan Santos', YearRegistered: '2020' },
  { MemberIDNo: 'DEMO-00002', Lastname: 'Reyes', Firstname: 'Maria', Gender: 'Female', Status: 'Active', PastoralService: 'HH', NameOfHouseholdHead: 'Maria Reyes', YearRegistered: '2021' },
  { MemberIDNo: 'DEMO-00003', Lastname: 'Cruz', Firstname: 'Jose', Gender: 'Male', Status: 'Active', PastoralService: 'UL', NameOfHouseholdHead: 'Juan Santos', YearRegistered: '2022' },
  { MemberIDNo: 'DEMO-00004', Lastname: 'Garcia', Firstname: 'Ana', Gender: 'Female', Status: 'Active', PastoralService: 'MEMBER', NameOfHouseholdHead: 'Maria Reyes', YearRegistered: '2023' },
  { MemberIDNo: 'DEMO-00005', Lastname: 'Bautista', Firstname: 'Pedro', Gender: 'Male', Status: 'Inactive', PastoralService: 'MEMBER', NameOfHouseholdHead: 'Juan Santos', YearRegistered: '2019' },
];

async function main() {
  console.log('Seeding demo Area...');
  let { data: area, error: areaError } = await supabase
    .from('areas')
    .select('id, name')
    .eq('name', DEMO_AREA_NAME)
    .maybeSingle();
  if (areaError) throw areaError;

  if (!area) {
    const { data: created, error } = await supabase
      .from('areas')
      .insert([{ name: DEMO_AREA_NAME, type: 'Chapter' }])
      .select('id, name')
      .single();
    if (error) throw error;
    area = created;
  }
  console.log(`  Area ready: "${area.name}" (id ${area.id})`);

  console.log('Seeding demo members under it...');
  // AreaName is what actually scopes a member to an Area (prefix-matched
  // against areas.name -- see scripts/sql/add-user-area-scoping.sql).
  const membersPayload = DEMO_MEMBERS.map((m) => ({ ...m, AreaName: DEMO_AREA_NAME }));
  const { error: membersError } = await supabase
    .from('members')
    .upsert(membersPayload, { onConflict: 'MemberIDNo' });
  if (membersError) throw membersError;
  console.log(`  ${membersPayload.length} demo members ready under "${DEMO_AREA_NAME}".`);

  console.log('Seeding demo login account...');
  let demoUserId;
  const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const existing = existingUsers.users.find((u) => u.email === DEMO_LOGIN_EMAIL);

  if (existing) {
    demoUserId = existing.id;
    console.log(`  Login account already exists (${DEMO_LOGIN_EMAIL}).`);
  } else {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: DEMO_LOGIN_EMAIL,
      password: DEMO_LOGIN_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    demoUserId = created.user.id;
    console.log(`  Created login account: ${DEMO_LOGIN_EMAIL}`);
  }

  const { data: role } = await supabase.from('roles').select('id').eq('name', DEMO_ROLE_NAME).maybeSingle();
  if (role) {
    await supabase.from('profiles').update({ full_name: 'Demo Moderator', role_id: role.id }).eq('id', demoUserId);
    console.log(`  Assigned role "${DEMO_ROLE_NAME}".`);
  } else {
    await supabase.from('profiles').update({ full_name: 'Demo Moderator' }).eq('id', demoUserId);
    console.warn(`  No role named "${DEMO_ROLE_NAME}" found -- login created without a role. Assign one from Portal Users.`);
  }

  const { error: userAreaError } = await supabase
    .from('user_areas')
    .upsert([{ profile_id: demoUserId, area_id: area.id }], { onConflict: 'profile_id,area_id' });
  if (userAreaError) throw userAreaError;
  console.log(`  Scoped to "${DEMO_AREA_NAME}".`);

  console.log('\nDone:');
  console.log(`  Area:    ${DEMO_AREA_NAME}`);
  console.log(`  Login:   ${DEMO_LOGIN_EMAIL} / ${DEMO_LOGIN_PASSWORD}`);
  console.log(`  Members: ${membersPayload.length} demo members, all AreaName = "${DEMO_AREA_NAME}"`);
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
