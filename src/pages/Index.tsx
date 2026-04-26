import { useState, useMemo, useEffect, useDeferredValue, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppView, Project } from '@/types/project';
import AppSidebar from '@/components/AppSidebar';
import Dashboard from '@/components/Dashboard';
import GanttChart from '@/components/GanttChart';
import TaskList from '@/components/TaskList';
import Measurement from '@/components/Measurement';
import UndoButton from '@/components/UndoButton';
import SaveStatusIndicator, { SaveStatus } from '@/components/SaveStatusIndicator';
import MigrationDialog from '@/components/MigrationDialog';
import { Menu, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { applyRupToProject, applyDailyLogsToProject, calculateCPM, captureBaseline, syncBaselineWithRup, settleAllDependencies } from '@/lib/calculations';
import { useAuth } from '@/hooks/useAuth';
import {
  listCloudProjects,
  loadCloudProject,
  upsertCloudProject,
  createCloudProject,
  renameCloudProject,
  duplicateCloudProject,
  deleteCloudProject,
  generateUniqueCloudName,
  getSampleSeed,
  CloudProjectMeta,
} from '@/lib/cloudProjects';
import type { ProjectMeta } from '@/lib/projectStorage';

const UNDO_LIMIT = 20;
const SAVE_DEBOUNCE_MS = 800;

type UndoStacks = Record<AppView, Project[]>;

export default function Index() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [rawProject, setRawProject] = useState<Project | null>(null);
  const [cloudList, setCloudList] = useState<CloudProjectMeta[]>([]);
  const [bootLoading, setBootLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const undoStacksRef = useRef<UndoStacks>({ dashboard: [], gantt: [], tasks: [], measurement: [] });
  const [undoVersion, setUndoVersion] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const initialLoadRef = useRef(false);

  // Redireciona para /auth quando não logado
  useEffect(() => {
    if (!authLoading && !user) navigate('/auth', { replace: true });
  }, [authLoading, user, navigate]);

  // Carrega lista da nuvem e o projeto ativo
  const refreshCloudList = useCallback(async (): Promise<CloudProjectMeta[]> => {
    const list = await listCloudProjects();
    setCloudList(list);
    return list;
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setBootLoading(true);
      try {
        let list = await refreshCloudList();
        if (list.length === 0) {
          // primeira vez: cria obra inicial com sample
          const name = await generateUniqueCloudName('Minha primeira obra');
          const created = await createCloudProject(name, user.id, getSampleSeed());
          if (cancelled) return;
          list = await refreshCloudList();
          setRawProject(created);
        } else {
          const proj = await loadCloudProject(list[0].id);
          if (cancelled) return;
          if (proj) setRawProject(proj);
        }
        initialLoadRef.current = true;
      } catch (e) {
        console.error(e);
        toast.error('Erro ao carregar obras da nuvem');
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, refreshCloudList]);

  // Salvamento debounced na nuvem
  useEffect(() => {
    if (!user || !rawProject || !initialLoadRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        await upsertCloudProject(rawProject, user.id);
        setSaveStatus('saved');
        // Atualiza nome/updated_at na lista
        setCloudList(prev => {
          const idx = prev.findIndex(p => p.id === rawProject.id);
          const meta: CloudProjectMeta = {
            id: rawProject.id,
            name: rawProject.name,
            createdAt: idx >= 0 ? prev[idx].createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          if (idx >= 0) {
            const copy = [...prev]; copy[idx] = meta; return copy;
          }
          return [meta, ...prev];
        });
      } catch (e) {
        console.error(e);
        setSaveStatus('error');
        toast.error('Erro ao salvar na nuvem. Sua alteração ficou apenas neste navegador.');
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [rawProject, user]);

  const deferredRawProject = useDeferredValue(rawProject);

  const project = useMemo(() => {
    if (!deferredRawProject) return null;
    return calculateCPM(
      settleAllDependencies(
        applyDailyLogsToProject(
          syncBaselineWithRup(
            applyRupToProject(captureBaseline(deferredRawProject))
          )
        )
      )
    );
  }, [deferredRawProject]);

  const makeViewSetter = useCallback((view: AppView) => {
    return (next: Project | ((prev: Project) => Project)) => {
      setRawProject(prev => {
        if (!prev) return prev;
        const resolved = typeof next === 'function' ? (next as (p: Project) => Project)(prev) : next;
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
    if (stack.length === 0) { toast.message('Nada para desfazer'); return; }
    const prev = stack.pop()!;
    setRawProject(prev);
    setUndoVersion(v => v + 1);
    toast.success('Alteração desfeita');
  }, []);

  const canUndo = (view: AppView) => undoStacksRef.current[view].length > 0;
  void undoVersion;

  const handleSwitchProject = async (id: string) => {
    try {
      const proj = await loadCloudProject(id);
      if (proj) {
        setRawProject(proj);
        undoStacksRef.current = { dashboard: [], gantt: [], tasks: [], measurement: [] };
        setUndoVersion(v => v + 1);
      }
    } catch {
      toast.error('Erro ao abrir obra');
    }
  };

  const handleCreateProject = async (name?: string): Promise<string | void> => {
    if (!user) return;
    try {
      const finalName = (name && name.trim()) || (await generateUniqueCloudName('Nova obra'));
      const newProj = await createCloudProject(finalName, user.id);
      await refreshCloudList();
      setRawProject(newProj);
      undoStacksRef.current = { dashboard: [], gantt: [], tasks: [], measurement: [] };
      setUndoVersion(v => v + 1);
      return newProj.id;
    } catch {
      toast.error('Erro ao criar obra');
    }
  };

  const handleRenameProject = async (id: string, newName: string) => {
    try {
      const updated = await renameCloudProject(id, newName);
      if (updated && rawProject && id === rawProject.id) setRawProject(updated);
      await refreshCloudList();
      setUndoVersion(v => v + 1);
    } catch {
      toast.error('Erro ao renomear');
    }
  };

  const handleDuplicateProject = async (id: string) => {
    if (!user) return;
    try {
      const copy = await duplicateCloudProject(id, user.id);
      if (copy) {
        await refreshCloudList();
        toast.success(`Obra duplicada: ${copy.name}`);
        setUndoVersion(v => v + 1);
      }
    } catch {
      toast.error('Erro ao duplicar');
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (cloudList.length <= 1) {
      toast.error('Não é possível excluir a única obra. Crie outra antes.');
      return;
    }
    try {
      await deleteCloudProject(id);
      const list = await refreshCloudList();
      if (rawProject && id === rawProject.id) {
        const next = list[0];
        if (next) {
          const proj = await loadCloudProject(next.id);
          if (proj) {
            setRawProject(proj);
            undoStacksRef.current = { dashboard: [], gantt: [], tasks: [], measurement: [] };
          }
        }
      }
      toast.success('Obra excluída');
      setUndoVersion(v => v + 1);
    } catch {
      toast.error('Erro ao excluir');
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/auth', { replace: true });
  };

  // Lista compatível com a sidebar (formato ProjectMeta)
  const sidebarProjects: ProjectMeta[] = useMemo(
    () => cloudList.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt })),
    [cloudList]
  );

  if (authLoading || (user && bootLoading) || !project || !rawProject) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard project={project} undoButton={<UndoButton canUndo={canUndo('dashboard')} onUndo={() => handleUndo('dashboard')} />} />;
      case 'gantt':
        return <GanttChart project={project} onProjectChange={ganttSetter} undoButton={<UndoButton canUndo={canUndo('gantt')} onUndo={() => handleUndo('gantt')} size="xs" />} />;
      case 'tasks':
        return <TaskList project={project} onProjectChange={tasksSetter} undoButton={<UndoButton canUndo={canUndo('tasks')} onUndo={() => handleUndo('tasks')} />} />;
      case 'measurement':
        return <Measurement project={project} onProjectChange={measurementSetter} undoButton={<UndoButton canUndo={canUndo('measurement')} onUndo={() => handleUndo('measurement')} />} />;
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
          onImportedProject={handleSwitchProject}
          activeProjectId={rawProject.id}
          projectsList={sidebarProjects}
          userEmail={user?.email ?? undefined}
          onLogout={handleLogout}
        />
      </div>

      <main className="flex-1 min-h-screen overflow-y-auto relative">
        <div className="absolute top-3 right-4 z-20">
          <SaveStatusIndicator status={saveStatus} />
        </div>
        {renderView()}
      </main>

      <MigrationDialog onMigrated={async () => { await refreshCloudList(); }} />
    </div>
  );
}
