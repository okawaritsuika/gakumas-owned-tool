import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './catalog.mjs';
import { loadInventory } from './inventory.mjs';
import { comparePersonalized } from './personalized-comparison.mjs';
import { buildAccountPlaybook } from './account-playbook.mjs';
import { simulateConsultationChoices } from './consultation-simulation.mjs';
import { buildProduceResourceLedger } from './produce-resource-ledger.mjs';
import { refinePersonalizedCandidates } from './refine-personalized.mjs';
import { compactComparison } from './personalized-output.mjs';
import { buildWeekChoiceAdvice } from './week-choice-advice.mjs';
import { buildExamStatTargets } from './exam-stat-targets.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const catalog = loadCatalog({ dataDir: path.join(appDir, 'data/catalog'), translationDir: path.join(appDir, 'data/translations') });
  const { inventory } = await loadInventory(request.snapshotPath ?? path.join(appDir, 'data/inventory.json'), catalog);
  let result = await comparePersonalized({ inventory, catalog, options: request.options ?? {}, runs: request.runs ?? 8 });
  const refinementRuns = request.options?.refinementRuns ?? 128;
  if (refinementRuns !== 0) result = await refinePersonalizedCandidates({ comparison: result, catalog, runs: refinementRuns });
  const selectedId = result.recommendedCurrentCandidateId ?? result.bestCurrentPreviewCandidateId ?? result.bestPreviewCandidateId;
  const selected = result.candidates?.find(candidate => candidate.id === selectedId);
  if (selected) {
    result.accountPlaybook = buildAccountPlaybook({ result: selected, inventory, catalog, options: request.options ?? {} });
    result.resourceLedger = buildProduceResourceLedger({ candidate: selected, result: selected, inventory, catalog, options: request.options ?? {} });
    const targets = Array.from({ length: 5 }, (_, examIndex) => buildExamStatTargets({ candidate: selected, result: selected, catalog, examIndex }));
    result.accountPlaybook.weekPlan = (result.accountPlaybook.weekPlan ?? []).map(row => {
      const examIndex = row.week <= 7 ? 0 : row.week <= 13 ? 1 : row.week <= 20 ? 2 : row.week <= 27 ? 3 : 4;
      const statTargets = targets[examIndex];
      return { ...row, nextExamTargets: statTargets,
        choiceAdvice: buildWeekChoiceAdvice({ book: result.accountPlaybook, result: selected, candidate: selected,
          resourceLedger: result.resourceLedger, catalog, week: row.week, liveState: {}, statTargets }) };
    });
    result.consultationPlan = await simulateConsultationChoices({ candidate: selected, catalog, runs: request.runs ?? 8 });
  }
  process.stdout.write(JSON.stringify(compactComparison(result)));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'error', error: { message: error.message ?? '계정별 비교를 완료하지 못했습니다.' } }));
  process.exitCode = 1;
}
