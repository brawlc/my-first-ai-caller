import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { LeadManager } from './components/LeadManager';
import { LiveCall } from './components/LiveCall';
import { ResponseRulesEditor } from './components/ResponseRulesEditor';
import { Analytics } from './components/Analytics';

const Settings = () => <ResponseRulesEditor />;

export default function App() {
  return (
    <Router>
      <div className="flex bg-zinc-950 min-h-screen text-zinc-100 selection:bg-cyan-500/30">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/leads" element={<LeadManager />} />
            <Route path="/live" element={<LiveCall />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
