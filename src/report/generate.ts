import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeTranscript, projectMonthly, type SavingsReport } from './analyze.js';
import { shortModelName, tierEmoji } from '../core/modelLabel.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

function eur(n: number): string {
  return '€' + n.toFixed(2);
}

/** A single labelled bar in the comparison chart. */
function bar(label: string, value: number, max: number, color: string): string {
  const h = max > 0 ? Math.round((value / max) * 240) : 0;
  return `
    <div class="bar-col">
      <div class="bar-val">${eur(value)}</div>
      <div class="bar" style="height:${h}px;background:${color}"></div>
      <div class="bar-label">${label}</div>
    </div>`;
}

function modelRows(byModel: Record<string, number>, total: number): string {
  return Object.entries(byModel)
    .sort((a, b) => b[1] - a[1])
    .map(([m, v]) => {
      const pct = total > 0 ? (v / total) * 100 : 0;
      return `<tr><td>${tierEmoji(m)} ${shortModelName(m)}</td><td class="num">${eur(v)}</td><td class="num">${pct.toFixed(0)}%</td></tr>`;
    })
    .join('');
}

function render(report: SavingsReport, fixtureName: string): string {
  const max = Math.max(report.allOpusEur, report.actualEur, report.idealEur);
  const savedVsActual = report.actualEur - report.idealEur;
  const savedVsActualPct = report.actualEur > 0 ? (savedVsActual / report.actualEur) * 100 : 0;
  const monthly = projectMonthly(savedVsActual);
  const overspend = report.actualEur > report.allOpusEur;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentX — Savings Report</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#0d1117; color:#e6edf3; }
  .wrap { max-width:880px; margin:0 auto; padding:40px 24px 64px; }
  h1 { font-size:26px; margin:0 0 4px; }
  .sub { color:#8b949e; margin:0 0 32px; }
  .headline { font-size:22px; font-weight:600; line-height:1.4; margin:0 0 8px; }
  .headline .save { color:#3fb950; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:24px; margin:20px 0; }
  .chart { display:flex; align-items:flex-end; gap:36px; height:300px; padding:16px 8px 0; justify-content:center; }
  .bar-col { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; width:120px; }
  .bar { width:88px; border-radius:8px 8px 0 0; transition:height .4s; }
  .bar-val { font-weight:600; margin-bottom:6px; }
  .bar-label { margin-top:10px; color:#8b949e; text-align:center; font-size:14px; }
  .stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .stat { background:#0d1117; border:1px solid #30363d; border-radius:10px; padding:16px; }
  .stat .big { font-size:28px; font-weight:700; }
  .stat .lbl { color:#8b949e; font-size:13px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:8px 4px; border-bottom:1px solid #21262d; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .note { color:#8b949e; font-size:13px; }
  .warn { color:#d29922; }
  .foot { color:#6e7681; font-size:12px; margin-top:28px; }
</style></head>
<body><div class="wrap">
  <h1>AgentX — Cost-Aware Autopilot</h1>
  <p class="sub">Savings report · session <code>${fixtureName}</code> · ${report.turns} billable turns</p>

  <p class="headline">
    You'd have spent <b>${eur(report.allOpusEur)}</b> on all-Opus.<br>
    Autopilot ideal: <b>${eur(report.idealEur)}</b>. <span class="save">Saved ${report.savedPct.toFixed(0)}%.</span>
  </p>

  <div class="card">
    <div class="chart">
      ${bar('All-Opus<br>baseline', report.allOpusEur, max, '#f85149')}
      ${bar('Actual<br>(as run)', report.actualEur, max, '#d29922')}
      ${bar('Autopilot<br>ideal', report.idealEur, max, '#3fb950')}
    </div>
  </div>

  ${overspend ? `<p class="note warn">⚠ Actual (${eur(report.actualEur)}) exceeded the all-Opus baseline (${eur(report.allOpusEur)}) — this session sent a large share to a tier pricier than Opus (e.g. Fable). Autopilot would have avoided that.</p>` : ''}

  <div class="card stat-grid">
    <div class="stat"><div class="big save" style="color:#3fb950">${savedVsActualPct.toFixed(0)}%</div><div class="lbl">Saved vs actual spend (${eur(report.actualEur)} → ${eur(report.idealEur)})</div></div>
    <div class="stat"><div class="big save" style="color:#3fb950">${eur(monthly.monthlyEur)}/mo</div><div class="lbl">Projected monthly saving (${monthly.assumption})</div></div>
  </div>

  <div class="card">
    <h3 style="margin:0 0 12px">Actual spend by model</h3>
    <table><tbody>${modelRows(report.byModelEur, report.actualEur)}</tbody></table>
  </div>

  <p class="foot">
    Baseline = every turn re-priced on Opus. Ideal = every turn at the classifier's recommended tier.
    Monthly projection is an explicit estimate, not measured: ${monthly.assumption}.
    Generated by AgentX · pricing from <code>src/core/pricing.json</code>.
  </p>
</div></body></html>`;
}

async function main(): Promise<void> {
  const fixture = process.argv[2] ?? join(root, 'fixtures', 'session-sample.jsonl');
  const report = await analyzeTranscript(fixture);
  const html = render(report, fixture.split('/').pop() ?? 'session');
  const out = join(root, 'report.html');
  writeFileSync(out, html);

  // Console summary so the CLI is useful without opening the browser.
  console.log('');
  console.log(`  All-Opus baseline : ${eur(report.allOpusEur)}`);
  console.log(`  Actual (as run)   : ${eur(report.actualEur)}`);
  console.log(`  Autopilot ideal   : ${eur(report.idealEur)}`);
  console.log(`  Saved vs baseline : ${eur(report.savedVsBaselineEur)} (${report.savedPct.toFixed(0)}%)`);
  console.log(`  Opus share        : ${report.opusSharePct.toFixed(0)}% → ${report.idealOpusSharePct.toFixed(0)}% (ideal)`);
  console.log('');
  console.log(`  → wrote ${out}`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
