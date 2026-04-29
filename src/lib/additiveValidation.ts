/**
 * Validação fiscal da aba Aditivo.
 *
 * Camada única para indicar o que está OK, o que é aviso e o que bloqueia
 * o avanço (envio para análise / aprovação / "Aditivo Contratado").
 *
 * Regras detalhadas estão documentadas em cada bloco abaixo.
 */
import type { Additive, AdditiveComposition, Project } from '@/types/project';
import { computeAdditiveRow, computeCompositionWithBDI, additiveTotals } from '@/lib/additiveImport';
import { money2 } from '@/lib/financialEngine';

export type AdditiveIssueLevel = 'error' | 'warning' | 'info';

export interface AdditiveValidationIssue {
  level: AdditiveIssueLevel;
  code: string;
  message: string;
  compositionId?: string;
  item?: string;
  serviceCode?: string;
}

const ACCEPTED_BANKS = new Set([
  'SINAPI', 'SBC', 'SICRO3', 'ORSE', 'SIURB', 'CPOS', 'CDHU', 'CPOS/CDHU', 'PRÓPRIO', 'PROPRIO',
]);

const PLACEHOLDER_DESCRIPTIONS = new Set(['', 'novo serviço', 'novo servico']);

const norm = (s: string | undefined | null) =>
  (s ?? '').toString().trim();

const normUpper = (s: string | undefined | null) => norm(s).toUpperCase();

function compRef(c: AdditiveComposition) {
  return {
    compositionId: c.id,
    item: c.item || c.itemNumber,
    serviceCode: c.code,
  };
}

/** Original contratado (s/ aditivos) — usado no limite. */
function originalContractValue(project: Project | undefined): number {
  if (!project) return 0;
  // Preferir budgetItems (Sintética importada). Fallback: totalBudget.
  const items = project.budgetItems ?? [];
  if (items.length > 0) {
    const sum = items
      .filter(i => i.source === 'sintetica')
      .reduce((a, i) => money2(a + (i.totalWithBDI || 0)), 0);
    if (sum > 0) return sum;
  }
  return money2(project.totalBudget || 0);
}

export function validateAdditive(additive: Additive, project?: Project): AdditiveValidationIssue[] {
  const issues: AdditiveValidationIssue[] = [];
  const comps = additive.compositions ?? [];

  // 1. Aditivo sem composições
  if (comps.length === 0) {
    issues.push({
      level: 'error',
      code: 'no-compositions',
      message: 'O aditivo não possui composições.',
    });
  }

  // 2. BDI vazio ou inválido
  const bdi = additive.bdiPercent;
  if (bdi === undefined || bdi === null || Number.isNaN(Number(bdi)) || Number(bdi) < 0) {
    issues.push({
      level: 'error',
      code: 'bdi-missing',
      message: 'Informe o BDI do aditivo.',
    });
  }

  const hasNewService = comps.some(c => c.isNewService === true);

  // 12. Desconto licitatório vazio em aditivo com novos serviços
  if (hasNewService) {
    const disc = additive.globalDiscountPercent;
    if (disc === undefined || disc === null || Number(disc) === 0) {
      issues.push({
        level: 'warning',
        code: 'discount-missing-with-new-services',
        message: 'Há novos serviços e o desconto licitatório não foi informado.',
      });
    }
  }

  for (const c of comps) {
    const ref = compRef(c);
    const isNew = c.isNewService === true;
    const original = c.originalQuantity ?? 0;
    const added = c.addedQuantity ?? 0;
    const suppressed = c.suppressedQuantity ?? 0;

    // 9. Quantidades negativas
    if (original < 0 || added < 0 || suppressed < 0) {
      issues.push({
        level: 'error',
        code: 'negative-quantity',
        message: 'Quantidade negativa não permitida.',
        ...ref,
      });
    }

    // 10. Suprimido > contratado
    if (!isNew && suppressed > original && original > 0) {
      issues.push({
        level: 'error',
        code: 'suppressed-greater-than-original',
        message: 'Quantidade suprimida maior que a contratada.',
        ...ref,
      });
    }

    if (isNew) {
      // 3. Novo serviço sem quantidade acrescida
      if (added <= 0) {
        issues.push({
          level: 'error',
          code: 'new-service-without-added-quantity',
          message: 'Novo serviço sem quantidade acrescida.',
          ...ref,
        });
      }
      // 4. Sem código
      if (!norm(c.code)) {
        issues.push({
          level: 'error',
          code: 'new-service-without-code',
          message: 'Novo serviço sem código de referência.',
          ...ref,
        });
      }
      // 5. Sem banco
      if (!norm(c.bank)) {
        issues.push({
          level: 'error',
          code: 'new-service-without-bank',
          message: 'Novo serviço sem banco de preço.',
          ...ref,
        });
      } else if (!ACCEPTED_BANKS.has(normUpper(c.bank))) {
        // 13. Banco não reconhecido
        issues.push({
          level: 'warning',
          code: 'new-service-bank-not-recognized',
          message: 'Banco de preço não reconhecido para novo serviço.',
          ...ref,
        });
      }
      // 6. Sem descrição válida
      if (PLACEHOLDER_DESCRIPTIONS.has(norm(c.description).toLowerCase())) {
        issues.push({
          level: 'error',
          code: 'new-service-without-description',
          message: 'Novo serviço sem descrição válida.',
          ...ref,
        });
      }
      // 7. Sem analítica
      if ((c.inputs?.length ?? 0) === 0) {
        issues.push({
          level: 'error',
          code: 'new-service-without-analytic',
          message: 'Novo serviço sem composição analítica vinculada.',
          ...ref,
        });
        // 8. Sem preço de referência (somente quando não há analítica)
        if ((c.unitPriceNoBDIInformed ?? 0) <= 0) {
          issues.push({
            level: 'error',
            code: 'new-service-without-reference-price',
            message: 'Novo serviço sem valor de referência s/ BDI.',
            ...ref,
          });
        }
      }
      // 17. Sem vínculo de subcapítulo
      if (!norm(c.phaseId)) {
        issues.push({
          level: 'warning',
          code: 'new-service-without-phase',
          message: 'Novo serviço sem vínculo de subcapítulo.',
          ...ref,
        });
      }
    } else {
      // 11. Item sem alteração (info)
      if (original > 0 && added === 0 && suppressed === 0) {
        issues.push({
          level: 'info',
          code: 'item-without-change',
          message: 'Item sem alteração.',
          ...ref,
        });
      }
      // 14. Composição sintética sem analítica
      if ((c.inputs?.length ?? 0) === 0) {
        issues.push({
          level: 'warning',
          code: 'composition-without-analytic',
          message: 'Composição sem analítica vinculada.',
          ...ref,
        });
      }
    }

    // 15. Diferença entre Sintética e Analítica (somente quando há inputs)
    if ((c.inputs?.length ?? 0) > 0 && bdi !== undefined && bdi !== null) {
      const { totalSyntheticWithBDI, totalAnalyticWithBDI } = computeCompositionWithBDI(c, Number(bdi) || 0);
      const diff = Math.abs(money2(totalSyntheticWithBDI - totalAnalyticWithBDI));
      if (diff > 0.05) {
        issues.push({
          level: 'warning',
          code: 'synthetic-analytic-mismatch',
          message: `Diferença entre valor sintético e analítico (R$ ${diff.toFixed(2)}).`,
          ...ref,
        });
      }
    }
  }

  // 16. Limite de aditivo (impacto líquido sobre o valor contratado original)
  if (comps.length > 0 && (bdi !== undefined && bdi !== null)) {
    const limitPercent = additive.aditivoLimitPercent ?? 50;
    const baseContract = originalContractValue(project);
    const totals = additiveTotals(additive);
    const impactValue = totals.impactoComBDI ?? 0;
    const impactPercent = baseContract > 0
      ? (impactValue / baseContract) * 100
      : (totals.percentImpactoLiquido ?? 0) * 100;
    if (Math.abs(impactPercent) > limitPercent) {
      issues.push({
        level: 'warning',
        code: 'additive-limit-exceeded',
        message: `Impacto líquido ultrapassa o limite definido para o aditivo (${impactPercent.toFixed(2)}% > ${limitPercent}%).`,
      });
    }
  }

  return issues;
}

/** Helpers de agregação para a UI. */
export function summarizeAdditiveIssues(issues: AdditiveValidationIssue[]) {
  return {
    errors: issues.filter(i => i.level === 'error').length,
    warnings: issues.filter(i => i.level === 'warning').length,
    infos: issues.filter(i => i.level === 'info').length,
    total: issues.length,
    blocking: issues.some(i => i.level === 'error'),
  };
}
