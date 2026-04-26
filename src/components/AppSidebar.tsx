import { AppView } from '@/types/project';
import { LayoutDashboard, GanttChart, ListTodo, ClipboardList, HardHat, Sparkles, ChevronsLeft, ChevronsRight, FolderOpen, Plus, ChevronDown, ChevronRight, Pencil, Copy, Trash2, Check, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { listProjects, ProjectMeta } from '@/lib/projectStorage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface AppSidebarProps {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  projectName: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSwitchProject: (id: string) => void;
  onCreateProject: (name?: string) => string | void;
  onRenameProject: (id: string, newName: string) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  activeProjectId: string;
}

const navItems: { view: AppView; label: string; icon: React.ElementType }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'gantt', label: 'Cronograma', icon: GanttChart },
  { view: 'tasks', label: 'Tarefas (EAP)', icon: ListTodo },
  { view: 'measurement', label: 'Medição', icon: ClipboardList },
];

export default function AppSidebar({ currentView, onViewChange, projectName, collapsed, onToggleCollapse, onSwitchProject, onCreateProject, onRenameProject, onDuplicateProject, onDeleteProject, activeProjectId }: AppSidebarProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [showProjects, setShowProjects] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setProjects(listProjects());
  }, [showProjects, activeProjectId, editingId]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startEdit = (p: ProjectMeta) => {
    setEditingId(p.id);
    setEditingName(p.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveEdit = () => {
    const name = editingName.trim();
    if (!name || !editingId) {
      cancelEdit();
      return;
    }
    onRenameProject(editingId, name);
    setProjects(listProjects().map(p => p.id === editingId ? { ...p, name } : p));
    cancelEdit();
  };

  const handleNewProject = () => {
    setShowProjects(true);
    const newId = onCreateProject();
    if (typeof newId === 'string') {
      setTimeout(() => {
        const created = listProjects().find(p => p.id === newId);
        if (created) {
          setEditingId(newId);
          setEditingName(created.name);
        }
      }, 0);
    }
  };

  const confirmedDelete = () => {
    if (confirmDeleteId) {
      onDeleteProject(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  };

  const projectToDelete = projects.find(p => p.id === confirmDeleteId);

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
            {projects.map(p => {
              const isActive = p.id === activeProjectId;
              const isEditing = editingId === p.id;
              return (
                <div
                  key={p.id}
                  className={`group relative rounded text-[11px] transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground font-semibold'
                      : 'hover:bg-[hsl(var(--sidebar-hover))] text-[hsl(var(--sidebar-fg))]'
                  }`}
                >
                  {isEditing ? (
                    <div className="flex items-center gap-1 px-1.5 py-1">
                      <input
                        ref={editInputRef}
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        className="flex-1 min-w-0 text-[11px] bg-[hsl(var(--sidebar-hover))] border border-[hsl(var(--sidebar-border))] rounded px-1.5 py-0.5 focus:outline-none focus:border-primary text-[hsl(var(--sidebar-fg))]"
                      />
                      <button
                        onClick={saveEdit}
                        title="Salvar"
                        className="p-1 rounded hover:bg-primary/20 text-primary"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        title="Cancelar"
                        className="p-1 rounded hover:bg-destructive/20 text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <button
                        onClick={() => onSwitchProject(p.id)}
                        className="flex-1 min-w-0 text-left px-2 py-1.5 truncate"
                        title={p.name}
                      >
                        {p.name}
                      </button>
                      <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                          title="Renomear"
                          className={`p-1 rounded ${isActive ? 'hover:bg-primary-foreground/20' : 'hover:bg-[hsl(var(--sidebar-border))]'}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDuplicateProject(p.id); }}
                          title="Duplicar"
                          className={`p-1 rounded ${isActive ? 'hover:bg-primary-foreground/20' : 'hover:bg-[hsl(var(--sidebar-border))]'}`}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (projects.length <= 1) {
                              import('sonner').then(({ toast }) =>
                                toast.error('Não é possível excluir a única obra existente. Crie outra obra antes de excluir esta.')
                              );
                              return;
                            }
                            setConfirmDeleteId(p.id);
                          }}
                          title="Excluir obra"
                          className={`p-1 rounded ${isActive ? 'hover:bg-primary-foreground/20' : 'hover:bg-destructive/20 text-destructive'}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={handleNewProject}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] text-primary hover:bg-primary/10 transition-colors font-medium mt-1"
            >
              <Plus className="w-3 h-3" /> Nova obra
            </button>
          </div>
        )}
      </div>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir obra?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os dados da obra <strong>{projectToDelete?.name}</strong> (tarefas, medições, configurações)
              serão removidos permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmedDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
