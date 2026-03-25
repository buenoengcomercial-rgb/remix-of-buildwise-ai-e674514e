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
  name: string;
  unit: string;
  quantity: number;
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
  // Stack-based tracking: last active chapter/composition by sequential order
  let lastChapter: ParsedChapter | null = null;
  let lastComposition: ParsedComposition | null = null;

  // Skip header row if detected
  const startRow = detectHeaderRow(rows);

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const colA = cellStr(row[0]); // Código
    const colB = cellStr(row[1]); // Tipo
    const colC = cellStr(row[2]); // Resumo/Descrição
    const colD = cellStr(row[3]); // Unidade
    const colE = cellNum(row[4]); // Quantidade
    const colF = cellNum(row[5]); // Coeficiente (RUP)
    const colG = cellNum(row[6]); // Horas
    const colH = cellNum(row[7]); // Dias

    const hasD = colD !== '';
    const hasE = colE > 0;
    const hasF = colF > 0;
    const hasG = colG > 0;
    const hasH = colH > 0;

    // Skip completely empty rows
    const desc = colC || colB || colA;
    if (!desc && !hasD && !hasE && !hasF && !hasG && !hasH) continue;

    // Skip rows with empty code AND no useful data
    if (!colA && !hasD && !hasE && !hasF && !hasG && !hasH) continue;

    // ── Normalize column B for type detection (PRIORITY) ──
    const tipoNorm = colB.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const isTypeCap = tipoNorm === 'capitulo' || tipoNorm === 'cap' || tipoNorm === 'subcapitulo';
    const isTypeComp = tipoNorm === 'composicao' || tipoNorm === 'comp' || tipoNorm === 'servico' || tipoNorm === 'atividade';
    const isTypeLabor = tipoNorm === 'mao de obra' || tipoNorm === 'mdo' || tipoNorm === 'recurso' || tipoNorm === 'insumo mao de obra';
    const hasTypeHint = isTypeCap || isTypeComp || isTypeLabor;

    // ── Classification: Column B PRIORITY, columns D-H as fallback ──
    const classifiedAsChapter = hasTypeHint ? isTypeCap : (!hasD && !hasE && !hasF && !hasG && !hasH && !!desc);
    const classifiedAsComposition = hasTypeHint ? isTypeComp : (hasD && hasE && !hasF && !hasG && !hasH);
    const classifiedAsLabor = hasTypeHint ? isTypeLabor : (hasD && !hasE && (hasF || hasG || hasH));

    // ── CHAPTER / SUBCHAPTER ──
    if (classifiedAsChapter) {
      if (!colA) {
        warnings.push(`Linha ${i + 1}: capítulo sem código na coluna A, ignorado`);
        continue;
      }

      const chapter: ParsedChapter = {
        code: colA,
        name: (colC || colB || colA).trim(),
        children: [],
        compositions: [],
      };

      // Use code hierarchy (column A) to find parent
      const parentCode = getParentCode(colA);
      const parent = parentCode ? codeToChapter.get(parentCode) : null;

      if (parent) {
        parent.children.push(chapter);
      } else {
        rootChapters.push(chapter);
      }

      // Register by unique code — NEVER merge by name
      codeToChapter.set(colA, chapter);
      lastChapter = chapter;
      lastComposition = null; // reset composition context on new chapter
      continue;
    }

    // ── COMPOSITION (SERVICE) ──
    if (classifiedAsComposition) {
      const comp: ParsedComposition = {
        code: colA,
        name: (colC || colB || '').trim(),
        unit: colD || 'un',
        quantity: colE || 1,
        labor: [],
        needsReview: false,
      };

      // Try code-based parent first, then fall back to last active chapter
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

  // Check if it matches the structured pattern (8 columns: A-H)
  // Look for rows where D-H are empty (chapter pattern)
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

  // If we find chapter-like and labor-like patterns, it's structured
  if (chapterLikeRows >= 1 && laborLikeRows >= 1) return 'structured';
  return 'flat';
}

// ─── Helpers ───────────────────────────────────────────────────
function detectHeaderRow(rows: any[][]): number {
  if (rows.length === 0) return 0;
  const first = rows[0];
  if (!first) return 0;
  const textCells = first.filter((c: any) => typeof c === 'string' && c.trim().length > 0).length;
  const numCells = first.filter((c: any) => typeof c === 'number').length;
  // If first row is mostly text, it's a header
  return textCells > numCells && textCells >= 2 ? 1 : 0;
}

function getCodeDepth(code: string): number {
  if (!code) return 0;
  const clean = code.replace(/\s/g, '');
  const parts = clean.split(/[.\-\/]/);
  return Math.max(0, parts.length - 1);
}

// Get parent code by removing the last segment (e.g., "1.1.1" → "1.1", "1.1" → "1")
function getParentCode(code: string): string | null {
  if (!code) return null;
  const clean = code.replace(/\s/g, '');
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0) return null;
  return clean.substring(0, lastDot);
}

// Find the closest parent chapter by walking up the code hierarchy
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
    const idx = header.findIndex(h => h.includes(key));
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
