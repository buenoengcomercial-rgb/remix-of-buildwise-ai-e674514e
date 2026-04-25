import { AppView } from '@/types/project';
import { LayoutDashboard, GanttChart, ListTodo, ClipboardList, HardHat, Sparkles, ChevronsLeft, ChevronsRight, FolderOpen, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { listProjects, ProjectMeta } from '@/lib/projectStorage';

interface AppSidebarProps {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  projectName: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSwitchProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  activeProjectId: string;
}

const navItems: { view: AppView; label: string; icon: React.ElementType }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'gantt', label: 'Cronograma', icon: GanttChart },
  { view: 'tasks', label: 'Tarefas (EAP)', icon: ListTodo },
  { view: 'measurement', label: 'Medição', icon: ClipboardList },
];

export default function AppSidebar({ currentView, onViewChange, projectName, collapsed, onToggleCollapse, onSwitchProject, onCreateProject, activeProjectId }: AppSidebarProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [showProjects, setShowProjects] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    setProjects(listProjects());
  }, [showProjects, activeProjectId]);

  const handleCreate = () => {
    const name = newProjectName.trim();
    if (!name) return;
    onCreateProject(name);
    setNewProjectName('');
    setCreatingProject(false);
    setProjects(listProjects());
    setShowProjects(false);
  };

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} min-h-screen flex flex-col bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-fg))] transition-all duration-300`}>
      <div className="p-3 border-b border-[hsl(var(--sidebar-border))] flex items-center justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <HardHat className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-[hsl(var(--sidebar-fg))]">ObraPlanner</h1>
              <p className="text-xs opacity-60 truncate max-w-[120px]">{projectName}</p>
            </div>
          )}
        </div>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-[hsl(var(--sidebar-hover))] transition-colors flex-shrink-0"
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Seletor de projetos */}
      <div className="border-b border-[hsl(var(--sidebar-border))]">
        <button
          onClick={() => setShowProjects(!showProjects)}
          className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium hover:bg-[hsl(var(--sidebar-hover))] transition-colors ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? `Projetos: ${projectName}` : undefined}
        >
          <FolderOpen className="w-4 h-4 flex-shrink-0 opacity-70" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left truncate uppercase tracking-wide opacity-70">Obras</span>
              {showProjects
                ? <ChevronDown className="w-3 h-3 opacity-70" />
                : <ChevronRight className="w-3 h-3 opacity-70" />
              }
            </>
          )}
        </button>

        {showProjects && !collapsed && (
          <div className="px-2 pb-2 space-y-0.5">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => { onSwitchProject(p.id); setShowProjects(false); }}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] transition-colors truncate ${
                  p.id === activeProjectId
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'hover:bg-[hsl(var(--sidebar-hover))] text-[hsl(var(--sidebar-fg))]'
                }`}
                title={p.name}
              >
                {p.name}
              </button>
            ))}

            {creatingProject ? (
              <div className="flex items-center gap-1 pt-1">
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') { setCreatingProject(false); setNewProjectName(''); }
                  }}
                  placeholder="Nome da obra..."
                  className="flex-1 min-w-0 text-[11px] bg-[hsl(var(--sidebar-hover))] border border-[hsl(var(--sidebar-border))] rounded px-2 py-1 focus:outline-none focus:border-primary text-[hsl(var(--sidebar-fg))]"
                />
                <button
                  onClick={handleCreate}
                  className="text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreatingProject(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] text-primary hover:bg-primary/10 transition-colors font-medium"
              >
                <Plus className="w-3 h-3" /> Nova obra
              </button>
            )}
          </div>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(({ view, label, icon: Icon }) => {
          const isActive = currentView === view;
          return (
            <button
              key={view}
              onClick={() => onViewChange(view)}
              className={`w-full flex items-center ${collapsed ? 'justify-center' : ''} gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative`}
              title={collapsed ? label : undefined}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-primary rounded-lg"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}
              <Icon className={`w-4 h-4 relative z-10 ${isActive ? 'text-primary-foreground' : ''}`} />
              {!collapsed && (
                <span className={`relative z-10 ${isActive ? 'text-primary-foreground' : 'text-[hsl(var(--sidebar-fg))]'}`}>
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-2 border-t border-[hsl(var(--sidebar-border))]">
        <button
          className={`w-full flex items-center ${collapsed ? 'justify-center' : ''} gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors`}
          title={collapsed ? 'Gerar com IA' : undefined}
        >
          <Sparkles className="w-4 h-4" />
          {!collapsed && 'Gerar com IA'}
        </button>
      </div>
    </aside>
  );
}
