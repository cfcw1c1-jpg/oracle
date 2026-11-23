// Turns a push's live progress ({ kind, stage, done, total }) into a bar
// position, a step label and an estimated time left. Times are rough averages
// from OGD runs: signing in (with an emailed code) takes about 45s, and each
// attendee takes about 7s to search and add.
const SIGN_IN_S = 45;
const PER_ATTENDEE_S = 7;
const CHECK_S = 20;
const VERIFY_S = 30;

const ATTENDEE_STAGES = {
  signing_in: [0, 15], opening: [15, 20], checking: [20, 25], adding: [25, 85], saving: [85, 90], verifying: [90, 99],
};
const ACTIVITY_STAGES = { signing_in: [0, 35], opening: [35, 45], filling: [45, 85], saving: [85, 98] };
const ACTIVITY_LEFT_S = { signing_in: 90, opening: 50, filling: 35, saving: 15 };

// memo keeps what was seen between polls ({ stage, stageAt, addingAt }).
export function describeProgress(kind, progress, { startedAt, now = Date.now(), memo = {}, count = 0 }) {
  const stage = progress?.stage ?? 'signing_in';
  if (memo.stage !== stage) { memo.stage = stage; memo.stageAt = now; }
  if (stage === 'adding' && !memo.addingAt) memo.addingAt = now;
  const inStage = (now - (memo.stageAt ?? now)) / 1000;
  const elapsed = (now - (startedAt ?? now)) / 1000;

  if (kind === 'activity') {
    const [from, to] = ACTIVITY_STAGES[stage] ?? [0, 95];
    const left = Math.max(5, (ACTIVITY_LEFT_S[stage] ?? 30) - inStage);
    const share = Math.min(1, inStage / Math.max(1, ACTIVITY_LEFT_S[stage] ?? 30));
    return { percent: Math.round(from + (to - from) * share * 0.9), label: progress?.label ?? 'Signing in to OGD', secondsLeft: Math.round(left), elapsed: Math.round(elapsed) };
  }

  const total = progress?.total ?? count;
  const done = progress?.done ?? 0;
  let left;
  if (stage === 'adding' && done > 0) {
    const per = (now - memo.addingAt) / 1000 / done;
    left = (total - done) * Math.max(2, per) + VERIFY_S;
  } else if (stage === 'adding') left = total * PER_ATTENDEE_S + VERIFY_S;
  else if (stage === 'saving' || stage === 'verifying') left = Math.max(5, VERIFY_S - inStage);
  else {
    const before = { signing_in: SIGN_IN_S + CHECK_S, opening: CHECK_S, checking: CHECK_S / 2 }[stage] ?? CHECK_S;
    left = Math.max(5, before - inStage) + total * PER_ATTENDEE_S + VERIFY_S;
  }
  const [from, to] = ATTENDEE_STAGES[stage] ?? [0, 95];
  const share = stage === 'adding' && total ? done / total : Math.min(0.9, inStage / 30);
  const label = stage === 'adding' && total ? `${progress.label} (${done} of ${total})` : (progress?.label ?? 'Signing in to OGD');
  return { percent: Math.round(from + (to - from) * share), label, secondsLeft: Math.round(Math.max(3, left)), elapsed: Math.round(elapsed) };
}

export function formatSeconds(seconds) {
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)}s`;
  const rounded = Math.round(seconds / 10) * 10;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `about ${minutes}m ${rest}s` : `about ${minutes}m`;
}
