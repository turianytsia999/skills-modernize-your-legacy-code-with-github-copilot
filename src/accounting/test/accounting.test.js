'use strict';

const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  DataProgram,
  INITIAL_BALANCE_CENTS,
  MAX_BALANCE_CENTS,
  Operations,
  formatBalance,
  parseAmount,
  run,
} = require('../index');

function createOperations() {
  return new Operations(new DataProgram());
}

async function executeOperation(operation, amount) {
  const output = [];
  const operations = createOperations();
  await operations.execute(
    operation,
    async () => amount,
    (message) => output.push(message),
  );
  return { output, operations };
}

async function runApplication(lines) {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (chunk) => chunks.push(chunk.toString()));
  const application = run(input, output);

  for (const line of lines) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    input.write(`${line}\n`);
  }
  input.end();
  await application;
  return chunks.join('');
}

test('TC-001 and TC-003: a new run displays the default balance', async () => {
  const output = await runApplication(['1', '4']);

  assert.match(output, /Current balance: 001000\.00/);
});

test('TC-002: the menu displays every option and repeats after an operation', async () => {
  const output = await runApplication(['1', '4']);
  const menu = [
    'Account Management System',
    '1. View Balance',
    '2. Credit Account',
    '3. Debit Account',
    '4. Exit',
  ];

  for (const menuItem of menu) {
    assert.equal(output.split(menuItem).length - 1, 2);
  }
});

test('TC-004: a whole-dollar credit is persisted', async () => {
  const { output, operations } = await executeOperation('CREDIT', '50.00');

  assert.deepEqual(output, ['Amount credited. New balance: 001050.00']);
  assert.equal(operations.dataProgram.execute('READ  '), 105000);
});

test('TC-005: a credit preserves cents', async () => {
  const { output } = await executeOperation('CREDIT', '12.34');

  assert.deepEqual(output, ['Amount credited. New balance: 001012.34']);
});

test('TC-006: sequential credits use the latest stored balance', async () => {
  const operations = createOperations();
  const output = [];
  const credit = (amount) => operations.execute(
    'CREDIT',
    async () => amount,
    (message) => output.push(message),
  );

  await credit('10.00');
  await credit('25.50');

  assert.deepEqual(output, [
    'Amount credited. New balance: 001010.00',
    'Amount credited. New balance: 001035.50',
  ]);
});

test('TC-007: a debit below the balance is persisted', async () => {
  const { output, operations } = await executeOperation('DEBIT ', '25.00');

  assert.deepEqual(output, ['Amount debited. New balance: 000975.00']);
  assert.equal(operations.dataProgram.execute('READ  '), 97500);
});

test('TC-008: a debit equal to the balance is accepted', async () => {
  const { output, operations } = await executeOperation('DEBIT ', '1000.00');

  assert.deepEqual(output, ['Amount debited. New balance: 000000.00']);
  assert.equal(operations.dataProgram.execute('READ  '), 0);
});

test('TC-009: an overdrawn debit is rejected without changing the balance', async () => {
  const { output, operations } = await executeOperation('DEBIT ', '1000.01');

  assert.deepEqual(output, ['Insufficient funds for this debit.']);
  assert.equal(operations.dataProgram.execute('READ  '), INITIAL_BALANCE_CENTS);
});

test('TC-010: sequential debits use the latest stored balance', async () => {
  const operations = createOperations();
  const output = [];
  const debit = (amount) => operations.execute(
    'DEBIT ',
    async () => amount,
    (message) => output.push(message),
  );

  await debit('100.00');
  await debit('50.25');

  assert.deepEqual(output, [
    'Amount debited. New balance: 000900.00',
    'Amount debited. New balance: 000849.75',
  ]);
});

test('TC-011: a rejected debit leaves a previously credited balance unchanged', async () => {
  const operations = createOperations();
  const output = [];
  const execute = (operation, amount) => operations.execute(
    operation,
    async () => amount,
    (message) => output.push(message),
  );

  await execute('CREDIT', '50.00');
  await execute('DEBIT ', '2000.00');

  assert.deepEqual(output, [
    'Amount credited. New balance: 001050.00',
    'Insufficient funds for this debit.',
  ]);
  assert.equal(operations.dataProgram.execute('READ  '), 105000);
});

test('TC-012: selecting exit stops the application', async () => {
  const output = await runApplication(['4']);

  assert.match(output, /Exiting the program\. Goodbye!/);
  assert.equal(output.split('Enter your choice').length - 1, 1);
});

test('TC-013 and TC-014: out-of-range menu choices are rejected', async () => {
  const output = await runApplication(['0', '5', '4']);

  assert.equal(
    output.split('Invalid choice, please select 1-4.').length - 1,
    2,
  );
});

test('TC-015: non-numeric menu input is rejected safely', async () => {
  const output = await runApplication(['A', '4']);

  assert.match(output, /Invalid choice, please select 1-4\./);
});

test('TC-016: a zero credit is accepted and writes the unchanged balance', async () => {
  const { output, operations } = await executeOperation('CREDIT', '0.00');

  assert.deepEqual(output, ['Amount credited. New balance: 001000.00']);
  assert.equal(operations.dataProgram.execute('READ  '), INITIAL_BALANCE_CENTS);
});

test('TC-017: a zero debit is accepted and writes the unchanged balance', async () => {
  const { output, operations } = await executeOperation('DEBIT ', '0.00');

  assert.deepEqual(output, ['Amount debited. New balance: 001000.00']);
  assert.equal(operations.dataProgram.execute('READ  '), INITIAL_BALANCE_CENTS);
});

test('TC-018 and TC-019: negative amounts are rejected', async () => {
  await assert.rejects(
    () => executeOperation('CREDIT', '-10.00'),
    /Invalid amount/,
  );
  await assert.rejects(
    () => executeOperation('DEBIT ', '-10.00'),
    /Invalid amount/,
  );
});

test('TC-020: crediting to the representable maximum succeeds', async () => {
  const { output, operations } = await executeOperation('CREDIT', '998999.99');

  assert.deepEqual(output, ['Amount credited. New balance: 999999.99']);
  assert.equal(operations.dataProgram.execute('READ  '), MAX_BALANCE_CENTS);
});

test('TC-021: crediting beyond the representable maximum is rejected', async () => {
  await assert.rejects(
    () => executeOperation('CREDIT', '999000.00'),
    /Credit would exceed the supported balance range/,
  );
});

test('TC-022: the smallest positive cent debit succeeds', async () => {
  const { output } = await executeOperation('DEBIT ', '0.01');

  assert.deepEqual(output, ['Amount debited. New balance: 000999.99']);
});

test('TC-023: balance is preserved across total, credit, and debit operations', async () => {
  const operations = createOperations();
  const output = [];
  const execute = (operation, amount) => operations.execute(
    operation,
    async () => amount,
    (message) => output.push(message),
  );

  await execute('TOTAL ');
  await execute('CREDIT', '100.00');
  await execute('TOTAL ');
  await execute('DEBIT ', '25.00');
  await execute('TOTAL ');

  assert.deepEqual(output, [
    'Current balance: 001000.00',
    'Amount credited. New balance: 001100.00',
    'Current balance: 001100.00',
    'Amount debited. New balance: 001075.00',
    'Current balance: 001075.00',
  ]);
});

test('TC-024: a new DataProgram starts with the default balance', () => {
  const firstRun = new DataProgram();
  firstRun.execute('WRITE ', 123456);

  assert.equal(new DataProgram().execute('READ  '), INITIAL_BALANCE_CENTS);
});

test('TC-025: unsupported operation codes do nothing', async () => {
  const dataProgram = new DataProgram();
  dataProgram.execute('WRITE ', 123456);
  const operations = new Operations(dataProgram);
  const output = [];

  await operations.execute('OTHER ', async () => '10.00', (message) => output.push(message));

  assert.deepEqual(output, []);
  assert.equal(dataProgram.execute('READ  '), 123456);
});

test('TC-026: DataProgram READ returns the stored balance', () => {
  const dataProgram = new DataProgram();
  dataProgram.execute('WRITE ', 123456);

  assert.equal(dataProgram.execute('READ  '), 123456);
});

test('TC-027: DataProgram WRITE replaces the stored balance', () => {
  const dataProgram = new DataProgram();

  dataProgram.execute('WRITE ', 123456);

  assert.equal(dataProgram.execute('READ  '), 123456);
});

test('TC-028: only exact six-character operation codes are routed', async () => {
  const operations = createOperations();
  const output = [];

  await operations.execute('TOTAL ', async () => '', (message) => output.push(message));
  await operations.execute('TOTAL', async () => '', (message) => output.push(message));
  await operations.execute('DEBIT ', async () => '1.00', (message) => output.push(message));
  await operations.execute('DEBIT', async () => '1.00', (message) => output.push(message));

  assert.deepEqual(output, [
    'Current balance: 001000.00',
    'Amount debited. New balance: 000999.00',
  ]);
});

test('amount parsing accepts two decimal places and rejects malformed input', () => {
  assert.equal(parseAmount('12.3'), 1230);
  assert.equal(parseAmount('12.34'), 1234);
  assert.throws(() => parseAmount('12.345'), /Invalid amount/);
  assert.throws(() => parseAmount('abc'), /Invalid amount/);
});

test('balance formatting preserves the COBOL zero-padded field width', () => {
  assert.equal(formatBalance(0), '000000.00');
  assert.equal(formatBalance(99999999), '999999.99');
});
