import type {
  Additive,
  AdditiveComposition,
  AdditiveInput,
  AdditiveImportIssue,
  AdditiveChangeKind,
  Project,
} from '@/types/project';

const uid = () => Math.random().toString(36).slice(2, 10);

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/[^\d.,\-]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Trunca para 2 casas decimais (sem arredondar para cima). */
export function truncar2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.trunc(v * 100) / 100;
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/**
 * Normaliza código para casamento Sintética x Analítica.
 * Remove zeros à esquerda da parte numérica imediatamente após letras
 * (ADM04 -> ADM4, C0002 -> C2). Mantém códigos puramente numéricos com zeros.
 */
function normalizeCode(raw: string): string {
  if (!raw) return '';
  let s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  s = s.replace(/[\u00A0\u200B-\u200D\uFEFF]/g, '');
  const m = s.match(/^([A-Z]+)(0+)(\d+)(.*)$/);
  if (m) return `${m[1]}${m[3]}${m[4]}`;
  return s;
}

function findSheetName(names: string[], target: string): string | undefined {
  const t = norm(target);
  return names.find(n => norm(n) === t) || names.find(n => norm(n).includes(t));
}

function sheetToRows(ws: any, XLSX: any): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
}

/** Procura linha de cabeçalho contendo termos típicos. */
function detectHeaderIndex(rows: unknown[][]): number {
  const HINTS = ['item', 'codigo', 'código', 'descricao', 'descrição', 'banco', 'unidade'];
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const joined = (rows[i] || []).map(c => norm(asString(c))).join(' | ');
    let hits = 0;
    for (const h of HINTS) if (joined.includes(norm(h))) hits++;
    if (hits >= 3) return i;
  }
  return 0;
}

/** Lê BDI percentual da célula J8 (linha 8, coluna J = índice 9) da Sintética. */
function extractBdiFromJ8(rows: unknown[][]): number | undefined {
  const direct = toNumber(rows[7]?.[9]);
  if (direct > 0 && direct < 200) return direct;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = rows[i] || [];
    for (let c = 0; c < r.length; c++) {
      const v = norm(asString(r[c]));
      if (v.includes('bdi')) {
        for (let cc = c + 1; cc < r.length; cc++) {
          const n = toNumber(r[cc]);
          if (n > 0 && n < 200) return n;
        }
      }
    }
  }
  return undefined;
}

interface SyntheticRow {
  item: string;
  code: string;
  bank: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceNoBDI: number;
  unitPriceWithBDI: number;
  total: number;
  rowIndex: number;
}

interface AnalyticRow {
  code: string;
  bank: string;
  description: string;
  unit: string;
  coefficient: number;
  unitPrice: number;
  total: number;
  rowIndex: number;
}

interface AnalyticBlock {
  normCode: string;
  code: string;
  inputs: AnalyticRow[];
  parentTotalNoBDI?: number;
  startRow: number;
}

/**
 * Parser SINTÉTICA — layout fixo A..J.
 */
function parseSyntheticSheet(rows: unknown[][]): { items: SyntheticRow[]; issues: AdditiveImportIssue[]; bdi?: number } {
  const issues: AdditiveImportIssue[] = [];
  const headerIdx = detectHeaderIndex(rows);
  const items: SyntheticRow[] = [];
  const bdi = extractBdiFromJ8(rows);

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const item = asString(r[0]);
    const code = asString(r[1]);
    const bank = asString(r[2]);
    const description = asString(r[3]);
    const quantity = toNumber(r[4]);
    const unit = asString(r[5]);
    const unitPriceNoBDI = toNumber(r[6]);
    const total = toNumber(r[7]);
    const unitPriceWithBDI = toNumber(r[8]);

    if (!item && !code && !bank && !description && !quantity && !total && !unitPriceNoBDI) continue;
    const lowDesc = norm(description);
    if (!code && (lowDesc.includes('total') || lowDesc.includes('subtotal'))) continue;
    if (!bank) continue; // capítulos
    if (!code) continue;

    if (quantity <= 0) {
      issues.push({ level: 'warning', message: `Quantidade inválida ou zero (${code})`, code, line: i + 1 });
    }
    if (unitPriceNoBDI <= 0) {
      issues.push({ level: 'warning', message: `Valor unit. s/ BDI inválido (${code})`, code, line: i + 1 });
    }

    items.push({
      item, code, bank, description, quantity, unit,
      unitPriceNoBDI,
      unitPriceWithBDI: unitPriceWithBDI || 0,
      total: total || +(unitPriceNoBDI * quantity).toFixed(2),
      rowIndex: i + 1,
    });
  }

  return { items, issues, bdi };
}

/**
 * Verifica se a célula da coluna A indica um item de insumo da analítica.
 * Aceita: "Insumo", "Auxiliar", "Comp. Auxiliar", "Comp Auxiliar", "Composição Auxiliar".
 */
function isAnalyticInsumoLine(aLow: string): boolean {
  if (!aLow) return false;
  if (aLow === 'insumo' || aLow.startsWith('insumo')) return true;
  if (aLow === 'auxiliar' || aLow.startsWith('auxiliar')) return true;
  // Comp. Auxiliar / Comp Auxiliar / Composicao Auxiliar / Composição Auxiliar
  if (/(^|\s)(comp\.?|composicao|composição)\s+aux/.test(aLow)) return true;
  return false;
}

/**
 * Parser ANALÍTICA.
 * Linha pai: A é numérico (item ex. "2.1.1") + B (código) + C (banco) preenchidos.
 * O bloco do pai termina apenas quando aparece a próxima linha pai.
 * Linhas com A = "Insumo"/"Auxiliar"/"Comp. Auxiliar"/etc são insumos.
 * Linha "Valor com BDI =" é ignorada como insumo.
 */
function parseAnalyticSheet(
  rows: unknown[][],
): { blocks: AnalyticBlock[]; issues: AdditiveImportIssue[] } {
  const issues: AdditiveImportIssue[] = [];
  const headerIdx = detectHeaderIndex(rows);
  const blocks: AnalyticBlock[] = [];
  let current: AnalyticBlock | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const aRaw = asString(r[0]);
    const codeRaw = asString(r[1]);
    const bank = asString(r[2]);
    const description = asString(r[3]);
    const coefficient = toNumber(r[4]);
    const unit = asString(r[5]);
    const unitPrice = toNumber(r[6]);
    const total = toNumber(r[7]);

    if (!aRaw && !codeRaw && !description && !coefficient && !unitPrice) continue;

    const aLow = norm(aRaw);
    const dLow = norm(description);

    // Linha "Valor com BDI =" → ignora completamente como insumo
    if (
      dLow.includes('valor com bdi') ||
      aLow.includes('valor com bdi') ||
      norm(asString(r[6])).includes('valor com bdi') ||
      norm(asString(r[5])).includes('valor com bdi')
    ) {
      continue;
    }

    // Detecta linha pai: A é número (item tipo "1", "2.1.4") e B/C preenchidos.
    const isParentLine =
      !!codeRaw && !!bank && /^\d+(\.\d+)*$/.test(aRaw.replace(',', '.'));

    if (isParentLine) {
      current = {
        normCode: normalizeCode(codeRaw),
        code: codeRaw,
        inputs: [],
        parentTotalNoBDI: total > 0 ? total : undefined,
        startRow: i + 1,
      };
      blocks.push(current);
      continue;
    }

    if (!isAnalyticInsumoLine(aLow)) continue;
    if (!current) continue;
    if (!codeRaw && !description) continue;

    if (unitPrice <= 0) {
      issues.push({ level: 'warning', message: `Insumo sem preço (${codeRaw || description})`, line: i + 1 });
    }

    current.inputs.push({
      code: codeRaw, bank, description, unit, coefficient, unitPrice, total,
      rowIndex: i + 1,
    });
  }

  return { blocks, issues };
}

export async function importAdditiveFromExcel(file: File, additiveName: string): Promise<Additive> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });

  const allIssues: AdditiveImportIssue[] = [];
  const synthName = findSheetName(wb.SheetNames, 'Sintetica') || findSheetName(wb.SheetNames, 'sintética');
  const analyName = findSheetName(wb.SheetNames, 'Analitica') || findSheetName(wb.SheetNames, 'analítica');

  if (!synthName) {
    allIssues.push({ level: 'error', message: 'Aba Sintética não encontrada' });
    return {
      id: uid(), name: additiveName, importedAt: new Date().toISOString(),
      compositions: [], issues: allIssues, status: 'rascunho',
    };
  }

  const synthRows = sheetToRows(wb.Sheets[synthName], XLSX);
  const { items: synthItems, issues: synthIssues, bdi } = parseSyntheticSheet(synthRows);
  allIssues.push(...synthIssues);

  let analyticBlocks: AnalyticBlock[] = [];
  if (!analyName) {
    allIssues.push({ level: 'warning', message: 'Aba Analítica não encontrada — composições ficarão sem insumos.' });
  } else {
    const analyRows = sheetToRows(wb.Sheets[analyName], XLSX);
    const result = parseAnalyticSheet(analyRows);
    analyticBlocks = result.blocks;
    allIssues.push(...result.issues);
  }

  // Vinculação por OCORRÊNCIA via fila por código normalizado.
  const queueByCode = new Map<string, AnalyticBlock[]>();
  for (const b of analyticBlocks) {
    const key = b.normCode;
    if (!queueByCode.has(key)) queueByCode.set(key, []);
    queueByCode.get(key)!.push(b);
  }

  const bdiPercent = bdi ?? 0;
  const fator = 1 + bdiPercent / 100;

  const compositions: AdditiveComposition[] = synthItems.map(s => {
    const key = normalizeCode(s.code);
    const queue = queueByCode.get(key);
    const block = queue && queue.length > 0 ? queue.shift()! : undefined;
    const rawInputs = block?.inputs ?? [];
    const inputs: AdditiveInput[] = rawInputs.map(r => ({
      id: uid(),
      code: r.code,
      bank: r.bank,
      description: r.description,
      unit: r.unit,
      coefficient: r.coefficient,
      unitPrice: r.unitPrice,
      total: r.total || +(r.coefficient * r.unitPrice).toFixed(2),
    }));

    const unitPriceWithBDI = bdiPercent > 0
      ? truncar2(s.unitPriceNoBDI * fator)
      : (s.unitPriceWithBDI || truncar2(s.unitPriceNoBDI * fator));
    const total = truncar2(unitPriceWithBDI * s.quantity);

    if (inputs.length === 0) {
      allIssues.push({ level: 'warning', message: `Composição sintética sem analítico vinculado (${s.code})`, code: s.code });
    }

    return {
      id: uid(),
      item: s.item,
      code: s.code,
      bank: s.bank,
      description: s.description,
      quantity: s.quantity,
      unit: s.unit,
      unitPriceNoBDI: s.unitPriceNoBDI,
      unitPriceWithBDI,
      total,
      inputs,
      // Por padrão, novas composições do aditivo são acrescidas
      changeKind: 'acrescido',
      originalQuantity: 0,
      addedQuantity: s.quantity,
      suppressedQuantity: 0,
    };
  });

  let leftover = 0;
  for (const q of queueByCode.values()) leftover += q.length;
  if (leftover > 0) {
    allIssues.push({ level: 'warning', message: `${leftover} bloco(s) analítico(s) sem composição sintética correspondente foram ignorados.` });
  }

  const totalInputs = compositions.reduce((a, c) => a + c.inputs.length, 0);
  allIssues.unshift(
    { level: 'info', message: `Total de composições importadas: ${compositions.length}` },
    { level: 'info', message: `Total de insumos importados: ${totalInputs}` },
    { level: 'info', message: `BDI lido da planilha (J8): ${bdiPercent ? bdiPercent.toFixed(2) + '%' : 'não encontrado'}` },
  );

  return {
    id: uid(),
    name: additiveName,
    importedAt: new Date().toISOString(),
    compositions,
    issues: allIssues,
    bdiPercent,
    status: 'rascunho',
  };
}

/** Soma dos totais H dos insumos da Analítica (sem BDI), por unidade da composição. */
export function sumAnalyticTotalNoBDI(comp: AdditiveComposition): number {
  return comp.inputs.reduce((a, i) => a + (i.total || 0), 0);
}

/**
 * Quantidade efetiva da composição considerando supressão e acréscimo.
 * Se changeKind for 'suprimido', a quantidade efetiva é negativa para fins de impacto financeiro.
 */
export function effectiveQuantity(c: AdditiveComposition): number {
  if (c.changeKind === 'suprimido') {
    return -(c.suppressedQuantity ?? c.quantity ?? 0);
  }
  if (c.changeKind === 'sem_alteracao') return 0;
  return c.addedQuantity ?? c.quantity ?? 0;
}

/** Quantidade total após o aditivo (originalQuantity + addedQuantity − suppressedQuantity). */
export function totalAfterAdditive(c: AdditiveComposition): number {
  const orig = c.originalQuantity ?? 0;
  const add = c.addedQuantity ?? 0;
  const sup = c.suppressedQuantity ?? 0;
  return orig + add - sup;
}

/**
 * Recalcula valores da composição com base no BDI atual (editável).
 * Usa a quantidade efetiva (acréscimo/supressão) para o impacto financeiro.
 */
export function computeCompositionWithBDI(comp: AdditiveComposition, bdiPercent: number) {
  const fator = 1 + (bdiPercent || 0) / 100;
  const unitPriceWithBDI = truncar2(comp.unitPriceNoBDI * fator);
  const qty = comp.quantity || 0;
  const totalSyntheticWithBDI = truncar2(unitPriceWithBDI * qty);
  const sumAnalyticNoBDI = sumAnalyticTotalNoBDI(comp);
  const totalAnalyticWithBDI = truncar2(sumAnalyticNoBDI * fator * qty);
  const diff = +(totalAnalyticWithBDI - totalSyntheticWithBDI).toFixed(2);
  // Impacto financeiro considerando acréscimo/supressão
  const effQty = effectiveQuantity(comp);
  const impactoSemBDI = truncar2(comp.unitPriceNoBDI * effQty);
  const impactoComBDI = truncar2(unitPriceWithBDI * effQty);
  return {
    unitPriceWithBDI, totalSyntheticWithBDI, sumAnalyticNoBDI, totalAnalyticWithBDI, diff,
    impactoSemBDI, impactoComBDI,
  };
}

export function additiveTotals(add: Additive) {
  const bdi = add.bdiPercent ?? 0;
  const compCount = add.compositions.length;
  const totalSemBDI = add.compositions.reduce((a, c) => a + (c.unitPriceNoBDI * c.quantity), 0);
  const totalComBDI = add.compositions.reduce((a, c) => {
    const { totalSyntheticWithBDI } = computeCompositionWithBDI(c, bdi);
    return a + totalSyntheticWithBDI;
  }, 0);
  // Impacto líquido (acrescido positivo, suprimido negativo)
  const impactoSemBDI = add.compositions.reduce((a, c) => a + computeCompositionWithBDI(c, bdi).impactoSemBDI, 0);
  const impactoComBDI = add.compositions.reduce((a, c) => a + computeCompositionWithBDI(c, bdi).impactoComBDI, 0);
  const inputCount = add.compositions.reduce((a, c) => a + c.inputs.length, 0);
  const semAnalitico = add.compositions.filter(c => c.inputs.length === 0).length;
  const acrescidos = add.compositions.filter(c => (c.changeKind ?? 'acrescido') === 'acrescido').length;
  const suprimidos = add.compositions.filter(c => c.changeKind === 'suprimido').length;
  return {
    compCount, totalSemBDI, totalComBDI, total: totalComBDI,
    inputCount, semAnalitico, acrescidos, suprimidos,
    impactoSemBDI, impactoComBDI,
  };
}

// ============= Integração com o Projeto =============

export interface ApprovedAdditiveItem {
  additiveId: string;
  additiveName: string;
  compositionId: string;
  item: string;
  code: string;
  bank: string;
  description: string;
  unit: string;
  changeKind: AdditiveChangeKind;
  originalQuantity: number;
  suppressedQuantity: number;
  addedQuantity: number;
  totalAfter: number;
  unitPriceNoBDI: number;
  unitPriceWithBDI: number;
  status: 'aprovado';
  approvedAt?: string;
  approvedBy?: string;
}

/** Retorna itens dos aditivos APROVADOS, prontos para integrar com Medição/Tarefas/Diário. */
export function getApprovedAdditiveItems(project: Project): ApprovedAdditiveItem[] {
  const out: ApprovedAdditiveItem[] = [];
  const adds = project.additives ?? [];
  for (const a of adds) {
    if (a.status !== 'aprovado') continue;
    const bdi = a.bdiPercent ?? 0;
    const fator = 1 + bdi / 100;
    for (const c of a.compositions) {
      const upWithBDI = truncar2(c.unitPriceNoBDI * fator);
      out.push({
        additiveId: a.id,
        additiveName: a.name,
        compositionId: c.id,
        item: c.item,
        code: c.code,
        bank: c.bank,
        description: c.description,
        unit: c.unit,
        changeKind: c.changeKind ?? 'acrescido',
        originalQuantity: c.originalQuantity ?? 0,
        suppressedQuantity: c.suppressedQuantity ?? 0,
        addedQuantity: c.addedQuantity ?? c.quantity ?? 0,
        totalAfter: totalAfterAdditive(c),
        unitPriceNoBDI: c.unitPriceNoBDI,
        unitPriceWithBDI: upWithBDI,
        status: 'aprovado',
        approvedAt: a.approvedAt,
        approvedBy: a.approvedBy,
      });
    }
  }
  return out;
}

// ============= Exportações =============

export async function exportAdditiveToExcel(add: Additive) {
  const XLSX = await import('xlsx');
  const bdi = add.bdiPercent ?? 0;
  const synthHeader = [
    'Item', 'Código', 'Banco', 'Discriminação', 'Und',
    'Quant. Contrat.', 'Itens Suprimidos', 'Itens Aditivados', 'Total após Troca',
    'V.Unit s/BDI', 'V.Unit c/BDI',
    'Impacto s/BDI', 'Impacto c/BDI',
    'Soma Analítica s/BDI', 'Total Analítico c/BDI', 'Diferença',
  ];
  const synthRows = add.compositions.map(c => {
    const r = computeCompositionWithBDI(c, bdi);
    return [
      c.item, c.code, c.bank, c.description, c.unit,
      c.originalQuantity ?? 0,
      c.suppressedQuantity ?? 0,
      c.addedQuantity ?? c.quantity,
      totalAfterAdditive(c),
      c.unitPriceNoBDI, r.unitPriceWithBDI,
      r.impactoSemBDI, r.impactoComBDI,
      r.sumAnalyticNoBDI, r.totalAnalyticWithBDI, r.diff,
    ];
  });
  const wsSynth = XLSX.utils.aoa_to_sheet([
    [`Aditivo: ${add.name}`],
    [`BDI: ${bdi.toFixed(2)}%   |   Status: ${add.status ?? 'rascunho'}`],
    [],
    synthHeader,
    ...synthRows,
  ]);

  const analyHeader = [
    'Item composição', 'Código composição', 'Descrição composição',
    'Código insumo', 'Banco', 'Descrição insumo',
    'Unidade', 'Coeficiente', 'V.Unit s/BDI', 'Total s/BDI',
  ];
  const analyRows: (string | number)[][] = [];
  for (const c of add.compositions) {
    for (const i of c.inputs) {
      analyRows.push([
        c.item, c.code, c.description,
        i.code, i.bank, i.description,
        i.unit, i.coefficient, i.unitPrice, i.total,
      ]);
    }
  }
  const wsAnaly = XLSX.utils.aoa_to_sheet([analyHeader, ...analyRows]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSynth, 'Sintetica');
  XLSX.utils.book_append_sheet(wb, wsAnaly, 'Analitica');
  XLSX.writeFile(wb, `${add.name.replace(/[^\w\d-]+/g, '_')}.xlsx`);
}

export async function exportAdditiveToPdf(
  add: Additive,
  projectName: string,
  showAnalytic: boolean,
) {
  const [{ default: jsPDF }, autoTableMod, branding] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('./companyBranding'),
  ]);
  const autoTable = (autoTableMod as any).default || autoTableMod;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  const bdi = add.bdiPercent ?? 0;

  const logo = await branding.loadCompanyLogoForPdf().catch(() => null);
  let cursorY = margin;

  if (logo) {
    const targetH = 12;
    const targetW = (logo.width / logo.height) * targetH;
    try { doc.addImage(logo.dataUrl, 'PNG', margin, cursorY, targetW, targetH); } catch {}
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`ADITIVO — ${add.name.toUpperCase()}`, pageWidth / 2, cursorY + 6, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Obra: ${projectName}`, pageWidth / 2, cursorY + 11, { align: 'center' });
  doc.text(
    `Emitido em: ${new Date().toLocaleDateString('pt-BR')}   |   BDI: ${bdi.toFixed(2)}%   |   Status: ${(add.status ?? 'rascunho').toUpperCase()}`,
    pageWidth / 2, cursorY + 15, { align: 'center' },
  );
  cursorY += 20;

  const totals = additiveTotals(add);
  doc.setFontSize(8);
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const summary = `Composições: ${totals.compCount} (acrescidas: ${totals.acrescidos} | suprimidas: ${totals.suprimidos})   |   Insumos: ${totals.inputCount}   |   Impacto s/BDI: ${fmtBRL(totals.impactoSemBDI)}   |   Impacto c/BDI: ${fmtBRL(totals.impactoComBDI)}`;
  doc.text(summary, margin, cursorY);
  cursorY += 4;

  const head = [[
    'Item', 'Código', 'Banco', 'Discriminação', 'Und',
    'Q.Contrat.', 'Suprim.', 'Aditiv.', 'Total após',
    'V.Unit s/BDI', 'V.Unit c/BDI', 'Impacto c/BDI',
  ]];

  for (const c of add.compositions) {
    const r = computeCompositionWithBDI(c, bdi);
    const body: any[] = [[
      c.item, c.code, c.bank, c.description, c.unit,
      (c.originalQuantity ?? 0).toLocaleString('pt-BR'),
      (c.suppressedQuantity ?? 0).toLocaleString('pt-BR'),
      (c.addedQuantity ?? c.quantity).toLocaleString('pt-BR'),
      totalAfterAdditive(c).toLocaleString('pt-BR'),
      fmtBRL(c.unitPriceNoBDI), fmtBRL(r.unitPriceWithBDI), fmtBRL(r.impactoComBDI),
    ]];

    autoTable(doc, {
      startY: cursorY, head, body,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.2, cellPadding: 1.3, overflow: 'linebreak' },
      headStyles: { fillColor: [40, 60, 90], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 12 }, 1: { cellWidth: 16 }, 2: { cellWidth: 12 },
        3: { cellWidth: 'auto' }, 4: { cellWidth: 10 },
        5: { cellWidth: 16, halign: 'right' }, 6: { cellWidth: 14, halign: 'right' },
        7: { cellWidth: 14, halign: 'right' }, 8: { cellWidth: 16, halign: 'right' },
        9: { cellWidth: 20, halign: 'right' }, 10: { cellWidth: 20, halign: 'right' },
        11: { cellWidth: 22, halign: 'right' },
      },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 1;

    if (showAnalytic && c.inputs.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [['', 'Cód.', 'Banco', 'Descrição insumo', 'Un', 'Coef.', 'V.Unit s/BDI', 'Total s/BDI']],
        body: c.inputs.map(i => [
          '', i.code, i.bank, i.description, i.unit,
          i.coefficient.toLocaleString('pt-BR'), fmtBRL(i.unitPrice), fmtBRL(i.total),
        ]),
        margin: { left: margin + 6, right: margin },
        styles: { fontSize: 6.8, cellPadding: 1.1, overflow: 'linebreak', textColor: 60 },
        headStyles: { fillColor: [220, 225, 235], textColor: 30 },
        columnStyles: {
          0: { cellWidth: 4 }, 3: { cellWidth: 'auto' },
          5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
        },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 3;
    } else {
      cursorY += 2;
    }

    if (cursorY > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      cursorY = margin;
    }
  }

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(120);
    const footer = `${branding.company.name} · ${branding.company.cnpj} · ${branding.company.city}`;
    doc.text(footer, pageWidth / 2, doc.internal.pageSize.getHeight() - 5, { align: 'center' });
    doc.text(`Pág. ${p}/${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 5, { align: 'right' });
  }

  doc.save(`${add.name.replace(/[^\w\d-]+/g, '_')}.pdf`);
}
