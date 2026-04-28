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
  // Normaliza pt-BR: "1.234,56" -> "1234.56"
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

  if (MAO_OBRA_UNITS.includes(u) || MAO_OBRA_KEYWORDS.some(k => d.includes(k))) {
    return 'mao_obra';
  }
  if (EQUIPAMENTO_KEYWORDS.some(k => d.includes(k))) {
    return 'equipamento';
  }
  if (MATERIAL_UNITS.includes(u)) {
    return 'material';
  }
  return 'outro';
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

interface AnalyticParentData {
  inputs: AnalyticRow[];
  /** Valor unitário c/ BDI capturado da linha "Valor com BDI =" (por unidade). */
  unitPriceWithBDI?: number;
}

/**
 * Normaliza código para casamento Sintética x Analítica.
 * Remove espaços, deixa MAIÚSCULO e remove zeros à esquerda da parte numérica
 * imediatamente após letras (ADM04 -> ADM4, C0002 -> C2, MED02 -> MED2).
 * Quando o código é puramente numérico, mantém zeros à esquerda intactos.
 */
function normalizeCode(raw: string): string {
  if (!raw) return '';
  let s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  // Remove caracteres invisíveis comuns
  s = s.replace(/[\u00A0\u200B-\u200D\uFEFF]/g, '');
  // Padrão: <letras><dígitos>[resto]
  const m = s.match(/^([A-Z]+)(0+)(\d+)(.*)$/);
  if (m) return `${m[1]}${m[3]}${m[4]}`;
  return s;
}

/** Encontra a aba pelo nome (case/acento insensível). */
function findSheetName(names: string[], target: string): string | undefined {
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const t = norm(target);
  return names.find(n => norm(n) === t) || names.find(n => norm(n).includes(t));
}

/** Lê uma planilha como matriz, ignorando linhas totalmente vazias no topo. */
function sheetToRows(ws: any, XLSX: any): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][];
}

/** Detecta a linha do cabeçalho procurando termos típicos. */
function detectHeaderIndex(rows: unknown[][]): number {
  const HEADER_HINTS = ['item', 'codigo', 'código', 'descricao', 'descrição', 'banco', 'unidade'];
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const joined = rows[i].map(c => asString(c).toLowerCase()).join(' | ');
    let hits = 0;
    for (const h of HEADER_HINTS) if (joined.includes(h)) hits++;
    if (hits >= 2) return i;
  }
  return 0;
}

/**
 * Detecta o índice da coluna "Descrição" no cabeçalho da Sintética.
 * Layouts comuns: D (índice 3) ou E (índice 4) — o último ocorre quando há
 * uma coluna mesclada/vazia entre Banco e Descrição.
 */
function detectDescriptionColIndex(rows: unknown[][], headerIdx: number): number {
  const hdr = rows[headerIdx] || [];
  for (let c = 0; c < hdr.length; c++) {
    const v = asString(hdr[c]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (v === 'descricao' || v.startsWith('descric')) return c;
  }
  return 4; // fallback: coluna E
}

function parseSyntheticSheet(rows: unknown[][]): { items: SyntheticRow[]; issues: AdditiveImportIssue[] } {
  const issues: AdditiveImportIssue[] = [];
  const headerIdx = detectHeaderIndex(rows);
  const descCol = detectDescriptionColIndex(rows, headerIdx);
  const items: SyntheticRow[] = [];
  const seenCodes = new Set<string>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const item = asString(r[0]);            // A
    const code = asString(r[1]);            // B
    const bank = asString(r[2]);            // C

    // Quando a descrição vier em E (descCol=4), a coluna D pode estar vazia
    // por causa de mesclagem. Lemos sempre a partir de descCol para frente.
    let description = asString(r[descCol]);
    // Se a célula esperada estiver vazia mas D tem texto e E não, usamos D.
    if (!description && descCol === 4) description = asString(r[3]);

    // Após a Descrição: Quantidade, Unidade, V.Unit s/BDI, [subtotal s/BDI], V.Unit c/BDI, Total c/BDI
    const qCol = descCol + 1;
    const uCol = descCol + 2;
    const vNoBdiCol = descCol + 3;
    // Layout real: descCol=4 -> qty=5(F), un=6(G), vNoBDI=7(H), subtotalNoBDI=8(I), vComBDI=9(J), total=10(K)
    // Layout simples: descCol=3 -> qty=4(E), un=5(F), vNoBDI=6(G), vComBDI=7(H), total=8(I)
    const hasSubtotalCol = descCol === 4; // heurística: quando há coluna mesclada D, há subtotal em I
    const vWithBdiCol = vNoBdiCol + (hasSubtotalCol ? 2 : 1);
    const totalCol = vWithBdiCol + 1;

    const quantity = toNumber(r[qCol]);
    const unit = asString(r[uCol]);
    const unitPriceNoBDI = toNumber(r[vNoBdiCol]);
    const unitPriceWithBDI = toNumber(r[vWithBdiCol]);
    const total = toNumber(r[totalCol]);

    // pular linhas totalmente vazias
    if (!item && !code && !description && !quantity && !total) continue;
    // pular linhas que parecem cabeçalho/total/capítulo (sem código + sem qty)
    const lowDesc = description.toLowerCase();
    if (!code && (lowDesc.includes('total') || lowDesc.includes('subtotal'))) continue;
    if (!code) {
      // possível capítulo (só descrição). Não é composição — ignora silenciosamente.
      continue;
    }
    // Linha de capítulo numerada (sem qty e sem total) — ignora.
    if (quantity <= 0 && total <= 0 && unitPriceNoBDI <= 0 && unitPriceWithBDI <= 0) {
      continue;
    }

    if (seenCodes.has(code)) {
      issues.push({ level: 'error', message: `Código duplicado na Sintética: ${code}`, code, line: i + 1 });
    }
    seenCodes.add(code);

    if (quantity <= 0) {
      issues.push({ level: 'warning', message: `Quantidade inválida ou zero (${code})`, code, line: i + 1 });
    }
    if (unitPriceNoBDI <= 0 && unitPriceWithBDI <= 0) {
      issues.push({ level: 'warning', message: `Valor unitário inválido ou zero (${code})`, code, line: i + 1 });
    }
    if (total <= 0) {
      issues.push({ level: 'warning', message: `Total inválido ou zero (${code})`, code, line: i + 1 });
    }

    items.push({
      item, code, bank, description, quantity, unit,
      unitPriceNoBDI, unitPriceWithBDI, total,
      rowIndex: i + 1,
    });
  }

  return { items, issues };
}

/** Procura, em qualquer coluna da linha, texto contendo "valor com bdi". */
function findValorComBdiInRow(r: unknown[]): { colIdx: number } | null {
  for (let c = 0; c < r.length; c++) {
    const v = asString(r[c]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (v.includes('valor com bdi')) return { colIdx: c };
  }
  return null;
}

/** Pega o primeiro número à direita de uma coluna na linha. */
function firstNumberAfter(r: unknown[], startCol: number): number {
  for (let c = startCol + 1; c < r.length; c++) {
    const n = toNumber(r[c]);
    if (n > 0) return n;
  }
  return 0;
}

function parseAnalyticSheet(
  rows: unknown[][],
  /** Map<codigoNormalizado, codigoOriginalDaSintetica> */
  parentByNorm: Map<string, string>,
): { byParent: Map<string, AnalyticParentData>; issues: AdditiveImportIssue[] } {
  const issues: AdditiveImportIssue[] = [];
  const headerIdx = detectHeaderIndex(rows);
  const byParent = new Map<string, AnalyticParentData>();
  let currentParent: string | null = null; // código original da Sintética

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];

    // 1) Linha "Valor com BDI =" — captura o valor para o pai atual.
    const vcb = findValorComBdiInRow(r);
    if (vcb && currentParent) {
      const val = firstNumberAfter(r, vcb.colIdx);
      if (val > 0) {
        const data = byParent.get(currentParent);
        if (data) data.unitPriceWithBDI = val;
      }
      continue;
    }

    const codeRaw = asString(r[1]);
    const bank = asString(r[2]);
    const description = asString(r[3]);
    const unit = asString(r[4]);
    const coefficient = toNumber(r[5]);
    const unitPrice = toNumber(r[6]);
    const total = toNumber(r[7]);

    if (!codeRaw && !description) continue;
    const lowDesc = description.toLowerCase();
    if (!codeRaw && (lowDesc.includes('total') || lowDesc.includes('subtotal'))) continue;

    // Este código bate (após normalização) com uma composição da Sintética → vira pai.
    if (codeRaw) {
      const norm = normalizeCode(codeRaw);
      const originalParent = parentByNorm.get(norm);
      if (originalParent) {
        currentParent = originalParent;
        if (!byParent.has(currentParent)) byParent.set(currentParent, { inputs: [] });
        continue;
      }
    }

    if (!currentParent) continue; // insumo antes de qualquer pai → ignora

    if (!codeRaw) {
      issues.push({ level: 'warning', message: `Insumo sem código (composição ${currentParent})`, line: i + 1 });
    }
    if (!unit) {
      issues.push({ level: 'warning', message: `Insumo sem unidade (${codeRaw || 'sem código'})`, line: i + 1 });
    }
    if (unitPrice <= 0) {
      issues.push({ level: 'warning', message: `Insumo sem preço (${codeRaw || 'sem código'})`, line: i + 1 });
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
    return {
      id: uid(), name: additiveName, importedAt: new Date().toISOString(),
      compositions: [], issues: allIssues,
    };
  }

  const synthRows = sheetToRows(wb.Sheets[synthName], XLSX);
  const { items: synthItems, issues: synthIssues } = parseSyntheticSheet(synthRows);
  allIssues.push(...synthIssues);

  const parentCodes = new Set(synthItems.map(s => s.code));
  let byParent = new Map<string, AnalyticRow[]>();

  if (!analyName) {
    allIssues.push({ level: 'warning', message: 'Aba Analítica não encontrada — composições ficarão sem insumos.' });
  } else {
    const analyRows = sheetToRows(wb.Sheets[analyName], XLSX);
    const result = parseAnalyticSheet(analyRows, parentCodes);
    byParent = result.byParent;
    allIssues.push(...result.issues);
  }

  const compositions: AdditiveComposition[] = synthItems.map(s => {
    const rawInputs = byParent.get(s.code) || [];
    const inputs: AdditiveInput[] = rawInputs.map(r => ({
      id: uid(),
      code: r.code,
      bank: r.bank,
      description: r.description,
      type: classifyInput(r.description, r.unit),
      unit: r.unit,
      coefficient: r.coefficient,
      unitPrice: r.unitPrice,
      total: r.total || +(r.coefficient * r.unitPrice * (s.quantity || 1)).toFixed(2),
    }));

    if (inputs.length === 0) {
      allIssues.push({ level: 'warning', message: `Composição sintética sem analítico vinculado (${s.code})`, code: s.code });
    } else {
      const sumAnalytic = inputs.reduce((acc, i) => acc + (i.total || 0), 0);
      if (s.total > 0 && Math.abs(sumAnalytic - s.total) > 0.05) {
        allIssues.push({
          level: 'warning',
          message: `Diferença entre total sintético (R$ ${s.total.toFixed(2)}) e soma analítica (R$ ${sumAnalytic.toFixed(2)}) — ${s.code}`,
          code: s.code,
        });
      }
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
      unitPriceWithBDI: s.unitPriceWithBDI,
      total: s.total,
      inputs,
    };
  });

  // Resumo informativo
  const totalInputs = compositions.reduce((a, c) => a + c.inputs.length, 0);
  const matCount = compositions.reduce((a, c) => a + c.inputs.filter(i => i.type === 'material').length, 0);
  const moCount = compositions.reduce((a, c) => a + c.inputs.filter(i => i.type === 'mao_obra').length, 0);
  const eqCount = compositions.reduce((a, c) => a + c.inputs.filter(i => i.type === 'equipamento').length, 0);
  const otherCount = compositions.reduce((a, c) => a + c.inputs.filter(i => i.type === 'outro').length, 0);
  allIssues.unshift(
    { level: 'info', message: `Total de composições importadas: ${compositions.length}` },
    { level: 'info', message: `Total de insumos importados: ${totalInputs}` },
    { level: 'info', message: `Materiais: ${matCount}` },
    { level: 'info', message: `Mão de obra: ${moCount}` },
    { level: 'info', message: `Equipamentos: ${eqCount}` },
    { level: 'info', message: `Outros: ${otherCount}` },
  );

  return {
    id: uid(),
    name: additiveName,
    importedAt: new Date().toISOString(),
    compositions,
    issues: allIssues,
  };
}

export function sumAnalyticTotal(comp: AdditiveComposition): number {
  return comp.inputs.reduce((a, i) => a + (i.total || 0), 0);
}

export function additiveTotals(add: Additive) {
  const compCount = add.compositions.length;
  const totalSemBDI = add.compositions.reduce((a, c) => a + (c.unitPriceNoBDI * c.quantity), 0);
  const totalComBDI = add.compositions.reduce((a, c) => a + (c.unitPriceWithBDI * c.quantity), 0);
  const total = add.compositions.reduce((a, c) => a + c.total, 0);
  const inputCount = add.compositions.reduce((a, c) => a + c.inputs.length, 0);
  const semAnalitico = add.compositions.filter(c => c.inputs.length === 0).length;
  return { compCount, totalSemBDI, totalComBDI, total, inputCount, semAnalitico };
}

export async function exportAdditiveToExcel(add: Additive) {
  const XLSX = await import('xlsx');
  const synthHeader = ['Item', 'Código', 'Banco', 'Descrição', 'Quantidade', 'Unidade', 'Valor unit. s/ BDI', 'Valor unit. c/ BDI', 'Total', 'Total analítico', 'Diferença'];
  const synthRows = add.compositions.map(c => {
    const sumA = sumAnalyticTotal(c);
    return [c.item, c.code, c.bank, c.description, c.quantity, c.unit, c.unitPriceNoBDI, c.unitPriceWithBDI, c.total, sumA, +(sumA - c.total).toFixed(2)];
  });
  const wsSynth = XLSX.utils.aoa_to_sheet([synthHeader, ...synthRows]);

  const typeLabel: Record<AdditiveInputType, string> = {
    material: 'Material', mao_obra: 'Mão de obra', equipamento: 'Equipamento', outro: 'Outro',
  };

  const analyHeader = ['Item composição', 'Código composição', 'Descrição composição', 'Código insumo', 'Banco', 'Tipo', 'Descrição insumo', 'Unidade', 'Coeficiente', 'Valor unit.', 'Total'];
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
  doc.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, pageWidth / 2, cursorY + 15, { align: 'center' });
  cursorY += 20;

  const totals = additiveTotals(add);
  doc.setFontSize(8);
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const summary = `Composições: ${totals.compCount}   |   Insumos: ${totals.inputCount}   |   Total s/ BDI: ${fmtBRL(totals.totalSemBDI)}   |   Total c/ BDI: ${fmtBRL(totals.totalComBDI)}   |   Total Geral: ${fmtBRL(totals.total)}`;
  doc.text(summary, margin, cursorY);
  cursorY += 4;

  const head = [['Item', 'Código', 'Banco', 'Descrição', 'Qtd', 'Un', 'V. Unit s/BDI', 'V. Unit c/BDI', 'Total']];
  const typeLabel: Record<AdditiveInputType, string> = {
    material: 'Material', mao_obra: 'Mão de obra', equipamento: 'Equipamento', outro: 'Outro',
  };

  for (const c of add.compositions) {
    const body: any[] = [[
      c.item, c.code, c.bank, c.description,
      c.quantity.toLocaleString('pt-BR'), c.unit,
      fmtBRL(c.unitPriceNoBDI), fmtBRL(c.unitPriceWithBDI), fmtBRL(c.total),
    ]];

    autoTable(doc, {
      startY: cursorY,
      head,
      body,
      margin: { left: margin, right: margin },
      styles: { fontSize: 7.5, cellPadding: 1.4, overflow: 'linebreak' },
      headStyles: { fillColor: [40, 60, 90], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 14 },
        1: { cellWidth: 18 },
        2: { cellWidth: 14 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 14, halign: 'right' },
        5: { cellWidth: 12 },
        6: { cellWidth: 22, halign: 'right' },
        7: { cellWidth: 22, halign: 'right' },
        8: { cellWidth: 24, halign: 'right' },
      },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 1;

    if (showAnalytic && c.inputs.length > 0) {
      autoTable(doc, {
        startY: cursorY,
        head: [['', 'Cód.', 'Banco', 'Tipo', 'Descrição insumo', 'Un', 'Coef.', 'V. Unit', 'Total']],
        body: c.inputs.map(i => [
          '', i.code, i.bank, typeLabel[i.type], i.description, i.unit,
          i.coefficient.toLocaleString('pt-BR'), fmtBRL(i.unitPrice), fmtBRL(i.total),
        ]),
        margin: { left: margin + 6, right: margin },
        styles: { fontSize: 6.8, cellPadding: 1.1, overflow: 'linebreak', textColor: 60 },
        headStyles: { fillColor: [220, 225, 235], textColor: 30 },
        columnStyles: {
          0: { cellWidth: 4 },
          4: { cellWidth: 'auto' },
          6: { halign: 'right' },
          7: { halign: 'right' },
          8: { halign: 'right' },
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

  // Rodapé
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
