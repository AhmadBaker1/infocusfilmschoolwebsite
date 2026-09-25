// POST /api/apply/job: public job application form (src/components/ApplyPage.astro).
// Multipart. Validates everything server-side, stores the résumé and optional
// cover letter in R2 under applications/<id>/, inserts the row and audits it.
// Responds { ok: true } or a 400 with a message; a filled honeypot gets a 200
// and nothing is saved.
import type { APIRoute } from 'astro';
import { checkUpload } from '../../../lib/server/applications';
import { clientIp } from '../../../lib/server/auth';
import { audit, db, files, newId, now } from '../../../lib/server/db';
import { badRequest, isEmail, isUrl, json, missing, safeFileName, str, throttled } from '../../../lib/server/http';

export const prerender = false;

const GENERAL = 'General application';

export const POST: APIRoute = async (ctx) => {
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    return badRequest('Could not read the form.');
  }

  // Honeypot: bots fill it, people never see it.
  if (str(form, 'website', { max: 1000 })) return json({ ok: true });

  const required = ['first_name', 'last_name', 'email', 'phone', 'city', 'country', 'work_eligible', 'consent'];
  const gaps = missing(form, required);
  if (gaps.length) return badRequest('Please complete all required fields.', Object.fromEntries(gaps.map((k) => [k, 'Required'])));

  const email = str(form, 'email', { max: 254 }).toLowerCase();
  if (!isEmail(email)) return badRequest('Please enter a valid email address.', { email: 'Invalid' });
  const workEligible = str(form, 'work_eligible', { max: 3 });
  if (workEligible !== 'yes' && workEligible !== 'no') return badRequest('Please tell us whether you are eligible to work in Canada.', { work_eligible: 'Invalid' });
  if (str(form, 'consent', { max: 3 }) !== 'yes') return badRequest('Please agree to be contacted about your application.', { consent: 'Required' });

  const portfolio = str(form, 'portfolio_url', { max: 500 });
  const linkedin = str(form, 'linkedin_url', { max: 500 });
  if (!isUrl(portfolio)) return badRequest('The portfolio link must be a full web address (https://...).', { portfolio_url: 'Invalid' });
  if (!isUrl(linkedin)) return badRequest('The LinkedIn link must be a full web address (https://...).', { linkedin_url: 'Invalid' });
  const startDate = str(form, 'start_date', { max: 10 });
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return badRequest('The start date is not valid.', { start_date: 'Invalid' });

  const resume = await checkUpload(form.get('resume'), 'résumé', true);
  if (!resume.ok) return badRequest(resume.message, { resume: 'Invalid' });
  const cover = await checkUpload(form.get('cover_letter_file'), 'cover letter', false);
  if (!cover.ok) return badRequest(cover.message, { cover_letter_file: 'Invalid' });

  const d1 = db(ctx.locals);

  // The posting applied for, if any. Empty = general application (talent pool).
  const jobId = str(form, 'job_id', { max: 80 });
  let role = GENERAL;
  if (jobId) {
    const job = await d1.prepare('SELECT id, title FROM jobs WHERE id = ?').bind(jobId).first<{ id: string; title: string }>();
    if (!job) return badRequest('That job posting no longer exists. Please send a general application instead.', { job_id: 'Unknown' });
    role = job.title;
  }

  const ip = clientIp(ctx.request);
  if (await throttled(d1, ip, 'job', 5)) {
    return json({ ok: false, message: 'Too many applications from this connection. Please try again in an hour.' }, 429);
  }

  const id = newId();
  const ts = now();
  const bucket = files(ctx.locals);
  const resumeKey = `applications/${id}/resume-${safeFileName(resume.upload!.name, 'resume')}`;
  await bucket.put(resumeKey, resume.upload!.bytes, { httpMetadata: { contentType: resume.upload!.contentType } });
  let coverKey: string | null = null;
  if (cover.upload) {
    coverKey = `applications/${id}/cover-${safeFileName(cover.upload.name, 'cover-letter')}`;
    await bucket.put(coverKey, cover.upload.bytes, { httpMetadata: { contentType: cover.upload.contentType } });
  }

  const firstName = str(form, 'first_name', { max: 80 });
  const lastName = str(form, 'last_name', { max: 80 });
  await d1
    .prepare(
      `INSERT INTO job_applications
         (id, job_id, role, first_name, last_name, email, phone_country, phone, city, province, country, work_eligible,
          resume_key, resume_name, cover_letter_key, cover_letter_name, cover_letter, portfolio_url, linkedin_url,
          start_date, heard_from, status, notes, ip, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?, ?)`
    )
    .bind(
      id,
      jobId || null,
      role,
      firstName,
      lastName,
      email,
      str(form, 'phone_country', { max: 20 }),
      str(form, 'phone', { max: 40 }),
      str(form, 'city', { max: 80 }),
      str(form, 'province', { max: 80 }),
      str(form, 'country', { max: 80 }),
      workEligible,
      resumeKey,
      resume.upload!.name.slice(0, 200),
      coverKey,
      cover.upload ? cover.upload.name.slice(0, 200) : null,
      str(form, 'cover_letter', { max: 20_000 }),
      portfolio,
      linkedin,
      startDate,
      str(form, 'heard_from', { max: 80 }),
      ip || null,
      ts,
      ts
    )
    .run();

  await audit(d1, null, 'applicant.submit', 'applicant', id, { title: `${firstName} ${lastName} - ${role}` });
  return json({ ok: true });
};
