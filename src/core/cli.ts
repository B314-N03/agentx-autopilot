import { parseTranscript, aggregateByModel } from './costEngine.js';

function eur(n: number): string {
  return '€' + n.toFixed(2);
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: npm run cost <transcript.jsonl>');
    process.exit(1);
  }

  const turns = await parseTranscript(path);
  const byModel = aggregateByModel(turns);
  const total = turns.reduce((s, t) => s + t.costEur, 0);

  const rows = Object.entries(byModel).sort((a, b) => b[1].costEur - a[1].costEur);
  const nameW = Math.max(5, ...rows.map(([m]) => m.length));

  console.log('');
  console.log(`  ${'model'.padEnd(nameW)}  ${'turns'.padStart(6)}  ${'cost'.padStart(9)}  share`);
  console.log(`  ${'-'.repeat(nameW)}  ${'-'.repeat(6)}  ${'-'.repeat(9)}  -----`);
  for (const [model, { costEur, turns: n }] of rows) {
    const share = total > 0 ? ((costEur / total) * 100).toFixed(0) + '%' : '0%';
    console.log(
      `  ${model.padEnd(nameW)}  ${String(n).padStart(6)}  ${eur(costEur).padStart(9)}  ${share.padStart(5)}`,
    );
  }
  console.log(`  ${'-'.repeat(nameW)}  ${'-'.repeat(6)}  ${'-'.repeat(9)}  -----`);
  console.log(
    `  ${'TOTAL'.padEnd(nameW)}  ${String(turns.length).padStart(6)}  ${eur(total).padStart(9)}`,
  );
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
