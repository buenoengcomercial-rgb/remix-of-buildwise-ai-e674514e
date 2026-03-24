import { Task, LaborComposition } from '@/types/project';
import * as XLSX from 'xlsx';

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

// ─── Excel / CSV parsing ───────────────────────────────────────
export function parseExcel(data: ArrayBuffer): ParsedTask[] {
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rows.length < 2) return [];

  // Try to auto-detect column mapping from header
  const header = rows[0].map((h: any) => String(h ?? '').toLowerCase().trim());

  const colMap = {
    code: findCol(header, ['código', 'codigo', 'cod', 'code', 'id']),
    name: findCol(header, ['descrição', 'descricao', 'description', 'nome', 'name', 'serviço', 'servico', 'tarefa']),
    unit: findCol(header, ['unidade', 'unit', 'und', 'un']),
    quantity: findCol(header, ['quantidade', 'qty', 'qtd', 'quant']),
    role: findCol(header, ['profissional', 'mão de obra', 'mao de obra', 'trabalhador', 'role', 'tipo', 'função', 'funcao']),
    rup: findCol(header, ['rup', 'coeficiente', 'produtividade', 'h/un', 'h/m', 'h/m²', 'h/m2']),
    group: findCol(header, ['grupo', 'group', 'capítulo', 'capitulo', 'fase', 'phase', 'categoria']),
  };

  // Group rows by composition code
  const taskMap = new Map<string, ParsedTask>();
  let currentGroup = 'Importados';

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    // Check if it's a group header (only has text in first column, rest empty)
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

    const key = code;
    if (!taskMap.has(key)) {
      taskMap.set(key, {
        code,
        name,
        unit,
        quantity: qty,
        group,
        labor: [],
        needsReview: false,
      });
    }

    const task = taskMap.get(key)!;
    if (role && rup > 0) {
      const existing = task.labor.find(l => l.role === role);
      if (existing) {
        existing.rup = rup; // update
      } else {
        task.labor.push({ role, rup, workerCount: 1 });
      }
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

  // Normalize line breaks
  const lines = text.split(/\n/);

  // Pattern: code - description (SINAPI style)
  const compositionPattern = /(\d{4,6})\s*[-–]\s*(.+?)(?:\s*[-–]\s*(.+?))?$/i;
  // Pattern for labor: role → rup h/unit or role coef h/unit
  const laborPattern = /(?:^|\s)(servente|pedreiro|encanador|eletricista|ajudante|bombeiro\s*hidráulico|topógrafo|operador|mestre|carpinteiro|armador|pintor|soldador|serralheiro|vidraceiro|gesseiro|azulejista|ladrilheiro|impermeabilizador|calceteiro|marmorista|montador)[\s:→\-]+(\d+[.,]\d+)\s*(?:h\/?(?:un|m[²³]?|kg|l|vb)?)?/gi;
  // Group header patterns
  const groupPattern = /^(?:cap[ií]tulo|grupo|fase|servi[çc]os?\s+(?:de\s+)?|instala[çc][ãa]o\s+(?:de\s+)?)\s*[:–-]?\s*(.+)/i;
  const uppercaseGroupPattern = /^([A-ZÀÁÂÃÉÊÍÓÔÕÚÇ\s]{5,50})$/;

  let currentTask: ParsedTask | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Check for group headers
    const groupMatch = line.match(groupPattern);
    if (groupMatch) {
      currentGroup = cleanGroupName(groupMatch[1]);
      continue;
    }
    if (uppercaseGroupPattern.test(line) && !compositionPattern.test(line)) {
      const cleaned = cleanGroupName(line);
      if (cleaned.length >= 4 && cleaned.length <= 50) {
        currentGroup = cleaned;
        continue;
      }
    }

    // Check for composition
    const compMatch = line.match(compositionPattern);
    if (compMatch) {
      if (currentTask) tasks.push(currentTask);

      const fullName = (compMatch[2] + (compMatch[3] ? ' - ' + compMatch[3] : '')).trim();
      const unitMatch = fullName.match(/\b(m[²³]?|un|kg|l|vb|cj|gl)\b/i);

      currentTask = {
        code: compMatch[1],
        name: fullName,
        unit: unitMatch ? unitMatch[1] : 'un',
        quantity: 1,
        group: currentGroup,
        labor: [],
        needsReview: false,
      };
      continue;
    }

    // Check for labor entries
    let laborMatch;
    laborPattern.lastIndex = 0;
    while ((laborMatch = laborPattern.exec(line)) !== null) {
      const role = capitalizeFirst(laborMatch[1].trim());
      const rup = parseFloat(laborMatch[2].replace(',', '.'));

      if (currentTask && rup > 0) {
        const existing = currentTask.labor.find(l => l.role.toLowerCase() === role.toLowerCase());
        if (!existing) {
          currentTask.labor.push({ role, rup, workerCount: 1 });
        }
      }
    }

    // Try quantity extraction
    if (currentTask) {
      const qtyMatch = line.match(/(?:quantidade|qtd\.?|quant\.?)\s*[:=]?\s*(\d+[.,]?\d*)/i);
      if (qtyMatch) {
        currentTask.quantity = parseFloat(qtyMatch[1].replace(',', '.'));
      }
    }
  }

  if (currentTask) tasks.push(currentTask);

  // Mark tasks that need review
  tasks.forEach(t => {
    if (t.labor.length === 0) {
      t.needsReview = true;
      t.reviewReason = 'Sem mão de obra identificada';
    }
    if (t.quantity <= 0) {
      t.needsReview = true;
      t.reviewReason = (t.reviewReason ? t.reviewReason + '; ' : '') + 'Quantidade não identificada';
    }
  });

  return tasks;
}

// ─── Convert parsed tasks to project tasks ─────────────────────
export function convertToProjectTasks(parsed: ParsedTask[], startDate: string): { groups: Map<string, Task[]> } {
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

    // Calculate duration from RUP
    let duration = 5; // default
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
    'servente': 'Servente',
    'pedreiro': 'Pedreiro',
    'encanador': 'Encanador',
    'eletricista': 'Eletricista',
    'ajudante': 'Ajudante',
    'bombeiro hidráulico': 'Bombeiro Hidráulico',
    'topógrafo': 'Topógrafo',
    'operador': 'Operador',
    'mestre': 'Mestre de Obra',
    'carpinteiro': 'Carpinteiro',
    'armador': 'Armador',
    'pintor': 'Pintor',
    'soldador': 'Soldador',
  };

  const unitMap: Record<string, string> = {
    'm²': 'm²', 'm2': 'm²', 'metro quadrado': 'm²',
    'm³': 'm³', 'm3': 'm³', 'metro cúbico': 'm³',
    'm': 'm', 'ml': 'm', 'metro': 'm', 'metro linear': 'm',
    'un': 'un', 'und': 'un', 'unid': 'un', 'unidade': 'un',
    'kg': 'kg', 'quilo': 'kg',
    'l': 'L', 'litro': 'L',
    'vb': 'vb', 'verba': 'vb',
    'cj': 'cj', 'conjunto': 'cj',
  };

  return tasks.map(t => ({
    ...t,
    name: t.name
      .replace(/\s+/g, ' ')
      .replace(/^\d{4,6}\s*[-–]\s*/, '')
      .trim(),
    unit: unitMap[t.unit.toLowerCase()] || t.unit,
    labor: t.labor.map(l => ({
      ...l,
      role: roleMap[l.role.toLowerCase()] || capitalizeFirst(l.role),
    })),
  }));
}

// ─── Helpers ───────────────────────────────────────────────────
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
  return s
    .replace(/[:\-–]+$/, '')
    .replace(/^\d+[\s.)\-]*/, '')
    .trim()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
