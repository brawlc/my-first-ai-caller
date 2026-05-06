import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, Users, PhoneIncoming, Heart } from 'lucide-react';
import { AgentStats } from '../types';

const stats: AgentStats = {
  totalCalls: 1284,
  conversionRate: 24.8,
  averageSentiment: 0.82,
  activeLines: 12,
};

export const Dashboard = () => {
  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6" id="dashboard">
      <header className="flex justify-between items-center bg-zinc-900/50 border border-zinc-800 rounded-2xl px-6 py-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight uppercase">Dashboard</h2>
          <p className="text-xs text-zinc-500 uppercase font-mono">Operational Strength: 99.8%</p>
        </div>
        <div className="flex gap-4">
          <div className="px-4 py-2 bg-zinc-800/80 rounded-lg border border-zinc-700 flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-400">EXCEL SYNC:</span>
            <span className="text-[10px] font-bold text-green-400 uppercase">Connected</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6">
        {/* Metric Cards */}
        {[
          { label: 'Total Calls', value: stats.totalCalls, icon: PhoneIncoming, color: 'text-cyan-400', sub: '+12% vs last week' },
          { label: 'Conv Rate', value: `${stats.conversionRate}%`, icon: TrendingUp, color: 'text-green-400', sub: 'Optimized for Sales' },
          { label: 'Sat Score', value: `${(stats.averageSentiment * 100).toFixed(0)}%`, icon: Heart, color: 'text-pink-400', sub: 'High Intensity' },
          { label: 'Nodes', value: stats.activeLines, icon: Users, color: 'text-purple-400', sub: 'Active Instances' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
            className="col-span-3 bento-card flex flex-col justify-between"
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{stat.label}</span>
              <stat.icon size={16} className={stat.color} />
            </div>
            <div>
              <div className="text-3xl font-bold mb-1 tracking-tight">{stat.value}</div>
              <div className={`text-[10px] font-mono ${stat.color} opacity-80 uppercase tracking-tighter`}>{stat.sub}</div>
            </div>
          </motion.div>
        ))}

        {/* Global Stream Feed */}
        <div className="col-span-8 bento-card-glass flex flex-col">
          <div className="flex justify-between items-center mb-8">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Global Stream Stream</div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]"></span>
              <span className="text-[10px] font-mono text-zinc-400 uppercase">Live Feed</span>
            </div>
          </div>
          
          <div className="flex items-end justify-center gap-1.5 h-32 mb-8 px-4">
            {[40, 60, 80, 100, 80, 60, 40, 20, 60, 90, 70, 30].map((h, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ repeat: Infinity, duration: 1.5, repeatType: 'reverse', delay: i * 0.1 }}
                className="bg-cyan-500/40 w-2 rounded-full border border-cyan-500/20"
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-4 text-center mt-auto">
            <div className="p-3 bg-green-500/5 border border-green-500/10 rounded-xl">
              <div className="text-xl font-bold text-green-400 uppercase">88%</div>
              <div className="text-[9px] text-zinc-500 uppercase font-mono tracking-widest">Positive</div>
            </div>
            <div className="p-3 bg-zinc-800/40 rounded-xl border border-zinc-700/50">
              <div className="text-xl font-bold text-zinc-300 uppercase">10%</div>
              <div className="text-[9px] text-zinc-500 uppercase font-mono tracking-widest">Neutral</div>
            </div>
            <div className="p-3 bg-red-500/5 border border-red-500/10 rounded-xl">
              <div className="text-xl font-bold text-red-400 uppercase">02%</div>
              <div className="text-[9px] text-zinc-500 uppercase font-mono tracking-widest">Urgent</div>
            </div>
          </div>
        </div>

        {/* Recent Conversions */}
        <div className="col-span-4 bento-card bg-zinc-900/40 flex flex-col">
          <div className="text-[10px] font-bold text-zinc-500 mb-6 uppercase tracking-widest">Recent Success</div>
          <div className="space-y-4 flex-1">
            {[
              { name: 'Sarah Jenkins', type: 'Enterprise', color: 'text-cyan-400', status: 'Active Engagement', time: '04:22' },
              { name: 'Global Logistics', type: 'Strategic', color: 'text-green-400', status: 'Booking Demo', time: '02:15' },
              { name: 'Robert Chen', type: 'SME', color: 'text-zinc-400', status: 'Handling Objections', time: '08:45' },
              { name: 'Anna Schmidt', type: 'Enterprise', color: 'text-cyan-400', status: 'Connection Est.', time: '00:12' }
            ].map((item, i) => (
              <div key={i} className="p-3 bg-zinc-800/30 rounded-xl border border-zinc-800/50 flex justify-between items-center group hover:border-zinc-700 transition-colors">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${i === 0 ? 'bg-cyan-400' : 'bg-green-400'}`} />
                    <span className="text-xs font-bold">{item.name}</span>
                  </div>
                  <span className="text-[9px] text-zinc-500 uppercase font-mono mt-0.5">{item.status}</span>
                </div>
                <div className="text-right">
                  <div className={`text-[10px] font-mono ${item.color} uppercase tracking-tighter`}>{item.time}</div>
                  <div className="text-[8px] opacity-30 font-mono uppercase">Node_{102 + i}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 p-4 bg-green-500/5 border border-green-500/10 rounded-xl">
             <div className="text-[10px] text-green-400 font-bold uppercase mb-1">Lead Potential</div>
             <p className="text-xs text-zinc-400 italic">High growth detected in Q4 Enterprise sectors.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
