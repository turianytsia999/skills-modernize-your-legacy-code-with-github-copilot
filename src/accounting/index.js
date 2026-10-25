'use strict';

const readline = require('node:readline');

const INITIAL_BALANCE_CENTS = 100000;
const MAX_BALANCE_CENTS = 99999999;

function formatBalance(balanceCents) {
  return (balanceCents / 100).toFixed(2).padStart(9, '0');
}

function parseAmount(input) {
  const value = String(input).trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Invalid amount, please enter a non-negative amount with up to two decimal places.');
  }

  const [whole, fraction = ''] = value.split('.');
  const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(amountCents) || amountCents > MAX_BALANCE_CENTS) {
    throw new Error('Amount is outside the supported balance range.');
  }

  return amountCents;
}

class DataProgram {
  constructor() {
    this.storageBalanceCents = INITIAL_BALANCE_CENTS;
  }

  execute(operation, balanceCents) {
    const operationType = String(operation);

    if (operationType === 'READ  ') {
      return this.storageBalanceCents;
    }

    if (operationType === 'WRITE ') {
      this.storageBalanceCents = balanceCents;
    }

    return balanceCents;
  }
}

class Operations {
  constructor(dataProgram = new DataProgram()) {
    this.dataProgram = dataProgram;
  }

  async execute(operation, ask, output) {
    const operationType = String(operation);

    if (operationType === 'TOTAL ') {
      const balanceCents = this.dataProgram.execute('READ  ');
      output(`Current balance: ${formatBalance(balanceCents)}`);
      return;
    }

    if (operationType !== 'CREDIT' && operationType !== 'DEBIT ') {
      return;
    }

    const prompt = operationType === 'CREDIT'
      ? 'Enter credit amount: '
      : 'Enter debit amount: ';
    const amountCents = parseAmount(await ask(prompt));
    const balanceCents = this.dataProgram.execute('READ  ');

    if (operationType === 'DEBIT ' && balanceCents < amountCents) {
      output('Insufficient funds for this debit.');
      return;
    }

    const updatedBalanceCents = operationType === 'CREDIT'
      ? balanceCents + amountCents
      : balanceCents - amountCents;

    if (updatedBalanceCents > MAX_BALANCE_CENTS) {
      throw new Error('Credit would exceed the supported balance range.');
    }

    this.dataProgram.execute('WRITE ', updatedBalanceCents);
    const message = operationType === 'CREDIT'
      ? 'Amount credited.'
      : 'Amount debited.';
    output(`${message} New balance: ${formatBalance(updatedBalanceCents)}`);
  }
}

async function run(input = process.stdin, output = process.stdout) {
  const reader = readline.createInterface({ input, output });
  const ask = (prompt) => new Promise((resolve) => reader.question(prompt, resolve));
  const operations = new Operations();
  let continueRunning = true;

  try {
    while (continueRunning) {
      output.write('--------------------------------\n');
      output.write('Account Management System\n');
      output.write('1. View Balance\n');
      output.write('2. Credit Account\n');
      output.write('3. Debit Account\n');
      output.write('4. Exit\n');
      output.write('--------------------------------\n');

      const choice = await ask('Enter your choice (1-4): ');

      switch (choice.trim()) {
        case '1':
          await operations.execute('TOTAL ', ask, (message) => output.write(`${message}\n`));
          break;
        case '2':
          await operations.execute('CREDIT', ask, (message) => output.write(`${message}\n`));
          break;
        case '3':
          await operations.execute('DEBIT ', ask, (message) => output.write(`${message}\n`));
          break;
        case '4':
          continueRunning = false;
          break;
        default:
          output.write('Invalid choice, please select 1-4.\n');
      }
    }

    output.write('Exiting the program. Goodbye!\n');
  } finally {
    reader.close();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DataProgram,
  Operations,
  formatBalance,
  parseAmount,
  run,
  INITIAL_BALANCE_CENTS,
  MAX_BALANCE_CENTS,
};
