import { useCompany, useAuth } from '../auth.jsx';
import { useFormat } from '../format.js';
import { printElement } from '../format.js';

export function ReceiptView({ sale, id = 'receipt-print' }) {
  const company = useCompany();
  const { settings } = useAuth();
  const { money, dateTime, qty } = useFormat();
  if (!sale) return null;
  const items = sale.items || [];
  const payments = sale.payments || [];

  return (
    <div className="receipt receipt-print" id={id}>
      <div className="receipt-center">
        <h3>{company.name || 'Ledger POS'}</h3>
        {company.address && <div className="muted">{company.address}</div>}
        {company.phone && <div className="muted">{company.phone}</div>}
        {company.tax_number && <div className="muted">Tax ID: {company.tax_number}</div>}
      </div>
      <hr />
      <table className="receipt-table">
        <tbody>
          <tr><td className="muted">Invoice</td><td className="right">{sale.invoice_no}</td></tr>
          <tr><td className="muted">Date</td><td className="right">{dateTime(sale.created_at)}</td></tr>
          {sale.location_name && <tr><td className="muted">Location</td><td className="right">{sale.location_name}</td></tr>}
          <tr><td className="muted">Cashier</td><td className="right">{sale.cashier_name || '—'}</td></tr>
          <tr><td className="muted">Customer</td><td className="right">{sale.customer_name || 'Walk-in customer'}</td></tr>
        </tbody>
      </table>
      <hr />
      <table className="receipt-table">
        <tbody>
          {items.map((item) => (
            <tr key={item.id || item.sale_item_id || item.product_id}>
              <td>
                <div>{item.description || item.product_name}</div>
                <div className="muted">{qty(item.quantity)} × {money(item.unit_price)}</div>
              </td>
              <td className="right" style={{ verticalAlign: 'bottom' }}>{money(item.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <table className="receipt-table">
        <tbody>
          <tr><td className="muted">Subtotal</td><td className="right">{money(sale.subtotal)}</td></tr>
          {Number(sale.discount) > 0 && <tr><td className="muted">Discount</td><td className="right">−{money(sale.discount)}</td></tr>}
          <tr><td className="muted">Tax</td><td className="right">{money(sale.tax)}</td></tr>
          <tr>
            <td className="receipt-total">Total</td>
            <td className="right receipt-total">{money(sale.total)}</td>
          </tr>
          {payments.map((p) => (
            <tr key={p.id || `${p.method_id}-${p.amount}`}>
              <td className="muted">{p.method_name || p.method}</td>
              <td className="right">{money(p.amount)}</td>
            </tr>
          ))}
          {Number(sale.change_due) > 0 && <tr><td className="muted">Change</td><td className="right">{money(sale.change_due)}</td></tr>}
          {Number(sale.due) > 0 && <tr><td className="muted bold">Balance due</td><td className="right bold">{money(sale.due)}</td></tr>}
        </tbody>
      </table>
      <hr />
      <div className="receipt-center muted">
        {settings?.pos?.receipt_footer || 'Thank you for your business!'}
      </div>
      <div className="barcode">{sale.invoice_no}</div>
    </div>
  );
}

export function printReceipt() {
  printElement('receipt-print');
}
