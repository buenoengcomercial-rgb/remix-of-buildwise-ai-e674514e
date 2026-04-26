import { Task, LaborComposition } from '@/types/project';
import * as XLSX from 'xlsx';

export interface ParsedLabor {
  role: string;
  unit: string;
  rup: number;
  hours: number;
  days: number;
  workerCount: number;
}

export interface ParsedComposition {
  code: string;
  bank?: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceNoBDI?: number;
  labor: ParsedLabor[];
  needsReview: boolean;
  reviewReason?: string;
}

export interface ParsedChapter {
  code: string;
  name: string;
  children: ParsedChapter[];
  compositions: ParsedComposition[];
}

export interface ParseResult {
  chapters: ParsedChapter[];
  flatCompositions: ParsedComposition[];
  warnings: string[];
}

// ─── Excel structured parsing (column-based rules) ────────────
export function parseStructuredExcel(data: ArrayBuffer): ParseResult {
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const warnings: string[] = [];
  const rootChapters: ParsedChapter[] = [];
  const flatCompositions: ParsedComposition[] = [];

  // Code → chapter for hierarchy lookup
  const codeToChapter = new Map<string, ParsedChapter>();
  let lastChapter: ParsedChapter | null = null;
  let lastComposition: ParsedComposition | null = null;

  // Detect header row + dynamic column indices
  const { startRow, cols } = detectHeaderAndColumns(rows);

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const code = cellStr(row[cols.code]);
    const bank = cellStr(row[cols.bank]);
    const type = cellStr(row[cols.type]);
    const description = cellStr(row[cols.description]);
    const unit = cellStr(row[cols.unit]);
    const quantity = cellNum(row[cols.quantity]);
    const productivity = cellNum(row[cols.productivity]);
    const unitPriceNoBDI = cellNum(row[cols.unitPriceNoBDI]);
    const hours = cellNum(row[cols.hours]);
    const days = cellNum(row[cols.days]);

    const hasD = description !== '' || unit !== '';
    const hasE = quantity > 0;
    const hasF = productivity > 0;
    const hasG = hours > 0;
    const hasH = days > 0;
    const hasPrice = unitPriceNoBDI > 0;

    // Skip completely empty rows
    const desc = description || type || code;
    if (!desc && !hasD && !hasE && !hasF && !hasG && !hasH && !hasPrice) continue;
    if (!code && !hasD && !hasE && !hasF && !hasG && !hasH && !hasPrice) continue;

    // Type detection (PRIORITY)
    const tipoNorm = normalizeText(type);
    const isTypeCap = tipoNorm === 'capitulo' || tipoNorm === 'cap';
    const isTypeSub = tipoNorm === 'subcapitulo' || tipoNorm === 'subcap';
    const isTypeComp = tipoNorm === 'composicao' || tipoNorm === 'comp' || tipoNorm === 'servico' || tipoNorm === 'atividade';
    const isTypeLabor = tipoNorm === 'mao de obra' || tipoNorm === 'mdo' || tipoNorm === 'recurso' || tipoNorm === 'insumo mao de obra';
    const hasTypeHint = isTypeCap || isTypeSub || isTypeComp || isTypeLabor;

    // Compatibility aliases for downstream blocks
    const colA = code;
    const colB = type;
    const colC = description;
    const colD = unit;
    const colE = quantity;
    const colF = productivity;
    const colG = hours;
    const colH = days;

    // ── Classification: Column Tipo PRIORITY, columns as fallback ──
    const classifiedAsChapter = hasTypeHint
      ? (isTypeCap || isTypeSub)
      : (!hasD && !hasE && !hasF && !hasG && !hasH && !hasPrice && !!desc);
    const classifiedAsComposition = hasTypeHint ? isTypeComp : (hasD && hasE && !hasF && !hasG && !hasH);
    const classifiedAsLabor = hasTypeHint ? isTypeLabor : (hasD && !hasE && (hasF || hasG || hasH));

    // ── CHAPTER / SUBCHAPTER ──
    if (classifiedAsChapter) {
      if (!colA) {
        warnings.push(`Linha ${i + 1}: capítulo sem código, ignorado`);
        continue;
      }

      const chapter: ParsedChapter = {
        code: colA,
        name: (colC || colB || colA).trim(),
        children: [],
        compositions: [],
      };

      const parentCode = getParentCode(colA);
      const parent = parentCode ? codeToChapter.get(parentCode) : null;

      if (parent) {
        parent.children.push(chapter);
      } else {
        rootChapters.push(chapter);
      }

      codeToChapter.set(colA, chapter);
      lastChapter = chapter;
      lastComposition = null;
      continue;
    }

    // ── COMPOSITION (SERVICE) ──
    if (classifiedAsComposition) {
      const comp: ParsedComposition = {
        code: colA,
        bank: bank || undefined,
        name: (colC || colB || '').trim(),
        unit: colD || 'un',
        quantity: colE || 1,
        unitPriceNoBDI: hasPrice ? unitPriceNoBDI : undefined,
        labor: [],
        needsReview: false,
      };

      const parentChapter = findParentChapter(colA, codeToChapter) || lastChapter;
      if (parentChapter) {
        parentChapter.compositions.push(comp);
      } else {
        warnings.push(`Linha ${i + 1}: composição "${comp.name}" sem capítulo associado`);
      }
      flatCompositions.push(comp);
      lastComposition = comp;
      continue;
    }

    // ── LABOR (ANALYTICAL COMPOSITION) ──
    if (classifiedAsLabor) {
      const labor: ParsedLabor = {
        role: (colC || colB || colD).trim(),
        unit: colD,
        rup: colF,
        hours: colG,
        days: colH,
        workerCount: 1,
      };

      // Always attach to the last composition seen (sequential order)
      if (lastComposition) {
        lastComposition.labor.push(labor);
      } else {
        warnings.push(`Linha ${i + 1}: mão de obra "${labor.role}" sem composição associada`);
      }
      continue;
    }

    // ── Fallback: composition with inline labor (D,E + F/G/H all present) ──
    if (desc && hasD && hasE && (hasF || hasG || hasH)) {
      const comp: ParsedComposition = {
        code: colA,
        name: (colC || colB || '').trim(),
        unit: colD,
        quantity: colE,
        labor: [{
          role: colB || 'Trabalhador',
          unit: colD,
          rup: colF,
          hours: colG,
          days: colH,
          workerCount: 1,
        }],
        needsReview: false,
      };

      const parentChapter = findParentChapter(colA, codeToChapter) || lastChapter;
      if (parentChapter) {
        parentChapter.compositions.push(comp);
      }
      flatCompositions.push(comp);
      lastComposition = comp;
      continue;
    }
  }

  // ── Validation ──
  flatCompositions.forEach((comp, idx) => {
    if (comp.labor.length === 0) {
      comp.needsReview = true;
      comp.reviewReason = 'Sem composição analítica (mão de obra)';
      warnings.push(`Composição "${comp.name}" (${comp.code}) sem mão de obra`);
    }
    comp.labor.forEach(l => {
      if (l.rup <= 0) {
        comp.needsReview = true;
        comp.reviewReason = (comp.reviewReason ? comp.reviewReason + '; ' : '') + `RUP ausente para ${l.role}`;
      }
    });
  });

  // If no chapters were detected, create a default one
  if (rootChapters.length === 0 && flatCompositions.length > 0) {
    rootChapters.push({
      code: '1',
      name: 'Importados',
      children: [],
      compositions: flatCompositions,
    });
  }

  return { chapters: rootChapters, flatCompositions, warnings };
}

// ─── Legacy flat parsing (CSV/simple Excel) ───────────────────
export interface ParsedTask {
  code: string;
  name: string;
  unit: string;
  quantity: number;
  group: string;
  labor: { role: string; rup: number; workerCount: number }[];
  needsReview: boolean;
  reviewReason?: string;
}

export function parseExcel(data: ArrayBuffer): ParsedTask[] {
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rows.length < 2) return [];

  const header = rows[0].map((h: any) => String(h ?? '').toLowerCase().trim());

  const colMap = {
    code: findCol(header, ['código', 'codigo', 'cod', 'code', 'id']),
    name: findCol(header, ['descrição', 'descricao', 'description', 'nome', 'name', 'serviço', 'servico', 'tarefa', 'resumo']),
    unit: findCol(header, ['unidade', 'unit', 'und', 'un']),
    quantity: findCol(header, ['quantidade', 'qty', 'qtd', 'quant']),
    role: findCol(header, ['profissional', 'mão de obra', 'mao de obra', 'trabalhador', 'role', 'tipo', 'função', 'funcao']),
    rup: findCol(header, ['rup', 'coeficiente', 'produtividade', 'h/un', 'h/m', 'h/m²', 'h/m2']),
    group: findCol(header, ['grupo', 'group', 'capítulo', 'capitulo', 'fase', 'phase', 'categoria']),
  };

  const taskMap = new Map<string, ParsedTask>();
  let currentGroup = 'Importados';

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const nonEmpty = row.filter((c: any) => c != null && String(c).trim() !== '').length;
    if (nonEmpty === 1 && colMap.name >= 0) {
      const potentialGroup = String(row[colMap.name] ?? row[0] ?? '').trim();
      if (potentialGroup.length > 2 && potentialGroup.length < 80) {
        currentGroup = potentialGroup;
        continue;
      }
    }

    const code = getStr(row, colMap.code) || `IMP-${i}`;
    const name = getStr(row, colMap.name);
    if (!name) continue;

    const unit = getStr(row, colMap.unit) || 'un';
    const qty = getNum(row, colMap.quantity) || 1;
    const role = getStr(row, colMap.role);
    const rup = getNum(row, colMap.rup);
    const group = getStr(row, colMap.group) || currentGroup;

    if (!taskMap.has(code)) {
      taskMap.set(code, { code, name, unit, quantity: qty, group, labor: [], needsReview: false });
    }

    const task = taskMap.get(code)!;
    if (role && rup > 0) {
      const existing = task.labor.find(l => l.role === role);
      if (existing) existing.rup = rup;
      else task.labor.push({ role, rup, workerCount: 1 });
    }

    if (task.labor.length === 0) {
      task.needsReview = true;
      task.reviewReason = 'Sem composição de mão de obra';
    }
  }

  return Array.from(taskMap.values());
}

// ─── PDF text parsing ──────────────────────────────────────────
export async function parsePDF(data: ArrayBuffer): Promise<ParsedTask[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(' ');
    fullText += text + '\n';
  }

  return parseSinapiText(fullText);
}

function parseSinapiText(text: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  let currentGroup = 'Importados';
  const lines = text.split(/\n/);

  const compositionPattern = /(\d{4,6})\s*[-–]\s*(.+?)(?:\s*[-–]\s*(.+?))?$/i;
  const laborPattern = /(?:^|\s)(servente|pedreiro|encanador|eletricista|ajudante|bombeiro\s*hidráulico|topógrafo|operador|mestre|carpinteiro|armador|pintor|soldador|serralheiro|vidraceiro|gesseiro|azulejista|ladrilheiro|impermeabilizador|calceteiro|marmorista|montador)[\s:→\-]+(\d+[.,]\d+)\s*(?:h\/?(?:un|m[²³]?|kg|l|vb)?)?/gi;
  const groupPattern = /^(?:cap[ií]tulo|grupo|fase|servi[çc]os?\s+(?:de\s+)?|instala[çc][ãa]o\s+(?:de\s+)?)\s*[:–-]?\s*(.+)/i;
  const uppercaseGroupPattern = /^([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ\s]{5,50})$/;

  let currentTask: ParsedTask | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const groupMatch = line.match(groupPattern);
    if (groupMatch) { currentGroup = cleanGroupName(groupMatch[1]); continue; }
    if (uppercaseGroupPattern.test(line) && !compositionPattern.test(line)) {
      const cleaned = cleanGroupName(line);
      if (cleaned.length >= 4 && cleaned.length <= 50) { currentGroup = cleaned; continue; }
    }

    const compMatch = line.match(compositionPattern);
    if (compMatch) {
      if (currentTask) tasks.push(currentTask);
      const fullName = (compMatch[2] + (compMatch[3] ? ' - ' + compMatch[3] : '')).trim();
      const unitMatch = fullName.match(/\b(m[²³]?|un|kg|l|vb|cj|gl)\b/i);
      currentTask = { code: compMatch[1], name: fullName, unit: unitMatch ? unitMatch[1] : 'un', quantity: 1, group: currentGroup, labor: [], needsReview: false };
      continue;
    }

    let laborMatch;
    laborPattern.lastIndex = 0;
    while ((laborMatch = laborPattern.exec(line)) !== null) {
      const role = capitalizeFirst(laborMatch[1].trim());
      const rup = parseFloat(laborMatch[2].replace(',', '.'));
      if (currentTask && rup > 0) {
        if (!currentTask.labor.find(l => l.role.toLowerCase() === role.toLowerCase())) {
          currentTask.labor.push({ role, rup, workerCount: 1 });
        }
      }
    }

    if (currentTask) {
      const qtyMatch = line.match(/(?:quantidade|qtd\.?|quant\.?)\s*[:=]?\s*(\d+[.,]?\d*)/i);
      if (qtyMatch) currentTask.quantity = parseFloat(qtyMatch[1].replace(',', '.'));
    }
  }

  if (currentTask) tasks.push(currentTask);
  tasks.forEach(t => {
    if (t.labor.length === 0) { t.needsReview = true; t.reviewReason = 'Sem mão de obra identificada'; }
    if (t.quantity <= 0) { t.needsReview = true; t.reviewReason = (t.reviewReason ? t.reviewReason + '; ' : '') + 'Quantidade não identificada'; }
  });

  return tasks;
}

// ─── Convert structured result to project phases ──────────────
export function convertStructuredToProject(result: ParseResult, startDate: string) {
  const phases: { id: string; name: string; color: string; tasks: Task[] }[] = [];
  const COLORS = [
    'hsl(var(--primary))', 'hsl(var(--info))', 'hsl(var(--warning))',
    'hsl(var(--success))', 'hsl(var(--destructive))', 'hsl(210, 60%, 50%)',
    'hsl(280, 50%, 55%)', 'hsl(160, 50%, 45%)',
  ];

  let dayOffset = 0;
  let colorIdx = 0;

  function processChapter(chapter: ParsedChapter, parentName?: string) {
    // Use code to ensure uniqueness — never merge by name
    const phaseName = parentName ? `${parentName} > ${chapter.name}` : chapter.name;
    const phaseId = `phase-${chapter.code || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (chapter.compositions.length > 0) {
      const tasks: Task[] = chapter.compositions.map(comp => {
        const laborComps: LaborComposition[] = comp.labor.map((l, i) => ({
          id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`,
          role: l.role,
          rup: l.rup,
          workerCount: l.workerCount,
        }));

        let duration = 5;
        if (laborComps.length > 0 && comp.quantity > 0) {
          let maxH = 0;
          for (const c of laborComps) {
            const eff = (comp.quantity * c.rup) / c.workerCount;
            if (eff > maxH) maxH = eff;
          }
          duration = Math.max(1, Math.ceil(maxH / 8));
        }
        const maxDays = Math.max(0, ...comp.labor.map(l => l.days));
        if (maxDays > 0) duration = Math.ceil(maxDays);

        const taskStart = new Date(startDate);
        taskStart.setDate(taskStart.getDate() + dayOffset);

        const task: Task = {
          id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: comp.name,
          phase: `[${chapter.code}] ${chapter.name}`,
          startDate: taskStart.toISOString().split('T')[0],
          duration,
          dependencies: [],
          responsible: '',
          percentComplete: 0,
          level: 0,
          quantity: comp.quantity,
          unit: comp.unit,
          itemCode: comp.code || undefined,
          priceBank: comp.bank || undefined,
          unitPriceNoBDI: comp.unitPriceNoBDI,
          laborCompositions: laborComps,
          materials: [],
          observations: comp.code ? `Código: ${comp.code}` : undefined,
        };

        dayOffset += duration;
        return task;
      });

      phases.push({
        id: phaseId,
        name: `[${chapter.code}] ${chapter.name}`,
        color: COLORS[colorIdx % COLORS.length],
        tasks,
      });
      colorIdx++;
    }

    for (const child of chapter.children) {
      processChapter(child, phaseName);
    }
  }

  for (const ch of result.chapters) {
    processChapter(ch);
  }

  return phases;
}

// ─── Legacy convert (flat tasks) ──────────────────────────────
export function convertToProjectTasks(parsed: ParsedTask[], startDate: string) {
  const groups = new Map<string, Task[]>();
  const baseDate = new Date(startDate);
  let dayOffset = 0;

  for (const p of parsed) {
    if (!groups.has(p.group)) groups.set(p.group, []);

    const taskStart = new Date(baseDate);
    taskStart.setDate(taskStart.getDate() + dayOffset);

    const laborComps: LaborComposition[] = p.labor.map((l, i) => ({
      id: `lc-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`,
      role: l.role,
      rup: l.rup,
      workerCount: l.workerCount,
    }));

    let duration = 5;
    if (laborComps.length > 0 && p.quantity > 0) {
      let maxH = 0;
      for (const c of laborComps) {
        const eff = (p.quantity * c.rup) / c.workerCount;
        if (eff > maxH) maxH = eff;
      }
      duration = Math.max(1, Math.ceil(maxH / 8));
    }

    const task: Task = {
      id: `t-imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: p.name,
      phase: p.group,
      startDate: taskStart.toISOString().split('T')[0],
      duration,
      dependencies: [],
      responsible: '',
      percentComplete: 0,
      level: 0,
      quantity: p.quantity,
      unit: p.unit,
      laborCompositions: laborComps,
      materials: [],
      observations: p.code ? `Código SINAPI: ${p.code}` : undefined,
    };

    groups.get(p.group)!.push(task);
    dayOffset += duration;
  }

  return { groups };
}

// ─── Standardize SINAPI names ──────────────────────────────────
export function standardizeSinapi(tasks: ParsedTask[]): ParsedTask[] {
  const roleMap: Record<string, string> = {
    'servente': 'Servente', 'pedreiro': 'Pedreiro', 'encanador': 'Encanador',
    'eletricista': 'Eletricista', 'ajudante': 'Ajudante', 'bombeiro hidráulico': 'Bombeiro Hidráulico',
    'topógrafo': 'Topógrafo', 'operador': 'Operador', 'mestre': 'Mestre de Obra',
    'carpinteiro': 'Carpinteiro', 'armador': 'Armador', 'pintor': 'Pintor', 'soldador': 'Soldador',
  };

  const unitMap: Record<string, string> = {
    'm²': 'm²', 'm2': 'm²', 'metro quadrado': 'm²', 'm³': 'm³', 'm3': 'm³', 'metro cúbico': 'm³',
    'm': 'm', 'ml': 'm', 'metro': 'm', 'metro linear': 'm', 'un': 'un', 'und': 'un', 'unid': 'un',
    'unidade': 'un', 'kg': 'kg', 'quilo': 'kg', 'l': 'L', 'litro': 'L', 'vb': 'vb', 'verba': 'vb',
    'cj': 'cj', 'conjunto': 'cj',
  };

  return tasks.map(t => ({
    ...t,
    name: t.name.replace(/\s+/g, ' ').replace(/^\d{4,6}\s*[-–]\s*/, '').trim(),
    unit: unitMap[t.unit.toLowerCase()] || t.unit,
    labor: t.labor.map(l => ({ ...l, role: roleMap[l.role.toLowerCase()] || capitalizeFirst(l.role) })),
  }));
}

// ─── Auto-detect format ───────────────────────────────────────
export function detectExcelFormat(data: ArrayBuffer): 'structured' | 'flat' {
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) return 'flat';

  // 1) If we can locate a header row with Código + Tipo + Resumo → structured
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;
    const headerNorm = row.map(c =>
      String(c ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    );
    const hasCode = headerNorm.some(h => h === 'codigo' || h === 'cod' || h === 'code');
    const hasType = headerNorm.some(h => h === 'tipo' || h === 'type');
    const hasDesc = headerNorm.some(h => h === 'resumo' || h === 'descricao' || h === 'description' || h === 'nome');
    if (hasCode && hasType && hasDesc) return 'structured';
  }

  // 2) Fallback heuristic: chapter-like + labor-like patterns
  let chapterLikeRows = 0;
  let laborLikeRows = 0;
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const hasDesc = row[2] != null && String(row[2]).trim() !== '';
    const hasD = row[3] != null && String(row[3]).trim() !== '';
    const hasE = row[4] != null && parseFloat(String(row[4])) > 0;
    const hasF = row[5] != null && parseFloat(String(row[5])) > 0;
    const hasG = row[6] != null && parseFloat(String(row[6])) > 0;
    const hasH = row[7] != null && parseFloat(String(row[7])) > 0;
    if (hasDesc && !hasD && !hasE && !hasF && !hasG && !hasH) chapterLikeRows++;
    if (hasD && !hasE && (hasF || hasG || hasH)) laborLikeRows++;
  }
  if (chapterLikeRows >= 1 && laborLikeRows >= 1) return 'structured';
  return 'flat';
}

// ─── Helpers ───────────────────────────────────────────────────
interface ColumnMap {
  code: number;
  bank: number;
  type: number;
  description: number;
  unit: number;
  quantity: number;
  productivity: number;
  unitPriceNoBDI: number;
  hours: number;
  days: number;
}

const DEFAULT_COLS: ColumnMap = {
  code: 0, bank: -1, type: 1, description: 2, unit: 3,
  quantity: 4, productivity: 5, unitPriceNoBDI: -1, hours: 6, days: 7,
};

function detectHeaderAndColumns(rows: any[][]): { startRow: number; cols: ColumnMap } {
  // Search for the header row in first 20 rows
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const headerNorm = row.map(c => normalizeText(c));
    const hasCode = headerNorm.some(h => h === 'codigo' || h === 'cod' || h === 'code');
    const hasType = headerNorm.some(h => h === 'tipo' || h === 'type');
    const hasDesc = headerNorm.some(h => h === 'resumo' || h === 'descricao' || h === 'description' || h === 'nome');
    if (hasCode && hasType && hasDesc) {
      const cols: ColumnMap = {
        code: findCol(headerNorm, ['codigo', 'cod', 'code', 'id']),
        bank: findCol(headerNorm, ['banco', 'fonte', 'origem']),
        type: findCol(headerNorm, ['tipo', 'type']),
        description: findCol(headerNorm, ['resumo', 'descricao', 'description', 'nome', 'servico']),
        unit: findCol(headerNorm, ['ud', 'und', 'unidade', 'unit', 'un']),
        quantity: findCol(headerNorm, ['quant', 'qtd', 'quantidade', 'qty']),
        productivity: findCol(headerNorm, ['prod', 'rup', 'coeficiente', 'produtividade']),
        unitPriceNoBDI: findCol(headerNorm, ['preco s/ bdi', 'preco sem bdi', 'preco unit', 'p. unit', 'valor unit', 'preco', 'unit price']),
        hours: findCol(headerNorm, ['horas trabalhadas', 'horas', 'hrs', 'h trab']),
        days: findCol(headerNorm, ['dias trabalhados', 'dias', 'd trab']),
      };
      // Apply sensible defaults for missing columns
      if (cols.code < 0) cols.code = 0;
      if (cols.bank < 0 && row.length >= 10) cols.bank = 1;
      if (cols.type < 0) cols.type = 2;
      if (cols.description < 0) cols.description = 3;
      if (cols.unit < 0) cols.unit = 4;
      if (cols.quantity < 0) cols.quantity = 5;
      if (cols.productivity < 0) cols.productivity = 6;
      if (cols.unitPriceNoBDI < 0 && row.length >= 8) cols.unitPriceNoBDI = 7;
      if (cols.hours < 0) cols.hours = 8;
      if (cols.days < 0) cols.days = 9;
      return { startRow: i + 1, cols };
    }
  }
  // Fallback: assume legacy 8-column layout, no header row detection
  return { startRow: 0, cols: { ...DEFAULT_COLS } };
}

function normalizeText(value: any): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function safeText(value: any): string {
  return String(value ?? '').trim();
}

function getCodeDepth(code: string): number {
  if (!code) return 0;
  const clean = code.replace(/\s/g, '');
  const parts = clean.split(/[.\-\/]/);
  return Math.max(0, parts.length - 1);
}

function getParentCode(code: string): string | null {
  if (!code) return null;
  const clean = code.replace(/\s/g, '');
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0) return null;
  return clean.substring(0, lastDot);
}

function findParentChapter(code: string, codeMap: Map<string, ParsedChapter>): ParsedChapter | null {
  if (!code) return null;
  let parentCode = getParentCode(code);
  while (parentCode) {
    const parent = codeMap.get(parentCode);
    if (parent) return parent;
    parentCode = getParentCode(parentCode);
  }
  return null;
}

function cellStr(val: any): string {
  if (val == null) return '';
  return String(val).trim();
}

function cellNum(val: any): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  return parseFloat(String(val).replace(',', '.')) || 0;
}

function findCol(header: string[], keys: string[]): number {
  for (const key of keys) {
    const idx = header.findIndex(h => String(h ?? '').toLowerCase().includes(key));
    if (idx >= 0) return idx;
  }
  return -1;
}

function getStr(row: any[], col: number): string {
  if (col < 0 || col >= row.length) return '';
  return String(row[col] ?? '').trim();
}

function getNum(row: any[], col: number): number {
  if (col < 0 || col >= row.length) return 0;
  const v = row[col];
  if (typeof v === 'number') return v;
  return parseFloat(String(v ?? '0').replace(',', '.')) || 0;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function cleanGroupName(s: string): string {
  return s.replace(/[:\-–]+$/, '').replace(/^\d+[\s.)\-]*/, '').trim()
    .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
