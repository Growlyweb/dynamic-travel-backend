const mongoose = require('mongoose');
const Journal = require('../../models/Journal');
const Party = require('../../models/Party');
const ledger = require('../../services/accounting/ledger');
const reports = require('../../services/accounting/reports');
const { ensureChart } = require('../../services/accounting/chart');

const vendor = () => Party.create({ type: 'Vendor', code: `VND-${Math.random().toString().slice(2, 8)}`, name: `V ${Math.random()}`, nameKey: `v ${Math.random()}`, since: '2026-10-01' });
const base = { date: '2026-10-05', narration: 'Test', lines: [{ account: '1010', debit: 10000 }, { account: '4060', credit: 10000 }] };

describe('the ledger rules', () => {
  beforeEach(ensureChart);

  it('posts a balanced voucher and numbers it by type and year', async () => {
    const first = await ledger.post({ ...base, type: 'RV' });
    const second = await ledger.post({ ...base, type: 'RV' });
    expect(first.no).toBe('RV-2026-0001');
    expect(second.no).toBe('RV-2026-0002');
    expect(first.status).toBe('posted');
    expect(first.lines).toHaveLength(2);
  });

  it('refuses a voucher that does not balance, has one line, or a zero total', async () => {
    await expect(ledger.post({ ...base, lines: [{ account: '1010', debit: 10000 }, { account: '4060', credit: 9999 }] })).rejects.toMatchObject({ code: 'UNBALANCED', statusCode: 422 });
    await expect(ledger.post({ ...base, lines: [{ account: '1010', debit: 10000 }] })).rejects.toMatchObject({ code: 'TOO_FEW_LINES' });
    await expect(ledger.post({ ...base, lines: [{ account: '1010', debit: 0 }, { account: '4060', credit: 0 }] })).rejects.toMatchObject({ code: 'TOO_FEW_LINES' });
    expect(await Journal.countDocuments()).toBe(0);
  });

  it('refuses an unknown account, a line with a debit and a credit, and a bad date', async () => {
    await expect(ledger.post({ ...base, lines: [{ account: '9999', debit: 100 }, { account: '4060', credit: 100 }] })).rejects.toMatchObject({ code: 'UNKNOWN_ACCOUNT' });
    await expect(ledger.post({ ...base, lines: [{ account: '1010', debit: 100, credit: 100 }, { account: '4060', credit: 100 }] })).rejects.toMatchObject({ code: 'DEBIT_AND_CREDIT' });
    await expect(ledger.post({ ...base, date: '2026-13-45' })).rejects.toMatchObject({ code: 'INVALID_DATE' });
    await expect(ledger.post({ ...base, type: 'XX' })).rejects.toMatchObject({ code: 'INVALID_TYPE' });
  });

  it('needs a customer or supplier on a receivable or payable line', async () => {
    const v = await vendor();
    await expect(ledger.post({ ...base, lines: [{ account: '5010', debit: 500 }, { account: '2010', credit: 500 }] })).rejects.toMatchObject({ code: 'PARTY_REQUIRED' });
    await expect(ledger.post({ ...base, lines: [{ account: '1100', debit: 500 }, { account: '4060', credit: 500 }] })).rejects.toMatchObject({ code: 'PARTY_REQUIRED' });
    const ok = await ledger.post({ ...base, lines: [{ account: '5010', debit: 500 }, { account: '2010', credit: 500, party: v._id }] });
    expect(ok.lines[1].party.toString()).toBe(v._id.toString());
  });

  it('keeps every amount as whole paisa', async () => {
    const j = await ledger.post({ ...base, lines: [{ account: '1010', debit: 1234.4 }, { account: '4060', credit: 1234 }] });
    expect(j.lines[0].debit).toBe(1234);
  });

  it('posts a journal with a source once, even when asked again or together', async () => {
    const source = { kind: 'test', id: 'abc', role: 'one' };
    const [a, b] = await Promise.all([ledger.post({ ...base, source }), ledger.post({ ...base, source })]);
    const c = await ledger.post({ ...base, source });
    expect(String(a._id)).toBe(String(b._id));
    expect(String(a._id)).toBe(String(c._id));
    expect(await Journal.countDocuments()).toBe(1);
    expect((await ledger.post({ ...base, source: { ...source, role: 'two' } })).no).not.toBe(a.no);
  });

  it('voids a journal with a reason, and a voided journal counts for nothing', async () => {
    const posted = await ledger.post({ ...base, lines: [{ account: '1010', debit: 5000 }, { account: '4060', credit: 5000 }] });
    expect((await reports.cashPosition('2026-12-31')).find((r) => r.code === '1010').balance).toBe(50);
    const voided = await ledger.voidJournal(posted, { reason: 'Mistake' });
    expect(voided).toMatchObject({ status: 'void', voidReason: 'Mistake' });
    expect(voided.voidedAt).toBeTruthy();
    expect((await reports.cashPosition('2026-12-31')).find((r) => r.code === '1010').balance).toBe(0);
    expect((await ledger.voidJournal(posted, { reason: 'again' })).status).toBe('void');
    await expect(ledger.voidJournal(new mongoose.Types.ObjectId(), { reason: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('adds up posted journals only, by account and by date range', async () => {
    await ledger.post({ ...base, date: '2026-10-05', lines: [{ account: '1010', debit: 1000 }, { account: '4060', credit: 1000 }] });
    await ledger.post({ ...base, date: '2026-11-05', lines: [{ account: '1010', debit: 3000 }, { account: '4060', credit: 3000 }] });
    const october = await ledger.sums({ journal: ledger.dateRange({ from: '2026-10-01', to: '2026-10-31' }), line: { 'lines.account': '4060' }, by: '$lines.account' });
    expect(october).toEqual([{ key: '4060', debit: 0, credit: 1000 }]);
    const all = await ledger.sums({ line: { 'lines.account': '4060' }, by: '$lines.account' });
    expect(all[0].credit).toBe(4000);
  });
});
