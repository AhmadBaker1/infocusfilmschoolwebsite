// Shared bits for the HR applicants and Admissions modules: row types, the
// status vocabulary and badge colours, list filters (shared by the admin
// list pages and their CSV exports), upload checks for the public forms and
// a small CSV writer. Server-only.

// ---- Rows ----

export interface JobApplicationRow {
  id: string;
  job_id: string | null;
  role: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_country: string;
  phone: string;
  city: string;
  province: string;
  country: string;
  work_eligible: string;
  resume_key: string | null;
  resume_name: string | null;
  cover_letter_key: string | null;
  cover_letter_name: string | null;
  cover_letter: string;
  portfolio_url: string;
  linkedin_url: string;
  start_date: string;
  heard_from: string;
  status: ApplicantStatus;
  notes: string;
  ip: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdmissionRow {
  id: string;
  program: string;
  program_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_country: string;
  phone: string;
  city: string;
  country: string;
  heard_from: string;
  status: AdmissionStatus;
  notes: string;
  ip: string | null;
  created_at: string;
  updated_at: string;
}

export const fullName = (r: { first_name: string; last_name: string }) => `${r.first_name} ${r.last_name}`.trim();

// ---- Statuses ----

export const APPLICANT_STATUSES = ['new', 'reviewing', 'interview', 'offer', 'hired', 'declined'] as const;
export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number];

export const APPLICANT_BADGE: Record<ApplicantStatus, string> = {
  new: 'a-badge--new',
  reviewing: 'a-badge--blue',
  interview: 'a-badge--warn',
  offer: 'a-badge--warn',
  hired: 'a-badge--ok',
  declined: 'a-badge--muted',
};

export const ADMISSION_STATUSES = ['new', 'contacted', 'interview', 'accepted', 'enrolled', 'declined'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];

export const ADMISSION_BADGE: Record<AdmissionStatus, string> = {
  new: 'a-badge--new',
  contacted: 'a-badge--blue',
  interview: 'a-badge--warn',
  accepted: 'a-badge--ok',
  enrolled: 'a-badge--ok',
  declined: 'a-badge--muted',
};

export const statusLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const isApplicantStatus = (s: string): s is ApplicantStatus => (APPLICANT_STATUSES as readonly string[]).includes(s);
export const isAdmissionStatus = (s: string): s is AdmissionStatus => (ADMISSION_STATUSES as readonly string[]).includes(s);

// ---- List filters (GET params on the admin lists and the CSV exports) ----

export interface ApplicantFilters {
  tab: 'roles' | 'pool';
  status: string;
  job: string;
  q: string;
}

export function applicantFilters(params: URLSearchParams): ApplicantFilters {
  const status = params.get('status') ?? '';
  const job = (params.get('job') ?? '').slice(0, 80);
  // A ?job= deep link from the jobs module lands on the role tab.
  const tab = params.get('tab') === 'pool' && !job ? 'pool' : 'roles';
  return {
    tab,
    status: isApplicantStatus(status) ? status : '',
    job: tab === 'roles' ? job : '',
    q: (params.get('q') ?? '').trim().slice(0, 100),
  };
}

export function applicantWhere(f: ApplicantFilters): { sql: string; binds: unknown[] } {
  const where = [f.tab === 'pool' ? 'job_id IS NULL' : 'job_id IS NOT NULL'];
  const binds: unknown[] = [];
  if (f.status) {
    where.push('status = ?');
    binds.push(f.status);
  }
  if (f.job) {
    where.push('job_id = ?');
    binds.push(f.job);
  }
  if (f.q) {
    where.push("(first_name || ' ' || last_name LIKE ? OR email LIKE ?)");
    const like = `%${f.q.replace(/[%_]/g, '')}%`;
    binds.push(like, like);
  }
  return { sql: where.join(' AND '), binds };
}

export function applicantQuery(f: ApplicantFilters): string {
  const p = new URLSearchParams();
  if (f.tab === 'pool') p.set('tab', 'pool');
  if (f.status) p.set('status', f.status);
  if (f.job) p.set('job', f.job);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface AdmissionFilters {
  status: string;
  program: string;
  q: string;
}

export function admissionFilters(params: URLSearchParams): AdmissionFilters {
  const status = params.get('status') ?? '';
  return {
    status: isAdmissionStatus(status) ? status : '',
    program: (params.get('program') ?? '').slice(0, 80),
    q: (params.get('q') ?? '').trim().slice(0, 100),
  };
}

export function admissionWhere(f: AdmissionFilters): { sql: string; binds: unknown[] } {
  const where = ['1 = 1'];
  const binds: unknown[] = [];
  if (f.status) {
    where.push('status = ?');
    binds.push(f.status);
  }
  if (f.program) {
    where.push('program = ?');
    binds.push(f.program);
  }
  if (f.q) {
    where.push("(first_name || ' ' || last_name LIKE ? OR email LIKE ?)");
    const like = `%${f.q.replace(/[%_]/g, '')}%`;
    binds.push(like, like);
  }
  return { sql: where.join(' AND '), binds };
}

export function admissionQuery(f: AdmissionFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.program) p.set('program', f.program);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- Uploads (résumés and cover letters) ----

export const MAX_UPLOAD = 8 * 1024 * 1024;

const DOC_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// First bytes of each format: %PDF, OLE compound file, ZIP (docx).
const MAGIC: Record<string, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46],
  doc: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  docx: [0x50, 0x4b, 0x03, 0x04],
};

export interface Upload {
  name: string;
  contentType: string;
  bytes: ArrayBuffer;
}

export type UploadCheck = { ok: true; upload: Upload | null } | { ok: false; message: string };

/**
 * Validate one uploaded document: extension, declared type, size and the
 * file's own signature. `null` upload when nothing was sent.
 */
export async function checkUpload(v: FormDataEntryValue | null, label: string, required: boolean): Promise<UploadCheck> {
  const file = typeof v === 'object' && v !== null && 'arrayBuffer' in v ? (v as File) : null;
  if (!file || (file.size === 0 && !file.name)) {
    return required ? { ok: false, message: `Please attach your ${label} (PDF, DOC or DOCX).` } : { ok: true, upload: null };
  }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!DOC_TYPES[ext]) return { ok: false, message: `Your ${label} must be a PDF, DOC or DOCX file.` };
  const declared = (file.type || '').split(';')[0].trim().toLowerCase();
  if (declared && declared !== DOC_TYPES[ext] && declared !== 'application/octet-stream') {
    return { ok: false, message: `Your ${label} does not look like a ${ext.toUpperCase()} file.` };
  }
  if (file.size === 0) return { ok: false, message: `Your ${label} is empty.` };
  if (file.size > MAX_UPLOAD) return { ok: false, message: `Your ${label} is too large. The limit is 8 MB.` };
  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  const sig = MAGIC[ext];
  if (head.length < sig.length || sig.some((b, i) => head[i] !== b)) {
    return { ok: false, message: `Your ${label} does not look like a ${ext.toUpperCase()} file.` };
  }
  return { ok: true, upload: { name: file.name, contentType: DOC_TYPES[ext], bytes } };
}

// ---- CSV ----

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Stop spreadsheet apps treating a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  // BOM so Excel opens it as UTF-8.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function csvResponse(fileName: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'private, no-store',
    },
  });
}
