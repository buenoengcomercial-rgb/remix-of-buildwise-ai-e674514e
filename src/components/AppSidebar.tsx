import { AppView } from '@/types/project';
import { LayoutDashboard, GanttChart, ListTodo, ShoppingCart, HardHat, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

interface AppSidebarProps {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  projectName: string;
}

const navItems: { view: AppView; label: string; icon: React.ElementType }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'gantt', label: 'Cronograma', icon: GanttChart },
  { view: 'tasks', label: 'Tarefas (EAP)', icon: ListTodo },
  { view: 'purchases', label: 'Compras', icon: ShoppingCart },
];

export default function AppSidebar({ currentView, onViewChange, projectName }: AppSidebarProps) {
  return (
    <aside className="w-64 min-h-screen flex flex-col bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-fg))]">
      <div className="p-5 border-b border-[hsl(var(--sidebar-border))]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <HardHat className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-[hsl(var(--sidebar-fg))]">ObraPlanner</h1>
            <p className="text-xs opacity-60 truncate max-w-[150px]">{projectName}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ view, label, icon: Icon }) => {
          const isActive = currentView === view;
          return (
            <button
              key={view}
              onClick={() => onViewChange(view)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative ${
                isActive
                  ? 'text-primary-foreground'
                  : 'text-[hsl(var(--sidebar-fg))] hover:bg-[hsl(var(--sidebar-hover))]'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-primary rounded-lg"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}
              <Icon className="w-4 h-4 relative z-10" />
              <span className="relative z-10">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-[hsl(var(--sidebar-border))]">
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
          <Sparkles className="w-4 h-4" />
          Gerar com IA
        </button>
      </div>
    </aside>
  );
}
