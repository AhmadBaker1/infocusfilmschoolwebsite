// POST /api/apply/admissions: public Apply Now form (src/pages/apply.astro).
// Multipart. The program must be one of ours; its name comes from the
// program data, never the form. Responds { ok: true } or a 400 with a
// message; a filled honeypot gets a 200 and nothing is saved.
import type { APIRoute } from 'astro';
import { getPrograms } from '../../../lib/programs';
import { clientIp } from '../../../lib/server/auth';
import { audit, db, newId, now } from '../../../lib/server/db';
import { badRequest, isEmail, json, missing, str, throttled } from '../../../lib/server/http';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    return badRequest('Could not read the form.');
  }

  if (str(form, 'website', { max: 1000 })) return json({ ok: true });

  const required = ['program', 'first_name', 'last_name', 'email', 'phone_country', 'phone', 'city', 'country', 'heard_from'];
  const gaps = missing(form, required);
  if (gaps.length) return badRequest('Please complete all required fields.', Object.fromEntries(gaps.map((k) => [k, 'Required'])));

  const slug = str(form, 'program', { max: 80 });
  const program = getPrograms().find((p) => p.slug === slug);
  if (!program) return badRequest('Please choose one of our programs.', { program: 'Unknown' });

  const email = str(form, 'email', { max: 254 }).toLowerCase();
  if (!isEmail(email)) return badRequest('Please enter a valid email address.', { email: 'Invalid' });

  const d1 = db(ctx.locals);
  const ip = clientIp(ctx.request);
  if (await throttled(d1, ip, 'admissions', 5)) {
    return json({ ok: false, message: 'Too many applications from this connection. Please try again in an hour.' }, 429);
  }

  const id = newId();
  const ts = now();
  const firstName = str(form, 'first_name', { max: 80 });
  const lastName = str(form, 'last_name', { max: 80 });
  await d1
    .prepare(
      `INSERT INTO admissions_applications
         (id, program, program_name, first_name, last_name, email, phone_country, phone, city, country, heard_from,
          status, notes, ip, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '', ?, ?, ?)`
    )
    .bind(
      id,
      program.slug,
      program.title,
      firstName,
      lastName,
      email,
      str(form, 'phone_country', { max: 20 }),
      str(form, 'phone', { max: 40 }),
      str(form, 'city', { max: 80 }),
      str(form, 'country', { max: 80 }),
      str(form, 'heard_from', { max: 80 }),
      ip || null,
      ts,
      ts
    )
    .run();

  await audit(d1, null, 'admission.submit', 'admission', id, { title: `${firstName} ${lastName} - ${program.title}` });
  return json({ ok: true });
};
