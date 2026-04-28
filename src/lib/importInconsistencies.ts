import * as XLSX from 'xlsx';
import { ParseResult, ParsedChapter, ParsedComposition, ImportIssue, ImportSummary } from './importParser';

/** Build a stable key per composition matching the dialog's compKey scheme. */
export function buildCompKeyMap(chapters: ParsedChapter[]): Map<ParsedComposition, string> {
  const map = new Map<ParsedComposition, string>();
  function walk(list: ParsedChapter[], prefix: string) {
    list.forEach((ch, i) => {
      const key = prefix ? `${prefix}-c${i}` : String(i);
      ch.compositions.forEach((c, ci) => map.set(c, `${key}-${ci}`));
      walk(ch.children, key);
    });
  }
  walk(chapters, '');
  return map;
}

/** Returns issues with compKey populated when applicable. */
export function attachCompKeys(result: ParseResult): ImportIssue[] {
  const compKeys = buildCompKeyMap(result.chapters);
  const lineToKey = new Map<number, string>();
  compKeys.forEach((k, comp) => { if (comp.sourceLine) lineToKey.set(comp.sourceLine, k); });

  return result.issues.map(iss => {
    if (iss.compKey) return iss;
    // Try to associate via composition source line or by matching comp.code
    if (iss.line && lineToKey.has(iss.line)) return { ...iss, compKey: lineToKey.get(iss.line) };
    if (iss.code) {
      for (const [comp, key] of compKeys) {
        if (comp.code === iss.code) return { ...iss, compKey: key };
      }
    }
    return iss;
  });
}

export function summarize(result: ParseResult, selectedKeys: Set<string>): ImportSummary {
  let chapters = 0, subchapters = 0, labors = 0, compositions = 0;

  function walk(list: ParsedChapter[]) {
    for (const ch of list) {
      if (ch.kind === 'subchapter') subchapters++;
      else chapters++;
      for (const c of ch.compositions) {
        compositions++;
        labors += c.labor.length;
      }
      walk(ch.children);
    }
  }
  walk(result.chapters);

  const errors = result.issues.filter(i => i.level === 'error').length;
  const warnings = result.issues.filter(i => i.level === 'warning').length;

  // Produtividade não importa preço — campos withPrice/withoutPrice ficam zerados.
  return {
    chapters, subchapters, compositions,
    selectedCompositions: selectedKeys.size,
    labors, errors, warnings, withPrice: 0, withoutPrice: 0,
  };
}

/** Build the list of info-level entries derived from the summary. */
export function buildInfoEntries(summary: ImportSummary): ImportIssue[] {
  return [
    { level: 'info', message: `Capítulos detectados: ${summary.chapters}` },
    { level: 'info', message: `Subcapítulos detectados: ${summary.subchapters}` },
    { level: 'info', message: `Composições detectadas: ${summary.compositions}` },
    { level: 'info', message: `Mão de obra detectada: ${summary.labors}` },
  ];
}

export function downloadInconsistencyReport(
  result: ParseResult,
  summary: ImportSummary,
  fileName = 'relatorio_inconsistencias_importacao.xlsx',
) {
  const all: ImportIssue[] = [...buildInfoEntries(summary), ...result.issues];

  const headerRow = ['Linha', 'Nível', 'Código', 'Banco', 'Tipo', 'Descrição', 'Problema', 'Ação Sugerida'];
  const levelLabel = (l: ImportIssue['level']) =>
    l === 'error' ? 'Erro' : l === 'warning' ? 'Aviso' : 'Informação';

  const dataRows = all.map(i => [
    i.line ?? '',
    levelLabel(i.level),
    i.code ?? '',
    i.bank ?? '',
    i.type ?? '',
    i.description ?? '',
    i.message,
    i.suggestion ?? '',
  ]);

  const summaryRows = [
    ['Resumo da Importação'],
    ['Capítulos', summary.chapters],
    ['Subcapítulos', summary.subchapters],
    ['Composições detectadas', summary.compositions],
    ['Composições selecionadas', summary.selectedCompositions],
    ['Mão de obra (insumos)', summary.labors],
    ['Erros', summary.errors],
    ['Avisos', summary.warnings],
    ['Com preço s/ BDI', summary.withPrice],
    ['Sem preço s/ BDI', summary.withoutPrice],
    [],
  ];

  const aoa = [...summaryRows, headerRow, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
    { wch: 50 }, { wch: 50 }, { wch: 50 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inconsistências');
  XLSX.writeFile(wb, fileName);
}
