import readline from 'node:readline/promises';

export interface SelectChoice {
  label: string;
  detail?: string;
}

/**
 * Present a numbered list on stdout and return the chosen index.
 * Non-interactive environments (no TTY) auto-select the first choice so the
 * agent still completes unattended runs.
 */
export async function selectFromList(title: string, choices: SelectChoice[]): Promise<number> {
  if (choices.length === 0) throw new Error('selectFromList called with no choices');
  if (choices.length === 1) return 0;

  console.log(`\n${title}`);
  choices.forEach((choice, i) => {
    const detail = choice.detail ? `  (${choice.detail})` : '';
    console.log(`  ${i + 1}. ${choice.label}${detail}`);
  });

  if (!process.stdin.isTTY) {
    console.log('No interactive terminal detected — selecting option 1.');
    return 0;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await rl.question(`Select 1-${choices.length}: `);
      const n = Number.parseInt(answer.trim(), 10);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
      console.log('Invalid selection, try again.');
    }
  } finally {
    rl.close();
  }
}
