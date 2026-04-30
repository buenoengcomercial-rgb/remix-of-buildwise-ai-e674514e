import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import type jsPDFType from 'jspdf';
import type { Project, SavedMeasurement } from '@/types/project';
import type { GroupNode, GroupTotals } from '@/components/measurement/types';
import { STATUS_LABEL } from '@/components/measurement/types';
import { fmtBRL, fmtNum, fmtDateBR } from '@/components/measurement/measurementFormat';
import { trunc2 } from '@/lib/measurementCalculations';
import { logToProject, type AuditUserInfo } from '@/lib/audit';
import { loadCompanyLogoForPdf } from '@/lib/companyBranding';

type AutoTableFn = typeof import('jspdf-autotable').default;
type XLSXMod = typeof import('xlsx');

// Bibliotecas pesadas (~600 kB combinadas) são carregadas só ao exportar.
async function loadPdfDeps(): Promise<{ jsPDF: typeof jsPDFType; autoTable: AutoTableFn }> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF, autoTable };
}
async function loadXLSX(): Promise<XLSXMod> {
  return await import('xlsx');
}

interface HeaderFormFields {
  contractor: string;
  contracted: string;
  contractNumber: string;
  contractObject: string;
  location: string;
  budgetSource: string;
  artNumber: string;
  bdiPercent: number;
}

interface DailyReportsSummaryShape {
  totalDays: number;
  filledReports: number;
  missingReports: number;
  productionDays: number;
  impedimentDays: number;
}

interface UseMeasurementExportsParams {
  project: Project;
  projectRef: MutableRefObject<Project>;
  onProjectChange: (project: Project) => void;
  activeMeasurement: SavedMeasurement | null;
  groupTree: GroupNode[];
  totals: GroupTotals;
  headerForm: HeaderFormFields;
  effStart: string;
  effEnd: string;
  effIssue: string;
  effBdi: number;
  effNumber: string;
  dailyReportsSummary: DailyReportsSummaryShape;
  auditUser: AuditUserInfo;
}

export function useMeasurementExports(params: UseMeasurementExportsParams) {
  const {
    project,
    projectRef,
    onProjectChange,
    activeMeasurement,
    groupTree,
    totals,
    headerForm,
    effStart,
    effEnd,
    effIssue,
    effBdi,
    effNumber,
    dailyReportsSummary,
    auditUser,
  } = params;

  const { contractor, contracted, contractNumber, contractObject, location, budgetSource, artNumber, bdiPercent } = headerForm;

  // ───────── EXPORT XLSX ─────────
  const exportXLSX = useCallback(async () => {
    const XLSX = await loadXLSX();
    const headerCtx = activeMeasurement?.contractSnapshot ?? {
      contractor, contracted, contractNumber, contractObject, location, budgetSource, artNumber, bdiPercent,
    };
    const headerRows: (string | number)[][] = [
      ['BOLETIM DE MEDIÇÃO PARA PAGAMENTO'],
      [],
      ['Contratante:', headerCtx.contractor || '', '', 'Contratada:', headerCtx.contracted || ''],
      ['Obra:', project.name, '', 'Local/Município:', headerCtx.location || ''],
      ['Objeto:', headerCtx.contractObject || '', '', 'Nº Contrato:', headerCtx.contractNumber || ''],
      ['Nº ART:', headerCtx.artNumber || '', '', 'Medição Nº:', effNumber],
      ['Período:', `${fmtDateBR(effStart)} a ${fmtDateBR(effEnd)}`, '', 'Data emissão:', fmtDateBR(effIssue)],
      ['Fonte de orçamento:', headerCtx.budgetSource || '', '', 'BDI %:', effBdi],
      ['Status:', activeMeasurement ? STATUS_LABEL[activeMeasurement.status] : 'Em preparação'],
      [],
    ];

    const tableHeader = [
      'Item', 'Código', 'Banco', 'Descrição', 'Und.',
      'Quant. Contratada', 'V. Unit. s/ BDI', 'V. Unit. c/ BDI', 'Total Contratado',
      'Quant. Medição', 'Subtotal Medição',
      'Quant. Acumulada', 'Subtotal Acumulado',
      'Quant. a Executar', 'Subtotal a Executar',
    ];
    const dataRows: (string | number)[][] = [tableHeader];
    const blank = (n: number) => Array.from({ length: n }, () => '');

    const walkXLSX = (group: GroupNode) => {
      const indent = '  '.repeat(group.depth);
      dataRows.push([group.number, '', '', `${indent}${group.name}`, ...blank(11)]);
      group.rows.forEach(r => {
        dataRows.push([
          r.item, r.itemCode, r.priceBank, r.description, r.unit,
          Number(r.qtyContracted.toFixed(3)),
          trunc2(r.unitPriceNoBDI),
          trunc2(r.unitPriceWithBDI),
          trunc2(r.valueContracted),
          Number(r.qtyPeriod.toFixed(3)),
          trunc2(r.valuePeriod),
          Number(r.qtyCurrentAccum.toFixed(3)),
          trunc2(r.valueAccum),
          Number(r.qtyBalance.toFixed(3)),
          trunc2(r.valueBalance),
        ]);
      });
      group.children.forEach(walkXLSX);
      dataRows.push([
        '', '', '', `${indent}Subtotal ${group.number} ${group.name}`,
        '', '', '', '',
        trunc2(group.totals.contracted), '',
        trunc2(group.totals.period), '',
        trunc2(group.totals.accum), '',
        trunc2(group.totals.balance),
      ]);
    };
    groupTree.forEach(walkXLSX);

    dataRows.push([
      '', '', '', 'TOTAL GERAL', '', '', '', '',
      trunc2(totals.contracted), '',
      trunc2(totals.period), '',
      trunc2(totals.accum), '',
      trunc2(totals.balance),
    ]);

    const sheetData = [...headerRows, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [
      { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 38 }, { wch: 6 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
      { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Medição ${effNumber}`);
    XLSX.writeFile(wb, `medicao_${effNumber}_${effStart}_a_${effEnd}.xlsx`);
    if (activeMeasurement) {
      onProjectChange(logToProject(projectRef.current, {
        ...auditUser,
        entityType: 'measurement',
        entityId: activeMeasurement.id,
        action: 'exported',
        title: 'Medição exportada em Excel',
        metadata: { number: activeMeasurement.number },
      }));
    }
  }, [activeMeasurement, project, contractor, contracted, contractNumber, contractObject, location, budgetSource, artNumber, bdiPercent, effNumber, effStart, effEnd, effIssue, effBdi, groupTree, totals, onProjectChange, projectRef, auditUser]);

  // ───────── EXPORT PDF (limpo, A4 paisagem, sem chrome do navegador) ─────────
  const exportPDF = useCallback(async () => {
    const { jsPDF, autoTable } = await loadPdfDeps();
    const headerCtx = activeMeasurement?.contractSnapshot ?? {
      contractor, contracted, contractNumber, contractObject, location, budgetSource, artNumber, bdiPercent,
    };

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 5;

    // ── Logo da empresa (canto superior esquerdo) ──
    const logo = await loadCompanyLogoForPdf();
    const logoTargetW = 30; // mm
    let logoH = 0;
    if (logo) {
      const ratio = logo.width / logo.height;
      logoH = logoTargetW / ratio;
      try { doc.addImage(logo.dataUrl, 'PNG', margin, margin, logoTargetW, logoH, undefined, 'FAST'); } catch {}
    }

    // ── Título do boletim (com nº da medição) ──
    const numStr = String(effNumber || '');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(
      `BOLETIM DE MEDIÇÃO PARA PAGAMENTO — ${numStr}ª MEDIÇÃO`,
      pageW / 2, margin + 4, { align: 'center' },
    );

    let y = Math.max(margin + 7, margin + logoH + 1);

    // ── Cabeçalho em grade (autoTable) ──
    const usable = pageW - margin * 2;
    const headerColWidths = [
      usable * 0.10,
      usable * 0.40,
      usable * 0.10,
      usable * 0.40,
    ];
    const periodoStr = `${fmtDateBR(effStart)} a ${fmtDateBR(effEnd)}`;
    const statusStr = activeMeasurement ? STATUS_LABEL[activeMeasurement.status] : 'Em preparação';
    const headerRows: [string, string, string, string][] = [
      ['Obra:', project.name || '-', 'Medição Nº:', numStr || '-'],
      ['Contratante:', headerCtx.contractor || '-', 'Contratada:', headerCtx.contracted || '-'],
      ['Objeto:', headerCtx.contractObject || '-', 'Local/Município:', headerCtx.location || '-'],
      ['Nº Contrato:', headerCtx.contractNumber || '-', 'Nº ART:', headerCtx.artNumber || '-'],
      ['Período:', periodoStr, 'Data emissão:', fmtDateBR(effIssue) || '-'],
      ['Fonte de orçamento:', headerCtx.budgetSource || '-', 'BDI %:', `${effBdi}`],
      ['Status:', statusStr, '', ''],
    ];

    autoTable(doc, {
      startY: y,
      body: headerRows,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 1.4,
        overflow: 'linebreak',
        valign: 'middle',
        lineColor: [180, 180, 180],
        lineWidth: 0.15,
        textColor: 20,
      },
      columnStyles: {
        0: { cellWidth: headerColWidths[0], fontStyle: 'bold', fillColor: [243, 244, 246] },
        1: { cellWidth: headerColWidths[1] },
        2: { cellWidth: headerColWidths[2], fontStyle: 'bold', fillColor: [243, 244, 246] },
        3: { cellWidth: headerColWidths[3] },
      },
      margin: { left: margin, right: margin },
      tableWidth: usable,
    });
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 2.5;

    // ── Resumo financeiro ──
    const summary: [string, string][] = [
      ['Contratado', fmtBRL(totals.contracted)],
      ['Medição', fmtBRL(totals.period)],
      ['Acumulado', fmtBRL(totals.accum)],
      ['Saldo', fmtBRL(totals.balance)],
    ];
    const sumH = 7.5;
    const sumCellW = usable / summary.length;
    doc.setDrawColor(180);
    doc.setLineWidth(0.15);
    doc.setFillColor(249, 250, 251);
    doc.rect(margin, y, usable, sumH, 'FD');
    for (let i = 1; i < summary.length; i++) {
      const sx = margin + i * sumCellW;
      doc.line(sx, y, sx, y + sumH);
    }
    summary.forEach((s, i) => {
      const cx = margin + i * sumCellW + sumCellW / 2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.setTextColor(20);
      const text = `${s[0]}: ${s[1]}`;
      const maxW = sumCellW - 4;
      let fontSize = 8.2;
      while (doc.getTextWidth(text) > maxW && fontSize > 6) {
        fontSize -= 0.3;
        doc.setFontSize(fontSize);
      }
      const cy = y + sumH / 2 + fontSize * 0.18;
      doc.text(text, cx, cy, { align: 'center' });
    });
    y += sumH + 1.8;

    // ── Tabela ──
    const head = [[
      'Item', 'Código', 'Banco', 'Descrição', 'Und.',
      'Q. Contrat.', 'V.Un. s/BDI', 'V.Un. c/BDI', 'Total Contrat.',
      'Q. Medição', 'Subt. Medição',
      'Q. Acum.', 'Subt. Acum.',
      'Q. Saldo', 'Subt. Saldo',
    ]];

    type Row = (string | number)[];
    type RowMeta = { kind: 'chapter' | 'item' | 'subtotal' | 'total'; depth: number };
    const body: Row[] = [];
    const meta: RowMeta[] = [];

    const walkPDF = (group: GroupNode) => {
      const indent = '  '.repeat(group.depth);
      body.push([`${group.number}`, '', '', `${indent}${group.name}`, '', '', '', '', '', '', '', '', '', '', '']);
      meta.push({ kind: 'chapter', depth: group.depth });
      group.rows.forEach(r => {
        body.push([
          r.item, r.itemCode || '', r.priceBank || '', r.description, r.unit || '',
          fmtNum(r.qtyContracted),
          fmtBRL(r.unitPriceNoBDI),
          fmtBRL(r.unitPriceWithBDI),
          fmtBRL(r.valueContracted),
          fmtNum(r.qtyPeriod),
          fmtBRL(r.valuePeriod),
          fmtNum(r.qtyCurrentAccum),
          fmtBRL(r.valueAccum),
          fmtNum(r.qtyBalance),
          fmtBRL(r.valueBalance),
        ]);
        meta.push({ kind: 'item', depth: group.depth });
      });
      group.children.forEach(walkPDF);
      body.push([
        '', '', '', `${indent}Subtotal ${group.number} ${group.name}`, '', '', '', '',
        fmtBRL(group.totals.contracted), '',
        fmtBRL(group.totals.period), '',
        fmtBRL(group.totals.accum), '',
        fmtBRL(group.totals.balance),
      ]);
      meta.push({ kind: 'subtotal', depth: group.depth });
    };
    groupTree.forEach(walkPDF);

    body.push([
      '', '', '', 'TOTAL GERAL', '', '', '', '',
      fmtBRL(totals.contracted), '',
      fmtBRL(totals.period), '',
      fmtBRL(totals.accum), '',
      fmtBRL(totals.balance),
    ]);
    meta.push({ kind: 'total', depth: 0 });

    // Cores por grupo (em RGB neutros para PDF)
    const C_ID = [245, 245, 245] as [number, number, number];
    const C_CONTRACT = [219, 234, 254] as [number, number, number];
    const C_PERIOD = [220, 252, 231] as [number, number, number];
    const C_ACCUM = [254, 243, 199] as [number, number, number];
    const C_BALANCE = [254, 226, 226] as [number, number, number];

    const groupColor = (col: number): [number, number, number] | undefined => {
      if (col <= 4) return C_ID;
      if (col <= 8) return C_CONTRACT;
      if (col <= 10) return C_PERIOD;
      if (col <= 12) return C_ACCUM;
      return C_BALANCE;
    };

    autoTable(doc, {
      startY: y + 1,
      head,
      body,
      margin: { left: margin, right: margin, top: margin + 4, bottom: margin + 14 },
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: {
        font: 'helvetica',
        fontSize: 6.2,
        cellPadding: 1,
        overflow: 'linebreak',
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        valign: 'top',
      },
      headStyles: {
        fillColor: [60, 60, 70],
        textColor: 255,
        fontSize: 6.2,
        fontStyle: 'bold',
        halign: 'center',
      },
      tableWidth: pageW - margin * 2,
      columnStyles: (() => {
        const pct = [4, 5, 5, 20, 4, 6, 7, 7, 8, 6, 8, 6, 8, 6, 8];
        const sum = pct.reduce((a, b) => a + b, 0);
        const usable = pageW - margin * 2;
        const aligns: Array<'left' | 'right' | 'center'> = [
          'center', 'left', 'left', 'left', 'center',
          'right', 'right', 'right', 'right',
          'right', 'right', 'right', 'right', 'right', 'right',
        ];
        const styles: Record<number, { cellWidth: number; halign: 'left' | 'right' | 'center' }> = {};
        pct.forEach((p, i) => {
          styles[i] = { cellWidth: (usable * p) / sum, halign: aligns[i] };
        });
        return styles;
      })(),
      didParseCell: (data) => {
        if (data.section === 'head') {
          const c = groupColor(data.column.index);
          if (c) {
            const darken = (rgb: [number, number, number]): [number, number, number] =>
              [Math.max(0, rgb[0] - 40), Math.max(0, rgb[1] - 40), Math.max(0, rgb[2] - 40)];
            data.cell.styles.fillColor = darken(c);
            data.cell.styles.textColor = [30, 30, 30];
          }
          return;
        }
        const m = meta[data.row.index];
        if (!m) return;
        if (m.kind === 'chapter') {
          data.cell.styles.fillColor = m.depth === 0 ? [219, 234, 254] : [241, 245, 249];
          data.cell.styles.fontStyle = 'bold';
        } else if (m.kind === 'subtotal') {
          data.cell.styles.fillColor = m.depth === 0 ? [224, 231, 255] : [243, 244, 246];
          data.cell.styles.fontStyle = 'bold';
        } else if (m.kind === 'total') {
          data.cell.styles.fillColor = [55, 65, 81];
          data.cell.styles.textColor = 255;
          data.cell.styles.fontStyle = 'bold';
        } else {
          const c = groupColor(data.column.index);
          if (c) data.cell.styles.fillColor = c;
        }
      },
      didDrawPage: () => {
        const footerTop = pageH - margin - 10;
        doc.setDrawColor(180);
        doc.setLineWidth(0.2);
        doc.line(margin, footerTop, pageW - margin, footerTop);

        doc.setTextColor(80);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.4);
        doc.text('K. C. BUENO DE GODOY OLIVEIRA LTDA', pageW / 2, footerTop + 2.8, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        doc.text(
          'CNPJ: 39.973.085/0001-20  •  Rua Getúlio Vargas, 2533, São Cristóvão  •  Porto Velho/RO',
          pageW / 2, footerTop + 5.4, { align: 'center' }
        );

        const pageCount = doc.getNumberOfPages();
        const current = doc.getCurrentPageInfo().pageNumber;
        doc.setFontSize(6); doc.setTextColor(120);
        doc.text(
          `Medição Nº ${effNumber} — ${project.name || ''}`,
          margin, pageH - 1.5
        );
        doc.text(`Página ${current} / ${pageCount}`, pageW - margin, pageH - 1.5, { align: 'right' });
        doc.setTextColor(0);
      },
    });

    // ───── Resumo dos Diários de Obra do período ─────
    const drSnap = activeMeasurement?.dailyReportSnapshot;
    const drForPdf = drSnap ?? {
      totalDays: dailyReportsSummary.totalDays,
      filledReports: dailyReportsSummary.filledReports,
      missingReports: dailyReportsSummary.missingReports,
      productionDays: dailyReportsSummary.productionDays,
      impedimentDays: dailyReportsSummary.impedimentDays,
    };
    const drDraw = () => {
      const footerReserved = 14;
      let yPos = (doc as any).lastAutoTable?.finalY ?? margin;
      yPos += 6;
      const blockH = 22;
      if (yPos + blockH > pageH - margin - footerReserved) {
        doc.addPage();
        yPos = margin + 4;
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0);
      doc.text('DIÁRIOS DE OBRA DO PERÍODO', margin, yPos);
      yPos += 3;
      doc.setDrawColor(180); doc.setLineWidth(0.2);
      doc.line(margin, yPos, pageW - margin, yPos);
      yPos += 4;
      const cellW = (pageW - margin * 2) / 5;
      const items: Array<[string, string]> = [
        ['Total de dias', String(drForPdf.totalDays)],
        ['Diarios preenchidos', String(drForPdf.filledReports)],
        ['Diarios pendentes', String(drForPdf.missingReports)],
        ['Dias com producao', String(drForPdf.productionDays)],
        ['Dias c/ impedimento', String(drForPdf.impedimentDays)],
      ];
      items.forEach(([label, value], i) => {
        const x = margin + cellW * i;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(110); doc.setFontSize(6.5);
        doc.text(label, x + 1, yPos);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(0); doc.setFontSize(9);
        doc.text(value, x + 1, yPos + 5);
      });
      (doc as any).lastAutoTable = { finalY: yPos + 8 };
      doc.setTextColor(0);
    };
    drDraw();

    // ───── Bloco de assinaturas ─────
    const drawSignatures = () => {
      const blockH = 26;
      const footerReserved = 14;
      let yPos = (doc as any).lastAutoTable?.finalY ?? margin;
      yPos += 8;
      if (yPos + blockH > pageH - margin - footerReserved) {
        doc.addPage();
        yPos = margin + 4;
      }
      const colW = (pageW - margin * 2 - 20) / 2;
      const leftX = margin + 10;
      const rightX = margin + colW + 30;
      const lineY = yPos + 12;

      doc.setDrawColor(60); doc.setLineWidth(0.3);
      doc.line(leftX, lineY, leftX + colW - 20, lineY);
      doc.line(rightX, lineY, rightX + colW - 20, lineY);

      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      const leftCx = leftX + (colW - 20) / 2;
      const rightCx = rightX + (colW - 20) / 2;
      doc.text('Kennedy Christian Bueno de Godoy Oliveira', leftCx, lineY + 4, { align: 'center' });
      doc.text('Kelper Maximilian Bueno de Godoy Oliveira', rightCx, lineY + 4, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(80);
      doc.text('Responsável Legal — CREA 17279-D/RO', leftCx, lineY + 8, { align: 'center' });
      doc.text('Responsável Técnico — CREA 13940-D/RO', rightCx, lineY + 8, { align: 'center' });
      doc.setTextColor(0);
    };
    drawSignatures();

    const safe = (s: string) => (s || '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '');
    const num = String(effNumber).padStart(2, '0');
    const projectSlug = safe(project.name || 'Obra');
    doc.save(`Medicao_${num}_${projectSlug}.pdf`);
    if (activeMeasurement) {
      onProjectChange(logToProject(projectRef.current, {
        ...auditUser,
        entityType: 'measurement',
        entityId: activeMeasurement.id,
        action: 'exported',
        title: 'Medição exportada em PDF',
        metadata: { number: activeMeasurement.number },
      }));
    }
  }, [activeMeasurement, project, contractor, contracted, contractNumber, contractObject, location, budgetSource, artNumber, bdiPercent, effNumber, effStart, effEnd, effIssue, effBdi, groupTree, totals, dailyReportsSummary, onProjectChange, projectRef, auditUser]);

  const handlePrint = useCallback(() => exportPDF(), [exportPDF]);

  return { exportXLSX, exportPDF, handlePrint };
}
