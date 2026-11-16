// Local-disk uploads: server/uploads/<companyId>/<random>.<ext>. Never served statically;
// files only go out through routes that check the company and shipment access.
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http.js';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const UPLOAD_DIR = resolve(serverRoot, process.env.UPLOAD_DIR || 'uploads');
export const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 10;

const DOC_TYPES = {
  '.pdf': ['application/pdf'],
  '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'],
  '.doc': ['application/msword'], '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'], '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.csv': ['text/csv', 'application/vnd.ms-excel'],
};
const IMAGE_TYPES = { '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'] };
const RECEIPT_TYPES = { '.pdf': DOC_TYPES['.pdf'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'] };

export function companyDir(companyId) {
  if (!/^[a-z0-9]+$/i.test(companyId)) throw new Error('bad company id');
  const d = join(UPLOAD_DIR, companyId);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

/** Resolve a stored name to a path inside the company folder (rejects anything that escapes it). */
export function storedPath(companyId, storedName) {
  if (!/^[a-z0-9]+\.[a-z0-9]+$/i.test(storedName || '')) throw new HttpError(404, 'File not found');
  const p = join(companyDir(companyId), storedName);
  if (!existsSync(p)) throw new HttpError(404, 'File not found');
  return p;
}

export function removeStored(companyId, storedName) {
  try { unlinkSync(storedPath(companyId, storedName)); } catch { /* already gone */ }
}

/** Keep a readable original name for downloads, without path parts or odd characters. */
export function safeName(name) {
  const base = basename(String(name || 'file')).normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim();
  return (base || 'file').slice(-120);
}

function makeUpload(types) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, companyDir(req.user.companyId)),
      filename: (req, file, cb) => cb(null, randomBytes(16).toString('hex') + extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: MAX_MB * 1024 * 1024, files: 1, fields: 20 },
    fileFilter: (req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!types[ext] || !types[ext].includes(file.mimetype)) return cb(new HttpError(400, `File type not allowed (${ext || 'no extension'}). Allowed: ${Object.keys(types).join(', ')}`));
      cb(null, true);
    },
  });
}

export const docUpload = makeUpload(DOC_TYPES);
export const receiptUpload = makeUpload(RECEIPT_TYPES);
export const logoUpload = makeUpload(IMAGE_TYPES);

/** Wrap multer so its errors become clean 400s. */
export const single = (uploader, field) => (req, res, next) =>
  uploader.single(field)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, `File is too large (max ${MAX_MB} MB)`));
    next(err.status ? err : new HttpError(400, err.message));
  });

/** Send a stored file as a download. */
export function sendStored(res, companyId, storedName, originalName, mime, inline = false) {
  const p = storedPath(companyId, storedName);
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName(originalName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(p);
}
