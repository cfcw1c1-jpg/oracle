import { POST as celebrants } from '../_lib/tasks/celebrants.mjs';
import { POST as checkReport } from '../_lib/tasks/check-report.mjs';
import { POST as pushActivity } from '../_lib/tasks/push-activity.mjs';
import { POST as pushAttendees } from '../_lib/tasks/push-attendees.mjs';
import { POST as pushChanges } from '../_lib/tasks/push-changes.mjs';
import { POST as readActivityForm } from '../_lib/tasks/read-activity-form.mjs';
import { POST as syncActivities } from '../_lib/tasks/sync-activities.mjs';
import { POST as syncMembers } from '../_lib/tasks/sync-members.mjs';
import { POST as testLogin } from '../_lib/tasks/test-login.mjs';

// Every task that drives Chromium runs in this one function, so each
// deployment stores one copy of the browser instead of one per task. The old
// URLs (/api/ogd/test-login and so on) are rewritten here in vercel.json, so
// installed phone apps and open browser tabs keep working.

const TASKS = {
  celebrants,
  'check-report': checkReport,
  'push-activity': pushActivity,
  'push-attendees': pushAttendees,
  'push-changes': pushChanges,
  'read-activity-form': readActivityForm,
  'sync-activities': syncActivities,
  'sync-members': syncMembers,
  'test-login': testLogin,
};

export async function POST(request) {
  const task = new URL(request.url).searchParams.get('task');
  const handler = Object.hasOwn(TASKS, task ?? '') ? TASKS[task] : null;
  if (!handler) return Response.json({ error: 'Unknown task.' }, { status: 404 });
  return handler(request);
}
