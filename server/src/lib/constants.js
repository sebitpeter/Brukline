export const STATUSES = ['DOCS_RECEIVED', 'DECLARED', 'ASSESSED', 'TAXES_PAID', 'RELEASED', 'DELIVERED', 'CLOSED'];
export const ACTIVE_STATUSES = STATUSES.slice(0, 6);
export const STATUS_LABEL = {
  DOCS_RECEIVED: 'Docs received', DECLARED: 'Declared', ASSESSED: 'Assessed', TAXES_PAID: 'Taxes paid',
  RELEASED: 'Released', DELIVERED: 'Delivered', CLOSED: 'Closed',
};
export const EXPENSE_CATEGORIES = ['CUSTOMS_TAXES', 'PORT_CHARGES', 'HANDLING', 'STORAGE', 'TRANSPORT', 'ESCORT', 'BOND', 'DOCUMENTATION', 'OTHER'];
export function categoryLabel(cat, authority = 'Customs') {
  return {
    CUSTOMS_TAXES: `${authority} duties & taxes`, PORT_CHARGES: 'Port / ICD charges', HANDLING: 'Handling', STORAGE: 'Storage / demurrage',
    TRANSPORT: 'Transport', ESCORT: 'Escort', BOND: 'Bond / guarantee', DOCUMENTATION: 'Documentation', OTHER: 'Facilitation / other',
  }[cat] || cat;
}
export const PAY_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK', 'CHEQUE', 'CARD'];
export const FILE_TYPES = ['COMMERCIAL_INVOICE', 'PACKING_LIST', 'BL_AWB', 'ENTRY', 'ASSESSMENT', 'TAX_RECEIPT', 'RELEASE_ORDER', 'DELIVERY_NOTE', 'OTHER'];
export const FILE_TYPE_LABEL = {
  COMMERCIAL_INVOICE: 'Commercial invoice', PACKING_LIST: 'Packing list', BL_AWB: 'Bill of lading / AWB', ENTRY: 'Customs entry',
  ASSESSMENT: 'Assessment notice', TAX_RECEIPT: 'Tax payment receipt', RELEASE_ORDER: 'Release order', DELIVERY_NOTE: 'Delivery note', OTHER: 'Other',
};
