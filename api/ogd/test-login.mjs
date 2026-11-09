import { authorize, HttpError, route } from '../_lib/access.mjs';
import { runChapterLogin } from '../_lib/ogdRun.mjs';

export const POST = route(async (request) => {
  const body = await request.json().catch(() => null);
  if (!body) throw new HttpError(400, 'Invalid request.');

  const { db, userId, chapters } = await authorize(request, body.scope);
  const areaId = Number(body.areaId);
  if (!chapters.some((chapter) => chapter.areaId === areaId)) throw new HttpError(403, 'You cannot manage this chapter.');

  const result = await runChapterLogin({ db, areaId, userId });
  return { status: result.status, failureCode: result.failure_code, statusDetail: result.status_detail };
});
