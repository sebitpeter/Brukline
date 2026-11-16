import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { isFinance } from '../lib/auth.js';
import { HttpError, parse } from '../lib/http.js';
import { canDownloadFile, loadShipment } from '../lib/access.js';
import { FILE_TYPES, FILE_TYPE_LABEL } from '../lib/constants.js';
import { docUpload, single, sendStored, removeStored, safeName } from '../lib/uploads.js';

const r = Router();

r.post('/shipments/:id/files', single(docUpload, 'file'), async (req, res) => {
  try {
    const s = await loadShipment(req.user, req.params.id);
    if (!req.file) throw new HttpError(400, 'Choose a file to upload');
    const { type } = parse(z.object({ type: z.enum(FILE_TYPES) }), req.body);
    const f = await prisma.shipmentFile.create({ data: { companyId: s.companyId, shipmentId: s.id, type, originalName: safeName(req.file.originalname), storedName: req.file.filename, mime: req.file.mimetype, size: req.file.size, uploadedById: req.user.id } });
    await prisma.shipmentEvent.create({ data: { companyId: s.companyId, shipmentId: s.id, userId: req.user.id, kind: 'FILE', text: `Uploaded ${FILE_TYPE_LABEL[type]}: ${f.originalName}` } });
    res.status(201).json(f);
  } catch (err) {
    if (req.file) removeStored(req.user.companyId, req.file.filename);
    throw err;
  }
});

async function loadFile(req) {
  const f = await prisma.shipmentFile.findFirst({ where: { id: req.params.fileId, companyId: req.user.companyId }, include: { shipment: true } });
  if (!f || !canDownloadFile(req.user, f, f.shipment)) throw new HttpError(404, 'File not found');
  return f;
}

r.get('/files/:fileId/download', async (req, res) => {
  const f = await loadFile(req);
  sendStored(res, f.companyId, f.storedName, f.originalName, f.mime, req.query.inline === '1');
});

r.delete('/files/:fileId', async (req, res) => {
  const f = await loadFile(req);
  if (!isFinance(req.user) && f.uploadedById !== req.user.id) throw new HttpError(403, 'Only the uploader or the office can delete this file');
  await prisma.shipmentFile.delete({ where: { id: f.id } });
  removeStored(f.companyId, f.storedName);
  await prisma.shipmentEvent.create({ data: { companyId: f.companyId, shipmentId: f.shipmentId, userId: req.user.id, kind: 'FILE', text: `Deleted ${FILE_TYPE_LABEL[f.type]}: ${f.originalName}` } });
  res.status(204).end();
});

export default r;
