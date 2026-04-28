import type {
  Additive,
  AdditiveComposition,
  AdditiveInput,
  AdditiveInputType,
  AdditiveImportIssue,
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

const MAO_OBRA_KEYWORDS = [
  'eletricista', 'servente', 'pedreiro', 'ajudante', 'encanador',
  'pintor', 'carpinteiro', 'armador', 'operador', 'engenheiro',
  'tecnico', 'técnico', 'mestre de obras', 'encarregado', 'soldador',
  'encargos complementares',
];
const MAO_OBRA_UNITS = ['h', 'hr', 'hora', 'horas', 'horista'];
const EQUIPAMENTO_KEYWORDS = [
  'equipamento', 'maquina', 'máquina', 'betoneira', 'caminhao', 'caminhão',
  'guindaste', 'andaime', 'compactador', 'compressor', 'retroescavadeira',
  'escavadeira', 'guincho', 'vibrador', 'gerador',
];
const MATERIAL_UNITS = ['un', 'und', 'unid', 'pc', 'pç', 'peca', 'peça', 'cj', 'kg', 'g', 'l', 'ml', 'm', 'm2', 'm²', 'm3', 'm³', 'mt', 'cm'];

function classifyInput(description: string, unit: string): AdditiveInputType {
  const d = description.toLowerCase();
  const u = unit.toLowerCase().trim();
  if (MAO_OBRA_UNITS.includes(u) || MAO_OBRA_KEYWORDS.some(k => d.includes(k))) return 'mao_obra';
  if (EQUIPAMENTO_KEYWORDS.some(k => d.includes(k))) return 'equipamento';
  if (MATERIAL_UNITS.includes(u)) return 'material';
  return 'outro';
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
  // Tenta J8 (rows[7][9]). Se não houver número, tenta varrer primeiras 12 linhas
  // procurando texto "bdi" e pegando o percentual ao lado.
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
  /** Código normalizado do bloco analítico. */
  normCode: string;
  /** Código original. */
  code: string;
  inputs: AnalyticRow[];
  /** Total H da linha pai analítica, quando existir. */
  parentTotalNoBDI?: number;
  /** Linha da planilha onde o bloco começa. */
  startRow: number;
}

/**
 * Parser SINTÉTICA — layout fixo A..J:
 * A=Item, B=Código, C=Banco, D=Descrição, E=Quantidade, F=Unidade,
 * G=Vunit s/BDI, H=Total s/BDI, I=Vunit c/BDI, J=Total c/BDI
 */
function parseSyntheticSheet(rows: unknown[][]): { items: SyntheticRow[]; issues: AdditiveImportIssue[]; bdi?: number } {
  const issues: AdditiveImportIssue[] = [];
  const headerIdx = detectHeaderIndex(rows);
  const items: SyntheticRow[] = [];
  const seenCodes = new Set<string>();
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
    const totalWithBDI = toNumber(r[9]);

    // pula linhas totalmente vazias
    if (!item && !code && !bank && !description && !quantity && !total && !unitPriceNoBDI) continue;
    // pular textos de total/subtotal sem código
    const lowDesc = norm(description);
    if (!code && (lowDesc.includes('total') || lowDesc.includes('subtotal'))) continue;
    // capítulos/subcapítulos: têm item, mas NÃO têm banco. Ignora.
    if (!bank) continue;
    // sem código de fato → ignora
    if (!code) continue;

    if (seenCodes.has(code)) {
      issues.push({ level: 'error', message: `Código duplicado na Sintética: ${code}`, code, line: i + 1 });
    }
    seenCodes.add(code);

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
    void totalWithBDI;
  }

  return { items, issues, bdi };
}

/**
 * Parser ANALÍTICA — layout fixo A..H:
 * A=Item ou tipo (Auxiliar/Insumo), B=Código, C=Banco, D=Descrição,
 * E=Coeficiente/Quantidade, F=Unidade, G=Vunit s/BDI, H=Total s/BDI
 *
 * Linhas pai: A é numérico (item) e B/C/D preenchidos.
 * Linhas insumo: A = "Auxiliar" ou "Insumo".
 * Ignora a linha "Valor com BDI =" (não tratar como insumo).
 */
function parseAnalyticSheet(
  rows: unknown[][],
  parentByNorm: Map<string, string>,
): { byParent: Map<string, AnalyticParentData>; issues: AdditiveImportIssue[] } {
  const issues: AdditiveImportIssue[] = [];
  const headerIdx = detectHeaderIndex(rows);
  const byParent = new Map<string, AnalyticParentData>();
  let currentParent: string | null = null;

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
    if (dLow.includes('valor com bdi') || aLow.includes('valor com bdi')
        || (asString(r[6]) && norm(asString(r[6])).includes('valor com bdi'))) {
      continue;
    }

    // Detecta linha pai: A é número (item tipo "1", "2.1.4") e B/C preenchidos.
    const isParentLine =
      !!codeRaw && !!bank && /^\d+(\.\d+)*$/.test(aRaw.replace(',', '.'));

    if (isParentLine) {
      const norm1 = normalizeCode(codeRaw);
      const originalParent = parentByNorm.get(norm1);
      if (originalParent) {
        currentParent = originalParent;
        if (!byParent.has(currentParent)) byParent.set(currentParent, { inputs: [] });
        const data = byParent.get(currentParent)!;
        if (total > 0) data.parentTotalNoBDI = total;
        continue;
      } else {
        // Pai analítico sem correspondência na Sintética
        currentParent = null;
        continue;
      }
    }

    // Insumo: A deve ser "Auxiliar" ou "Insumo" (ou compat: vazio com código)
    const isInsumo = aLow === 'auxiliar' || aLow === 'insumo' || aLow.startsWith('insumo') || aLow.startsWith('auxiliar');

    if (!isInsumo) continue;
    if (!currentParent) continue;
    if (!codeRaw && !description) continue;

    if (unitPrice <= 0) {
      issues.push({ level: 'warning', message: `Insumo sem preço (${codeRaw || description})`, line: i + 1 });
    }

    const data = byParent.get(currentParent)!;
    data.inputs.push({
      code: codeRaw, bank, description, unit, coefficient, unitPrice, total,
      rowIndex: i + 1,
    });
  }

  return { byParent, issues };
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
    return { id: uid(), name: additiveName, importedAt: new Date().toISOString(), compositions: [], issues: allIssues };
  }

  const synthRows = sheetToRows(wb.Sheets[synthName], XLSX);
  const { items: synthItems, issues: synthIssues, bdi } = parseSyntheticSheet(synthRows);
  allIssues.push(...synthIssues);

  const parentByNorm = new Map<string, string>();
  for (const s of synthItems) parentByNorm.set(normalizeCode(s.code), s.code);

  let byParent = new Map<string, AnalyticParentData>();
  if (!analyName) {
    allIssues.push({ level: 'warning', message: 'Aba Analítica não encontrada — composições ficarão sem insumos.' });
  } else {
    const analyRows = sheetToRows(wb.Sheets[analyName], XLSX);
    const result = parseAnalyticSheet(analyRows, parentByNorm);
    byParent = result.byParent;
    allIssues.push(...result.issues);
  }

  const bdiPercent = bdi ?? 0;
  const fator = 1 + bdiPercent / 100;

  const compositions: AdditiveComposition[] = synthItems.map(s => {
    const data = byParent.get(s.code);
    const rawInputs = data?.inputs ?? [];
    const inputs: AdditiveInput[] = rawInputs.map(r => ({
      id: uid(),
      code: r.code,
      bank: r.bank,
      description: r.description,
      type: classifyInput(r.description, r.unit),
      unit: r.unit,
      coefficient: r.coefficient,
      unitPrice: r.unitPrice,
      total: r.total || +(r.coefficient * r.unitPrice).toFixed(2),
    }));

    // Valor unitário c/ BDI calculado a partir do BDI lido da planilha.
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
    };
  });

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
  };
}

/** Soma dos totais H dos insumos da Analítica (sem BDI), por unidade da composição. */
export function sumAnalyticTotalNoBDI(comp: AdditiveComposition): number {
  return comp.inputs.reduce((a, i) => a + (i.total || 0), 0);
}

/**
 * Recalcula valores da composição com base no BDI atual (editável).
 * Retorna os valores derivados para exibição (não muta o objeto).
 */
export function computeCompositionWithBDI(comp: AdditiveComposition, bdiPercent: number) {
  const fator = 1 + (bdiPercent || 0) / 100;
  const unitPriceWithBDI = truncar2(comp.unitPriceNoBDI * fator);
  const totalSyntheticWithBDI = truncar2(unitPriceWithBDI * comp.quantity);
  const sumAnalyticNoBDI = sumAnalyticTotalNoBDI(comp);
  const totalAnalyticWithBDI = truncar2(sumAnalyticNoBDI * fator * comp.quantity);
  const diff = +(totalAnalyticWithBDI - totalSyntheticWithBDI).toFixed(2);
  return { unitPriceWithBDI, totalSyntheticWithBDI, sumAnalyticNoBDI, totalAnalyticWithBDI, diff };
}

export function additiveTotals(add: Additive) {
  const bdi = add.bdiPercent ?? 0;
  const compCount = add.compositions.length;
  const totalSemBDI = add.compositions.reduce((a, c) => a + (c.unitPriceNoBDI * c.quantity), 0);
  const totalComBDI = add.compositions.reduce((a, c) => {
    const { totalSyntheticWithBDI } = computeCompositionWithBDI(c, bdi);
    return a + totalSyntheticWithBDI;
  }, 0);
  const total = totalComBDI;
  const inputCount = add.compositions.reduce((a, c) => a + c.inputs.length, 0);
  const semAnalitico = add.compositions.filter(c => c.inputs.length === 0).length;
  return { compCount, totalSemBDI, totalComBDI, total, inputCount, semAnalitico };
}

export async function exportAdditiveToExcel(add: Additive) {
  const XLSX = await import('xlsx');
  const bdi = add.bdiPercent ?? 0;
  const synthHeader = ['Item', 'Código', 'Banco', 'Descrição', 'Quantidade', 'Unidade', 'V.Unit s/BDI', 'Total s/BDI', 'V.Unit c/BDI', 'Total c/BDI', 'Soma Analítica s/BDI', 'Total Analítico c/BDI', 'Diferença'];
  const synthRows = add.compositions.map(c => {
    const r = computeCompositionWithBDI(c, bdi);
    return [c.item, c.code, c.bank, c.description, c.quantity, c.unit,
      c.unitPriceNoBDI, +(c.unitPriceNoBDI * c.quantity).toFixed(2),
      r.unitPriceWithBDI, r.totalSyntheticWithBDI,
      r.sumAnalyticNoBDI, r.totalAnalyticWithBDI, r.diff];
  });
  const wsSynth = XLSX.utils.aoa_to_sheet([[`BDI: ${bdi.toFixed(2)}%`], [], synthHeader, ...synthRows]);

  const typeLabel: Record<AdditiveInputType, string> = {
    material: 'Material', mao_obra: 'Mão de obra', equipamento: 'Equipamento', outro: 'Outro',
  };
  const analyHeader = ['Item composição', 'Código composição', 'Descrição composição', 'Código insumo', 'Banco', 'Tipo', 'Descrição insumo', 'Unidade', 'Coeficiente', 'V.Unit s/BDI', 'Total s/BDI'];
  const analyRows: (string | number)[][] = [];
  for (const c of add.compositions) {
    for (const i of c.inputs) {
      analyRows.push([c.item, c.code, c.description, i.code, i.bank, typeLabel[i.type], i.description, i.unit, i.coefficient, i.unitPrice, i.total]);
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
  doc.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}   |   BDI: ${bdi.toFixed(2)}%`, pageWidth / 2, cursorY + 15, { align: 'center' });
  cursorY += 20;

  const totals = additiveTotals(add);
  doc.setFontSize(8);
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const summary = `Composições: ${totals.compCount}   |   Insumos: ${totals.inputCount}   |   Total s/ BDI: ${fmtBRL(totals.totalSemBDI)}   |   Total c/ BDI: ${fmtBRL(totals.totalComBDI)}`;
  doc.text(summary, margin, cursorY);
  cursorY += 4;

  const head = [['Item', 'Código', 'Banco', 'Descrição', 'Qtd', 'Un', 'V.Unit s/BDI', 'V.Unit c/BDI', 'Total c/BDI']];
  const typeLabel: Record<AdditiveInputType, string> = {
    material: 'Material', mao_obra: 'Mão de obra', equipamento: 'Equipamento', outro: 'Outro',
  };

  for (const c of add.compositions) {
    const r = computeCompositionWithBDI(c, bdi);
    const body: any[] = [[
      c.item, c.code, c.bank, c.description,
      c.quantity.toLocaleString('pt-BR'), c.unit,
      fmtBRL(c.unitPriceNoBDI), fmtBRL(r.unitPriceWithBDI), fmtBRL(r.totalSyntheticWithBDI),
    ]];

    autoTable(doc, {
      startY: cursorY, head, body,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 1.4, overflow: 'linebreak' },
      headStyles: { fillColor: [40, 60, 90], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 14 }, 1: { cellWidth: 18 }, 2: { cellWidth: 14 },
        3: { cellWidth: 'auto' }, 4: { cellWidth: 14, halign: 'right' },
        5: { cellWidth: 12 }, 6: { cellWidth: 22, halign: 'right' },
        7: { cellWidth: 22, halign: 'right' }, 8: { cellWidth: 24, halign: 'right' },
      },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 1;

    if (showAnalytic && c.inputs.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [['', 'Cód.', 'Banco', 'Tipo', 'Descrição insumo', 'Un', 'Coef.', 'V.Unit s/BDI', 'Total s/BDI']],
        body: c.inputs.map(i => [
          '', i.code, i.bank, typeLabel[i.type], i.description, i.unit,
          i.coefficient.toLocaleString('pt-BR'), fmtBRL(i.unitPrice), fmtBRL(i.total),
        ]),
        margin: { left: margin + 6, right: margin },
        styles: { fontSize: 6.8, cellPadding: 1.1, overflow: 'linebreak', textColor: 60 },
        headStyles: { fillColor: [220, 225, 235], textColor: 30 },
        columnStyles: {
          0: { cellWidth: 4 }, 4: { cellWidth: 'auto' },
          6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
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
