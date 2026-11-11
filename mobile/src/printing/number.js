// UUIDs and sync event keys never become customer-facing receipt numbers.
export const saleNumber=record=>/^P-\d{2,}$/.test(record.snapshot?.receipt_number||'')?record.snapshot.receipt_number:`P-${String(record.cloud_number||record.number).padStart(2,'0')}`;
export const businessName=name=>!name||/^(?:DISTRIBUIDORA & SALSAMENTARIA DANNY'S|DANNY'S(?: POS)?)$/i.test(name.trim())?'DOK POLLO MC':name;
