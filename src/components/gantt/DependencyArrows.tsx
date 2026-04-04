import { FlatTask, DEP_COLORS, ROW_HEIGHT } from './types';
import { diffDays } from './utils';

interface Props {
  flatTasks: FlatTask[];
  projectStart: Date;
  dayWidth: number;
  headerHeight: number;
}

export default function DependencyArrows({ flatTasks, projectStart, dayWidth, headerHeight }: Props) {
  const taskMap = new Map(flatTasks.map(ft => [ft.task.id, ft]));

  const arrows: JSX.Element[] = [];

  flatTasks.forEach(ft => {
    const details = ft.task.dependencyDetails || ft.task.dependencies.map(id => ({ taskId: id, type: 'TI' as const }));
    details.forEach(dep => {
      const src = taskMap.get(dep.taskId);
      if (!src) return;

      const srcStart = diffDays(projectStart, new Date(src.task.startDate));
      const srcEnd = srcStart + src.task.duration;
      const tgtStart = diffDays(projectStart, new Date(ft.task.startDate));
      const tgtEnd = tgtStart + ft.task.duration;

      const barMidY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

      let x1: number, y1: number, x2: number, y2: number;

      switch (dep.type) {
        case 'TI':
          x1 = srcEnd * dayWidth;
          y1 = barMidY(src.rowIndex);
          x2 = tgtStart * dayWidth;
          y2 = barMidY(ft.rowIndex);
          break;
        case 'II':
          x1 = srcStart * dayWidth;
          y1 = barMidY(src.rowIndex);
          x2 = tgtStart * dayWidth;
          y2 = barMidY(ft.rowIndex);
          break;
        case 'TT':
          x1 = srcEnd * dayWidth;
          y1 = barMidY(src.rowIndex);
          x2 = tgtEnd * dayWidth;
          y2 = barMidY(ft.rowIndex);
          break;
        case 'IT':
          x1 = srcStart * dayWidth;
          y1 = barMidY(src.rowIndex);
          x2 = tgtEnd * dayWidth;
          y2 = barMidY(ft.rowIndex);
          break;
      }

      const color = DEP_COLORS[dep.type] || '#378ADD';
      const midX = (x1 + x2) / 2;

      arrows.push(
        <g key={`${src.task.id}-${ft.task.id}-${dep.type}`}>
          <path
            d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={dep.type === 'IT' ? '4,2' : undefined}
            opacity={0.7}
          />
          {/* Arrow head */}
          <polygon
            points={`${x2},${y2} ${x2 - 5},${y2 - 3} ${x2 - 5},${y2 + 3}`}
            fill={color}
            opacity={0.7}
          />
        </g>
      );
    });
  });

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none z-10"
      style={{ width: '100%', height: '100%' }}
    >
      {arrows}
    </svg>
  );
}
