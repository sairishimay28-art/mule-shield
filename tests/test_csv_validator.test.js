/**
 * Unit Test Suite for MULE SHIELD CSV Validation & Pre-Flight Checks
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { validateCsvContent } = require('../frontend/js/csvValidator.js');

describe('MULE SHIELD CSV Pre-Flight Validator', () => {

  test('should validate correct circular cycle CSV data', () => {
    const validCsv = `transaction_id,sender_id,receiver_id,amount,timestamp
TX-101,ACC_ALPHA,ACC_BETA,14500.0,1728525600000
TX-102,ACC_BETA,ACC_GAMMA,14100.0,1728536400000
TX-103,ACC_GAMMA,ACC_ALPHA,13800.0,1728547200000`;

    const result = validateCsvContent(validCsv);
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.validRowsCount, 3);
    assert.strictEqual(result.errors.length, 0);
  });

  test('should detect missing required canonical columns', () => {
    const invalidCsv = `transaction_id,sender_id,amount
TX-101,ACC_ALPHA,14500.0`;

    const result = validateCsvContent(invalidCsv);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.includes('Missing required column(s)')));
  });

  test('should handle common column aliases seamlessly', () => {
    const aliasedCsv = `tx_id,from_account,to_account,tx_amount,created_at
TX-201,ACC_MULE_1,ACC_MULE_2,9800.0,1728532800000`;

    const result = validateCsvContent(aliasedCsv);
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.validRowsCount, 1);
  });

  test('should catch non-positive numeric amounts', () => {
    const badAmountCsv = `transaction_id,sender_id,receiver_id,amount,timestamp
TX-301,ACC_ALPHA,ACC_BETA,-500.0,1728525600000`;

    const result = validateCsvContent(badAmountCsv);
    assert.strictEqual(result.isValid, false);
    assert.ok(result.errors.some(e => e.includes('Non-positive amount')));
  });

  test('should warn on duplicate transaction IDs', () => {
    const duplicateCsv = `transaction_id,sender_id,receiver_id,amount,timestamp
TX-401,ACC_ALPHA,ACC_BETA,1000.0,1728525600000
TX-401,ACC_BETA,ACC_GAMMA,1000.0,1728536400000`;

    const result = validateCsvContent(duplicateCsv);
    assert.ok(result.warnings.some(w => w.includes('Duplicate transaction_id')));
  });

  test('should validate 120-row ledger with ISO formatted timestamps', () => {
    const rows = ['transaction_id,sender_id,receiver_id,amount,timestamp'];
    for (let i = 1; i <= 120; i++) {
      const s = `ACC${String((i % 10) + 1).padStart(4, '0')}`;
      const r = `ACC${String(((i + 1) % 10) + 1).padStart(4, '0')}`;
      const amt = i <= 10 ? 15000 : 9200;
      const timeStr = `2026-09-01 08:${String(i % 60).padStart(2, '0')}:00`;
      rows.push(`TX${String(i).padStart(5, '0')},${s},${r},${amt},${timeStr}`);
    }
    const result = validateCsvContent(rows.join('\n'));
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.validRowsCount, 120);
    assert.strictEqual(result.errors.length, 0);
  });
});
