import { useState, useMemo, useEffect, useDeferredValue, useCallback, useRef } from 'react';
import { AppView, Project } from '@/types/project';
import AppSidebar from '@/components/AppSidebar';
import Dashboard from '@/components/Dashboard';
import GanttChart from '@/components/GanttChart';
import TaskList from '@/components/TaskList';
import Measurement from '@/components/Measurement';
import UndoButton from '@/components/UndoButton';
import { Menu, X } from 'lucide-react';
import { toast } from 'sonner';
import { applyRupToProject, applyDailyLogsToProject, calculateCPM, captureBaseline, syncBaselineWithRup, settleAllDependencies } from '@/lib/calculations';
import { initProjects, saveProject, setActiveProjectId, loadProject, createNewProject, renameProject, duplicateProject, deleteProject, generateUniqueProjectName, listProjects } from '@/lib/projectStorage';

const UNDO_LIMIT = 20;

type UndoStacks = Record<AppView, Project[]>;

export default function Index() {
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [rawProject, setRawProject] = useState<Project>(() => initProjects());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Pilha de undo por aba (não persistida, apenas em memória)
  const undoStacksRef = useRef<UndoStacks>({
    dashboard: [],
    gantt: [],
    tasks: [],
    measurement: [],
  });
  // Versão para forçar re-render quando o histórico mudar (habilitar/desabilitar botão)
  const [undoVersion, setUndoVersion] = useState(0);

  useEffect(() => {
    saveProject(rawProject);
  }, [rawProject]);

  // Adia o recálculo pesado de CPM enquanto o usuário ainda está digitando/arrastando
  const deferredRawProject = useDeferredValue(rawProject);

  const project = useMemo(
    () => calculateCPM(
      settleAllDependencies(
        applyDailyLogsToProject(
          syncBaselineWithRup(
            applyRupToProject(captureBaseline(deferredRawProject))
          )
        )
      )
    ),
    [deferredRawProject]
  );

  /**
   * Empilha o estado anterior na pilha da aba e aplica a alteração.
   * Aceita Project ou updater (igual setState).
   */
  const makeViewSetter = useCallback((view: AppView) => {
    return (next: Project | ((prev: Project) => Project)) => {
      setRawProject(prev => {
        const resolved = typeof next === 'function'
          ? (next as (p: Project) => Project)(prev)
          : next;
        // Se nada mudou de fato, não registrar histórico
        if (resolved === prev) return prev;
        const stack = undoStacksRef.current[view];
        stack.push(prev);
        if (stack.length > UNDO_LIMIT) stack.shift();
        setUndoVersion(v => v + 1);
        return resolved;
      });
    };
  }, []);

  const ganttSetter = useMemo(() => makeViewSetter('gantt'), [makeViewSetter]);
  const tasksSetter = useMemo(() => makeViewSetter('tasks'), [makeViewSetter]);
  const measurementSetter = useMemo(() => makeViewSetter('measurement'), [makeViewSetter]);

  const handleUndo = useCallback((view: AppView) => {
    const stack = undoStacksRef.current[view];
    if (stack.length === 0) {
      toast.message('Nada para desfazer');
      return;
    }
    const prev = stack.pop()!;
    setRawProject(prev);
    setUndoVersion(v => v + 1);
    toast.success('Alteração desfeita');
  }, []);

  const canUndo = (view: AppView) => undoStacksRef.current[view].length > 0;
  // referenciar undoVersion para garantir re-render
  void undoVersion;

  const handleSwitchProject = (id: string) => {
    const proj = loadProject(id);
    if (proj) {
      setActiveProjectId(id);
      setRawProject(proj);
      // limpa históricos ao trocar de projeto
      undoStacksRef.current = { dashboard: [], gantt: [], tasks: [], measurement: [] };
      setUndoVersion(v => v + 1);
    }
  };

  const handleCreateProject = (name?: string) => {
    const finalName = (name && name.trim()) || generateUniqueProjectName('Nova obra');
    const newProj = createNewProject(finalName);
    setActiveProjectId(newProj.id);
    setRawProject(newProj);
    undoStacksRef.current = { dashboard: [], gantt: [], tasks: [], measurement: [] };
    setUndoVersion(v => v + 1);
    return newProj.id;
  };

  const handleRenameProject = (id: string, newName: string) => {
    const updated = renameProject(id, newName);
    if (updated && id === rawProject.id) {
      setRawProject(updated);
    }
    setUndoVersion(v => v + 1);
  };

  const handleDuplicateProject = (id: string) => {
    const copy = duplicateProject(id);
    if (copy) {
      toast.success(`Obra duplicada: ${copy.name}`);
      setUndoVersion(v => v + 1);
    }
  };

  const handleDeleteProject = (id: string) => {
    const all = listProjects();
    if (all.length <= 1) {
      toast.error('Não é possível excluir a única obra existente. Crie outra antes.');
      return;
    }
    deleteProject(id);
    if (id === rawProject.id) {
      const remaining = listProjects();
      const next = remaining[0];
      if (next) {
        const proj = loadProject(next.id);
        if (proj) {
          setActiveProjectId(proj.id);
          setRawProject(proj);
          undoStacksRef.current = { dashboard: [], gantt: [], tasks: [], measurement: [] };
        }
      }
    }
    toast.success('Obra excluída');
    setUndoVersion(v => v + 1);
  };

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return (
          <Dashboard
            project={project}
            undoButton={
              <UndoButton canUndo={canUndo('dashboard')} onUndo={() => handleUndo('dashboard')} />
            }
          />
        );
      case 'gantt':
        return (
          <GanttChart
            project={project}
            onProjectChange={ganttSetter}
            undoButton={
              <UndoButton canUndo={canUndo('gantt')} onUndo={() => handleUndo('gantt')} size="xs" />
            }
          />
        );
      case 'tasks':
        return (
          <TaskList
            project={project}
            onProjectChange={tasksSetter}
            undoButton={
              <UndoButton canUndo={canUndo('tasks')} onUndo={() => handleUndo('tasks')} />
            }
          />
        );
      case 'measurement':
        return (
          <Measurement
            project={project}
            onProjectChange={measurementSetter}
            undoButton={
              <UndoButton canUndo={canUndo('measurement')} onUndo={() => handleUndo('measurement')} />
            }
          />
        );
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden bg-card border border-border rounded-lg p-2 shadow-md"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/20 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className={`fixed lg:static z-40 transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <AppSidebar
          currentView={currentView}
          onViewChange={(v) => { setCurrentView(v); setSidebarOpen(false); }}
          projectName={project.name}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          onSwitchProject={handleSwitchProject}
          onCreateProject={handleCreateProject}
          onRenameProject={handleRenameProject}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          activeProjectId={rawProject.id}
        />
      </div>

      <main className="flex-1 min-h-screen overflow-y-auto">
        {renderView()}
      </main>
    </div>
  );
}
