import { POST as checkReport } from '../_lib/tasks/check-report.mjs';
import { POST as pushChanges } from '../_lib/tasks/push-changes.mjs';
import { POST as syncMembers } from '../_lib/tasks/sync-members.mjs';
import { POST as testLogin } from '../_lib/tasks/test-login.mjs';

// Every task that drives Chromium runs in this one function, so each
// deployment stores one copy of the browser instead of one per task. The old
// URLs (/api/ogd/test-login and so on) are rewritten here in vercel.json, so
// installed phone apps and open browser tabs keep working.

const TASKS = {
  'check-report': checkReport,
  'push-changes': pushChanges,
  'sync-members': syncMembers,
  'test-login': testLogin,
};

export async function POST(request) {
  const task = new URL(request.url).searchParams.get('task');
  const handler = Object.hasOwn(TASKS, task ?? '') ? TASKS[task] : null;
  if (!handler) return Response.json({ error: 'Unknown task.' }, { status: 404 });
  return handler(request);
}
