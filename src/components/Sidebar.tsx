import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, PhoneCall, BarChart3, SlidersHorizontal, Mic2 } from 'lucide-react';

export const Sidebar = () => {
  const links = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/leads', icon: Users, label: 'Lead Management' },
    { to: '/live', icon: PhoneCall, label: 'Live Agent' },
    { to: '/analytics', icon: BarChart3, label: 'Analytics' },
    { to: '/settings', icon: SlidersHorizontal, label: 'Prompt' },
  ];

  return (
    <div className="w-64 bg-zinc-950 text-zinc-100 h-screen flex flex-col border-r border-zinc-800" id="sidebar">
      <div className="p-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 bg-cyan-500/20 rounded-lg border border-cyan-500/50 flex items-center justify-center">
            <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></div>
          </div>
          <h1 className="text-lg font-bold tracking-tight uppercase">DPvision AI</h1>
        </div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mt-1">Calling Assistant</p>
      </div>

      <nav className="flex-1 px-4 mt-6">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 mb-2 rounded-xl transition-all duration-200 group ${
                isActive
                  ? 'bg-zinc-900 border border-zinc-800 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                  : 'hover:bg-zinc-900/50 text-zinc-500 hover:text-zinc-300'
              }`
            }
          >
            <Icon size={18} className="transition-transform group-hover:scale-110" />
            <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-6 border-t border-zinc-800">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/50 border border-zinc-800">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
            <Mic2 size={14} className="text-white" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-[10px] font-bold truncate text-zinc-100 uppercase">Pooja</p>
            <p className="text-[9px] text-zinc-500 font-mono tracking-tighter">DPVISION_AGENT</p>
          </div>
        </div>
      </div>
    </div>
  );
};
