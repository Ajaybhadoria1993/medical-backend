import { sql, type SQL } from 'drizzle-orm';

const MOVED = (kind: 'net' | 'gross') =>
  sql.raw(`CASE
  WHEN e.entry_type = 'payment' THEN e.amount_paise
  ${kind === 'net' ? "WHEN e.entry_type = 'refund' THEN -e.amount_paise" : ''}
  WHEN e.entry_type = 'adjustment' AND t.entry_type = 'payment' THEN -e.amount_paise
  ${kind === 'net' ? "WHEN e.entry_type = 'adjustment' AND t.entry_type = 'refund' THEN e.amount_paise" : ''}
  ELSE 0 END`);

/** One visit's money from the ledger, in rupees, for reports that group by visit (date, service, doctor…). */
export const visitMoneySql = (
  appointmentId: SQL | unknown,
  kind: 'net' | 'gross' = 'net'
) =>
  sql`(SELECT COALESCE(SUM(${MOVED(kind)}), 0)::numeric / 100
    FROM money_entries e LEFT JOIN money_entries t ON t.id = e.reverses_entry_id
    WHERE e.account = 'clinic' AND e.source_type = 'appointment' AND e.source_id = ${appointmentId})`;

/** How the visit was last paid, from the ledger; null while nothing was paid. */
export const visitModeSql = (appointmentId: SQL | unknown) =>
  sql`(SELECT e.payment_mode FROM money_entries e
    WHERE e.account = 'clinic' AND e.source_type = 'appointment' AND e.source_id = ${appointmentId} AND e.entry_type = 'payment'
    ORDER BY e.created_at DESC LIMIT 1)`;

/** One visit's net money split by mode (rows: mode, amount in rupees), for a LATERAL join. */
export const visitMoneyByModeSql = (appointmentId: SQL | unknown) =>
  sql`(SELECT COALESCE(e.payment_mode, t.payment_mode) AS mode, SUM(${MOVED('net')})::numeric / 100 AS amount
    FROM money_entries e LEFT JOIN money_entries t ON t.id = e.reverses_entry_id
    WHERE e.account = 'clinic' AND e.source_type = 'appointment' AND e.source_id = ${appointmentId}
    GROUP BY 1)`;
