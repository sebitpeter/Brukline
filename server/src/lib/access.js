// Company scoping and per-role access rules, in one place.
import { prisma } from './db.js';
import { HttpError } from './http.js';
import { isFinance } from './auth.js';

/** Agents only see shipments assigned to them; ADMIN/ACCOUNTANT see the whole company. */
export function shipmentScope(user) {
  return user.role === 'AGENT' ? { companyId: user.companyId, assignedToId: user.id } : { companyId: user.companyId };
}

export function canAccessShipment(user, shipment) {
  if (!shipment || shipment.companyId !== user.companyId) return false;
  return isFinance(user) || shipment.assignedToId === user.id;
}

export async function loadShipment(user, id, include) {
  const s = await prisma.shipment.findFirst({ where: { id, companyId: user.companyId }, include });
  if (!s || !canAccessShipment(user, s)) throw new HttpError(404, 'Shipment not found');
  return s;
}

/** Fields an AGENT may change on their own shipment (operational, not client/value/assignment). */
export const AGENT_SHIPMENT_FIELDS = ['truckRegs', 'trailerReg', 'driverName', 'driverPhone', 'containerNo', 'blAwb', 'entryNumber', 'station', 'packages', 'weightKg', 'eta'];

/** Expense review: finance roles only, never your own expense unless you are ADMIN. */
export function canReviewExpense(user, expense) {
  if (!isFinance(user) || expense.companyId !== user.companyId) return false;
  if (expense.spentById === user.id && user.role !== 'ADMIN') return false;
  return true;
}

/** A shipment file / expense receipt may be downloaded by anyone in the company who can see the shipment. */
export function canDownloadFile(user, file, shipment) {
  return file.companyId === user.companyId && canAccessShipment(user, shipment);
}
