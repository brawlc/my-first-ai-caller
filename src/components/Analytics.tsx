import React from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, Clock3, PhoneCall, TrendingUp, XCircle } from 'lucide-react';

const funnelStages = [
  {
    label: 'Pending',
    value: 42,
    percent: 100,
    color: 'bg-zinc-500',
    textColor: 'text-zinc-300',
    borderColor: 'border-zinc-700',
    icon: Clock3,
  },
  {
    label: 'Called',
    value: 31,
    percent: 74,
    color: 'bg-cyan-500',
    textColor: 'text-cyan-300',
    borderColor: 'border-cyan-500/30',
    icon: PhoneCall,
  },
  {
    label: 'Converted',
    value: 12,
    percent: 29,
    color: 'bg-green-500',
    textColor: 'text-green-300',
    borderColor: 'border-green-500/30',
    icon: CheckCircle2,
  },
  {
    label: 'Failed',
    value: 7,
    percent: 17,
    color: 'bg-red-500',
    textColor: 'text-red-300',
    borderColor: 'border-red-500/30',
    icon: XCircle,
  },
];

export const Analytics = () => {
  const totalLeads = funnelStages[0].value;
  const calledLeads = funnelStages[1].value;
  const convertedLeads = funnelStages[2].value;
  const failedLeads = funnelStages[3].value;
  const callRate = Math.round((calledLeads / totalLeads) * 100);
  const conversionRate = Math.round((convertedLeads / totalLeads) * 100);
  const lossRate = Math.round((failedLeads / totalLeads) * 100);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6" id="analytics">
      <header className="flex justify-between items-center bg-zinc-900/50 border border-zinc-800 rounded-2xl px-6 py-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight uppercase">Analytics</h2>
          <p className="text-xs text-zinc-500 uppercase font-mono">Lead Funnel</p>
        </div>
        <div className="px-4 py-2 bg-zinc-800/80 rounded-lg border border-zinc-700 flex items-center gap-2">
          <TrendingUp size={14} className="text-cyan-400" />
          <span className="text-[10px] font-bold text-cyan-300 uppercase">Pipeline View</span>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6">
        {[
          { label: 'Total Leads', value: totalLeads, sub: 'In funnel', tone: 'text-zinc-300' },
          { label: 'Call Rate', value: `${callRate}%`, sub: 'Reached by bot', tone: 'text-cyan-300' },
          { label: 'Conversion', value: `${conversionRate}%`, sub: 'Demo-ready leads', tone: 'text-green-300' },
          { label: 'Failed', value: `${lossRate}%`, sub: 'Needs review', tone: 'text-red-300' },
        ].map((metric, index) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className="col-span-12 sm:col-span-6 lg:col-span-3 bento-card"
          >
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">{metric.label}</div>
            <div className={`text-3xl font-bold ${metric.tone}`}>{metric.value}</div>
            <div className="text-[10px] font-mono text-zinc-500 uppercase mt-2">{metric.sub}</div>
          </motion.div>
        ))}

        <section className="col-span-12 bento-card p-6">
          <div className="flex items-center justify-between gap-4 mb-8">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide">Lead Funnel</h3>
              <p className="text-[11px] text-zinc-500 mt-1">Manual statuses from Lead Management</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-mono text-zinc-500 uppercase">Current Conversion</p>
              <p className="text-xl font-bold text-green-300">{conversionRate}%</p>
            </div>
          </div>

          <div className="space-y-5">
            {funnelStages.map((stage, index) => {
              const Icon = stage.icon;
              return (
                <motion.div
                  key={stage.label}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`rounded-xl border ${stage.borderColor} bg-zinc-950/50 p-4`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                        <Icon size={16} className={stage.textColor} />
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide">{stage.label}</p>
                        <p className="text-[10px] font-mono text-zinc-500 uppercase">{stage.value} leads</p>
                      </div>
                    </div>
                    <div className="text-sm font-bold">{stage.percent}%</div>
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-900 border border-zinc-800">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${stage.percent}%` }}
                      transition={{ duration: 0.7, delay: index * 0.08 }}
                      className={`h-full rounded-full ${stage.color}`}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        <section className="col-span-12 lg:col-span-7 bento-card">
          <div className="flex items-center gap-2 mb-5">
            <AlertTriangle size={15} className="text-amber-300" />
            <h3 className="text-sm font-bold uppercase tracking-wide">Funnel Notes</h3>
          </div>
          <div className="space-y-3">
            {[
              'Most leads are still pending, so the next workflow push should be outbound calls.',
              'Failed leads should be reviewed for wrong numbers, objections, or no-answer patterns.',
              'Converted leads should move quickly into demo booking while interest is fresh.',
            ].map((note) => (
              <div key={note} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-xs text-zinc-300">
                {note}
              </div>
            ))}
          </div>
        </section>

        <section className="col-span-12 lg:col-span-5 bento-card">
          <h3 className="text-sm font-bold uppercase tracking-wide mb-5">Next Action</h3>
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4">
            <p className="text-xs leading-relaxed text-zinc-200">
              Prioritize pending leads first, then rework failed leads with a softer opener and shorter call goal.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};
