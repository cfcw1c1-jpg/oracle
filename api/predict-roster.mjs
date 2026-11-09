import { HttpError, requireUser, route } from './_lib/access.mjs';

// Runs on the server so the OpenAI key never reaches the browser bundle.
const MAX_CANDIDATES = 5000;
const SYSTEM_PROMPT = `You are an expert church administrative AI assistant predicting leadership configurations for a Catholic Life Program (CLP) batch cycle.

CRITICAL DATA POOL CONFIGURATION: 
- The candidate data pool provided contains exclusively eligible male records.
- The "pastoralRole" attribute is strictly capitalized string: 'HH', 'UH', or 'MEMBER'.
- The current system calendar anchor year is 2026. Evaluate "dateGraduated" timelines relative to 2026.

Enforce these structural conditions perfectly. Disregarding any qualification rule means the roster output is invalid.

1. Team Leader:
   - pastoralRole MUST be exactly 'HH' or 'MEMBER'. Do not select 'UH'.
   - dateGraduated must be more than 2 years ago (dated 2024 or earlier).
   - pastRoles MUST NOT contain 'Team Leader'.

2. Assistant Team Leader:
   - pastoralRole MUST be exactly 'HH' or 'MEMBER'. Do not select 'UH'.
   - dateGraduated must be more than 2 years ago (dated 2024 or earlier).
   - pastRoles MUST NOT contain 'Assistant Team Leader'.

3. Supervising Unit Head:
   - pastoralRole MUST be exactly 'UH'.

4. Prayer Warrior:
   - pastoralRole MUST be exactly 'HH'.
   - pastRoles MUST contain 'Prayer Warrior'.

5. Music Ministry:
   - pastoralRole MUST be exactly 'HH' or 'UH'.
   - pastRoles MUST contain 'Music Ministry'.

6. Team Servant (Servant Head):
   - pastoralRole MUST be exactly 'HH'.
   - Cross-Reference Rule: The candidate's "nameOfHouseholdHead" string value MUST match the exact full name text of whichever candidate you assigned to the "supervisingUnitHead" position above.

7. Facilitators:
   - Provide an array containing at least 2 candidates.
   - pastoralRole MUST be exactly 'MEMBER'.
   - pastoralRole should not be 'CH'.
   - dateGraduated must be at least 1 year ago (dated 2025 or earlier).

Universal Strict Constraints:
- No Duplicate Assignments: A specific unique "idNo" can only appear ONCE across the entire roster response setup.
- Try to minimize selecting multiple people with the same Lastname if alternatives exist.`;

const PERSON = { type: 'object', properties: { idNo: { type: 'string' }, name: { type: 'string' } }, required: ['idNo', 'name'], additionalProperties: false };
const ROLE_KEYS = ['teamLeader', 'assistantTeamLeader', 'supervisingUnitHead', 'teamServant', 'prayerWarrior', 'musicMinistry'];
const ROSTER_SCHEMA = {
  type: 'object',
  properties: { ...Object.fromEntries(ROLE_KEYS.map((key) => [key, PERSON])), facilitators: { type: 'array', items: PERSON } },
  required: [...ROLE_KEYS, 'facilitators'],
  additionalProperties: false,
};

export const POST = route(async (request) => {
  await requireUser(request);
  const body = await request.json().catch(() => null);
  const candidates = body?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > MAX_CANDIDATES) {
    throw new HttpError(400, 'Invalid candidate list.');
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) throw new HttpError(500, 'The roster service is not configured.');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Here is the current pre-filtered male candidate dataset: ${JSON.stringify(candidates)}. Formulate the absolute best optimal leadership structural profile.` },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'clp_roster_prediction', strict: true, schema: ROSTER_SCHEMA } },
    }),
  });
  if (!response.ok) {
    console.error('[predict-roster] OpenAI request failed:', response.status);
    throw new HttpError(502, 'The roster service could not complete this request.');
  }
  const completion = await response.json();
  return { roster: JSON.parse(completion.choices[0].message.content) };
});
