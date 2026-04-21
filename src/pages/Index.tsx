import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { AppView, Project } from '@/types/project';
import AppSidebar from '@/components/AppSidebar';
import Dashboard from '@/components/Dashboard';
import GanttChart from '@/components/GanttChart';
import TaskList from '@/components/TaskList';
import Purchases from '@/components/Purchases';
import { Menu, X } from 'lucide-react';
import { applyRupToProject, applyDailyLogsToProject, calculateCPM, captureBaseline, syncBaselineWithRup, settleAllDependencies } from '@/lib/calculations';
import { initProjects, saveProject, setActiveProjectId, loadProject, createNewProject } from '@/lib/projectStorage';

export default function Index() {
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [rawProject, setRawProject] = useState<Project>(() => initProjects());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  const handleSwitchProject = (id: string) => {
    const proj = loadProject(id);
    if (proj) {
      setActiveProjectId(id);
      setRawProject(proj);
    }
  };

  const handleCreateProject = (name: string) => {
    const newProj = createNewProject(name);
    setActiveProjectId(newProj.id);
    setRawProject(newProj);
  };

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard project={project} />;
      case 'gantt':
        return <GanttChart project={project} onProjectChange={setRawProject} />;
      case 'tasks':
        return <TaskList project={project} onProjectChange={setRawProject} />;
      case 'purchases':
        return <Purchases project={project} onProjectChange={setRawProject} />;
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
          activeProjectId={rawProject.id}
        />
      </div>

      <main className="flex-1 min-h-screen overflow-y-auto">
        {renderView()}
      </main>
    </div>
  );
}
