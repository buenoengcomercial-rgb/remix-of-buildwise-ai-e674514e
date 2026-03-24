import { useState, useMemo } from 'react';
import { AppView, Project } from '@/types/project';
import { sampleProject } from '@/data/sampleProject';
import AppSidebar from '@/components/AppSidebar';
import Dashboard from '@/components/Dashboard';
import GanttChart from '@/components/GanttChart';
import TaskList from '@/components/TaskList';
import Purchases from '@/components/Purchases';
import { Menu, X } from 'lucide-react';
import { applyRupToProject, calculateCPM } from '@/lib/calculations';

export default function Index() {
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [rawProject, setRawProject] = useState<Project>(sampleProject);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Compute RUP durations + CPM on every project change
  const project = useMemo(() => calculateCPM(applyRupToProject(rawProject)), [rawProject]);

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard project={project} />;
      case 'gantt':
        return <GanttChart project={project} />;
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
        />
      </div>

      <main className="flex-1 min-h-screen overflow-y-auto">
        {renderView()}
      </main>
    </div>
  );
}
