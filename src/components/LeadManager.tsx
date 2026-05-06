import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Download, Search, MoreVertical, Plus, CalendarPlus, X, Pencil, Trash2 } from 'lucide-react';
import { Lead } from '../types';
import { createCalendarEvent, getAccessToken, isCalendarConfigured } from '../services/googleWorkspaceService';

type LeadStatus = Lead['status'];

type CalendarStatus = {
  tone: 'neutral' | 'success' | 'error';
  text: string;
};

type LeadForm = Pick<Lead, 'id' | 'name' | 'company' | 'email' | 'phone' | 'status'>;

const DEFAULT_LEADS: Lead[] = [
  { id: '1', name: 'James Wilson', company: 'TechFlow Inc', email: 'james@techflow.com', phone: '+1 555-0123', status: 'pending' },
  { id: '2', name: 'Maria Garcia', company: 'Global Logistics', email: 'maria@globallog.com', phone: '+1 555-4567', status: 'converted', sentiment: 'Positive' },
  { id: '3', name: 'Robert Chen', company: 'Apex Solutions', email: 'robert@apex.io', phone: '+1 555-8901', status: 'failed', sentiment: 'Irritated' },
  { id: '4', name: 'Anna Schmidt', company: 'Berlin Dynamics', email: 'anna@berlin-dyn.de', phone: '+49 123 45678', status: 'called', sentiment: 'Neutral' },
];

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'called', label: 'Called' },
  { value: 'converted', label: 'Converted' },
  { value: 'failed', label: 'Failed' },
];

const STATUS_CLASSES: Record<LeadStatus, string> = {
  pending: 'bg-zinc-800/50 border-zinc-700 text-zinc-400',
  called: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400',
  converted: 'bg-green-500/10 border-green-500/20 text-green-400',
  failed: 'bg-red-500/10 border-red-500/20 text-red-400',
};

function formatForDatetimeLocal(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function getDefaultMeetingDateTime() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return formatForDatetimeLocal(date);
}

function parseLeadStatus(value: unknown): LeadStatus {
  const normalized = String(value || '').trim().toLowerCase();
  return STATUS_OPTIONS.some((option) => option.value === normalized) ? (normalized as LeadStatus) : 'pending';
}

export const LeadManager = () => {
  const [leads, setLeads] = useState<Lead[]>(DEFAULT_LEADS);

  const [searchText, setSearchText] = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [demoTitle, setDemoTitle] = useState('');
  const [demoNotes, setDemoNotes] = useState('');
  const [demoDateTime, setDemoDateTime] = useState(getDefaultMeetingDateTime());
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [dataStatus, setDataStatus] = useState<CalendarStatus | null>({ tone: 'neutral', text: 'Loading leads...' });
  const [openActionLeadId, setOpenActionLeadId] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<LeadForm | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredLeads = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) => {
      return (
        lead.name.toLowerCase().includes(q) ||
        lead.company.toLowerCase().includes(q) ||
        lead.email.toLowerCase().includes(q) ||
        lead.phone.toLowerCase().includes(q)
      );
    });
  }, [leads, searchText]);

  useEffect(() => {
    let isMounted = true;

    const loadLeads = async () => {
      try {
        const response = await fetch('/api/leads');
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || 'Could not load MongoDB leads.');
        }
        if (!isMounted) return;
        setLeads(Array.isArray(payload.leads) && payload.leads.length ? payload.leads : DEFAULT_LEADS);
        setDataStatus({ tone: 'success', text: 'MongoDB connected. Leads are syncing.' });
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : 'Could not load MongoDB leads.';
        setDataStatus({ tone: 'error', text: `${message} Using sample leads until MongoDB is configured.` });
      }
    };

    void loadLeads();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as any[];

      const newLeads: Lead[] = data.map((item, index) => ({
        id: `imported-${Date.now()}-${index}`,
        name: item.Name || item.name || 'Unknown',
        company: item.Company || item.company || 'Unknown',
        email: item.Email || item.email || '',
        phone: item.Phone || item.phone || '',
        status: parseLeadStatus(item.Status || item.status),
      }));

      try {
        const response = await fetch('/api/leads/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leads: newLeads }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Import failed.');
        setLeads(payload.leads);
        setDataStatus({ tone: 'success', text: `Imported ${newLeads.length} leads into MongoDB.` });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed.';
        setLeads((prev) => [...prev, ...newLeads]);
        setDataStatus({ tone: 'error', text: `${message} Imported leads are only in this browser session.` });
      }
    };
    reader.readAsBinaryString(file);
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(leads);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');
    XLSX.writeFile(wb, 'Aura_Leads_Export.xlsx');
  };

  const updateLeadStatus = async (leadId: string, status: LeadStatus) => {
    const previousLeads = leads;
    const nextLead = leads.find((lead) => lead.id === leadId);
    if (!nextLead) return;

    setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, status } : lead)));
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nextLead, status }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not update lead.');
      setDataStatus({ tone: 'success', text: 'Lead status saved to MongoDB.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update lead.';
      setLeads(previousLeads);
      setDataStatus({ tone: 'error', text: message });
    }
  };

  const openEditLead = (lead: Lead) => {
    setEditingLead({
      id: lead.id,
      name: lead.name,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      status: lead.status,
    });
    setOpenActionLeadId(null);
  };

  const closeEditLead = () => {
    setEditingLead(null);
  };

  const openNewLead = () => {
    setEditingLead({
      id: `lead-${Date.now()}`,
      name: '',
      company: '',
      email: '',
      phone: '',
      status: 'pending',
    });
    setOpenActionLeadId(null);
  };

  const saveEditedLead = async () => {
    if (!editingLead) return;
    const nextLead = {
      ...editingLead,
      name: editingLead.name.trim() || 'Unknown',
      company: editingLead.company.trim() || 'Unknown',
      email: editingLead.email.trim(),
      phone: editingLead.phone.trim(),
    };

    const exists = leads.some((lead) => lead.id === nextLead.id);
    try {
      const response = await fetch(exists ? `/api/leads/${encodeURIComponent(nextLead.id)}` : '/api/leads', {
        method: exists ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextLead),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not save lead.');
      const savedLead = payload.lead as Lead;
      setLeads((prev) => (exists ? prev.map((lead) => (lead.id === savedLead.id ? { ...lead, ...savedLead } : lead)) : [savedLead, ...prev]));
      setSelectedLead((lead) => (lead?.id === savedLead.id ? { ...lead, ...savedLead } : lead));
      setEditingLead(null);
      setDataStatus({ tone: 'success', text: 'Lead saved to MongoDB.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save lead.';
      setDataStatus({ tone: 'error', text: message });
    }
  };

  const deleteLead = async (lead: Lead) => {
    const shouldDelete = window.confirm(`Delete ${lead.name}?`);
    if (!shouldDelete) return;
    const previousLeads = leads;
    setLeads((prev) => prev.filter((item) => item.id !== lead.id));
    setSelectedLead((selected) => (selected?.id === lead.id ? null : selected));
    setOpenActionLeadId(null);
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(lead.id)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not delete lead.');
      setDataStatus({ tone: 'success', text: 'Lead deleted from MongoDB.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not delete lead.';
      setLeads(previousLeads);
      setDataStatus({ tone: 'error', text: message });
    }
  };

  const connectCalendar = async () => {
    const configured = await isCalendarConfigured();
    if (!configured) {
      setCalendarStatus({ tone: 'error', text: 'Set VITE_CLIENT_ID in .env.local to enable Google Calendar.' });
      return;
    }

    try {
      setCalendarStatus({ tone: 'neutral', text: 'Connecting to Google Calendar...' });
      await getAccessToken();
      setIsCalendarConnected(true);
      setCalendarStatus({ tone: 'success', text: 'Google Calendar connected.' });
    } catch (error) {
      console.error(error);
      setIsCalendarConnected(false);
      setCalendarStatus({ tone: 'error', text: 'Calendar connection failed. Check Google OAuth client setup.' });
    }
  };

  const openBookingModal = (lead: Lead) => {
    setSelectedLead(lead);
    setDemoTitle(`DP vision Analytics Demo - ${lead.company}`);
    setDemoNotes(`Lead: ${lead.name}\nCompany: ${lead.company}\nPhone: ${lead.phone}\nEmail: ${lead.email}`);
    setDemoDateTime(getDefaultMeetingDateTime());
    setCalendarStatus(null);
  };

  const closeBookingModal = () => {
    setSelectedLead(null);
    setIsBooking(false);
  };

  const createDemoEvent = async () => {
    if (!selectedLead) return;
    if (!demoDateTime) {
      setCalendarStatus({ tone: 'error', text: 'Choose a meeting date and time.' });
      return;
    }

    try {
      setIsBooking(true);
      setCalendarStatus({ tone: 'neutral', text: 'Creating demo event...' });

      if (!isCalendarConnected) {
        await connectCalendar();
      }

      const start = new Date(demoDateTime);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const event = await createCalendarEvent({
        summary: demoTitle.trim() || `DP vision Analytics Demo - ${selectedLead.company}`,
        description: demoNotes.trim(),
        start: { dateTime: start.toISOString(), timeZone },
        end: { dateTime: end.toISOString(), timeZone },
        attendees: selectedLead.email ? [{ email: selectedLead.email }] : undefined,
      });

      setCalendarStatus({
        tone: 'success',
        text: event?.htmlLink ? `Demo booked. Open event: ${event.htmlLink}` : 'Demo booked in Google Calendar.',
      });
    } catch (error) {
      console.error(error);
      setCalendarStatus({ tone: 'error', text: 'Could not create event. Verify Google OAuth consent and calendar scope.' });
    } finally {
      setIsBooking(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6" id="lead-manager">
      <header className="flex justify-between items-center bg-zinc-900/50 border border-zinc-800 rounded-2xl px-6 py-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight uppercase">Lead Management</h2>
          <p className="text-xs text-zinc-500 uppercase font-mono">Excel + Google Calendar</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={connectCalendar}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600/20 border border-indigo-500/40 rounded-xl text-[10px] font-bold uppercase text-indigo-200 hover:bg-indigo-600/30 transition-colors"
          >
            <CalendarPlus size={14} /> {isCalendarConnected ? 'Calendar Ready' : 'Connect Calendar'}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800/80 border border-zinc-700 rounded-xl text-[10px] font-bold uppercase hover:bg-zinc-700/80 transition-colors"
          >
            <Upload size={14} /> Import
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx, .xls, .csv" className="hidden" />
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-[10px] font-bold uppercase hover:bg-green-500 transition-colors"
          >
            <Download size={14} /> Export XLS
          </button>
        </div>
      </header>

      {calendarStatus && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs ${
            calendarStatus.tone === 'success'
              ? 'bg-green-600/10 border-green-500/30 text-green-200'
              : calendarStatus.tone === 'error'
                ? 'bg-red-600/10 border-red-500/30 text-red-200'
                : 'bg-zinc-900 border-zinc-700 text-zinc-200'
          }`}
        >
          {calendarStatus.text}
        </div>
      )}

      {dataStatus && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs ${
            dataStatus.tone === 'success'
              ? 'bg-green-600/10 border-green-500/30 text-green-200'
              : dataStatus.tone === 'error'
                ? 'bg-amber-600/10 border-amber-500/30 text-amber-200'
                : 'bg-zinc-900 border-zinc-700 text-zinc-200'
          }`}
        >
          {dataStatus.text}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 bento-card p-0 overflow-hidden">
          <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={14} />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search leads..."
                className="w-full pl-10 pr-4 py-2 bg-zinc-950/50 border border-zinc-800 rounded-lg text-xs font-mono focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>
            <button onClick={openNewLead} className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-[10px] font-bold uppercase">
              <Plus size={14} className="inline mr-1" /> Add Lead
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-zinc-900/80 text-zinc-500">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Lead Identity</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Core Company</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest">Communication</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-center">Status</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-transparent">
                {filteredLeads.map((lead) => (
                  <tr key={lead.id} className="border-b border-zinc-800/50 hover:bg-cyan-500/5 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold">
                          {lead.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')}
                        </div>
                        <span className="text-xs font-bold text-zinc-100">{lead.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-[10px] text-zinc-400">{lead.company}</td>
                    <td className="px-6 py-4">
                      <div className="text-[10px] font-mono text-cyan-400/70 lowercase">{lead.email}</div>
                      <div className="text-[10px] font-mono text-zinc-500">{lead.phone}</div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <select
                        value={lead.status}
                        onChange={(e) => void updateLeadStatus(lead.id, e.target.value as LeadStatus)}
                        className={`min-w-28 rounded-full border px-3 py-1 text-[9px] font-bold uppercase tracking-widest outline-none transition-colors ${STATUS_CLASSES[lead.status]}`}
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value} className="bg-zinc-950 text-zinc-100">
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => openBookingModal(lead)}
                          className="px-3 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-[10px] font-bold uppercase text-indigo-200 hover:bg-indigo-600/30"
                        >
                          <CalendarPlus size={12} className="inline mr-1" />
                          Book Demo
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => setOpenActionLeadId((current) => (current === lead.id ? null : lead.id))}
                            className="p-2 rounded-lg text-zinc-600 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                            aria-label={`Open actions for ${lead.name}`}
                          >
                            <MoreVertical size={14} />
                          </button>
                          {openActionLeadId === lead.id && (
                            <div className="absolute right-0 top-9 z-30 w-36 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl shadow-black/40">
                              <button
                                onClick={() => openEditLead(lead)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[10px] font-bold uppercase text-zinc-200 hover:bg-zinc-800"
                              >
                                <Pencil size={12} />
                                Edit Lead
                              </button>
                              <button
                                onClick={() => void deleteLead(lead)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[10px] font-bold uppercase text-red-300 hover:bg-red-500/10"
                              >
                                <Trash2 size={12} />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedLead && (
        <div className="fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide">Book Demo - {selectedLead.name}</h3>
              <button onClick={closeBookingModal} className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="col-span-2 text-xs text-zinc-300">
                <span className="block mb-1 font-mono uppercase text-zinc-500 text-[10px]">Event Title</span>
                <input
                  value={demoTitle}
                  onChange={(e) => setDemoTitle(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </label>

              <label className="col-span-2 text-xs text-zinc-300">
                <span className="block mb-1 font-mono uppercase text-zinc-500 text-[10px]">Start Time</span>
                <input
                  type="datetime-local"
                  value={demoDateTime}
                  onChange={(e) => setDemoDateTime(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </label>

              <label className="col-span-2 text-xs text-zinc-300">
                <span className="block mb-1 font-mono uppercase text-zinc-500 text-[10px]">Description</span>
                <textarea
                  value={demoNotes}
                  onChange={(e) => setDemoNotes(e.target.value)}
                  rows={6}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={closeBookingModal}
                className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs font-bold uppercase"
              >
                Cancel
              </button>
              <button
                onClick={createDemoEvent}
                disabled={isBooking}
                className="px-4 py-2 rounded-lg border border-indigo-500/40 bg-indigo-600/20 text-indigo-200 text-xs font-bold uppercase disabled:opacity-50"
              >
                {isBooking ? 'Booking...' : 'Create Google Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingLead && (
        <div className="fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide">Edit Lead</h3>
              <button onClick={closeEditLead} className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800">
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="col-span-2 text-xs text-zinc-300">
                <span className="block mb-1 font-mono uppercase text-zinc-500 text-[10px]">Name</span>
                <input
                  value={editingLead.name}
                  onChange={(e) => setEditingLead((lead) => (lead ? { ...lead, name: e.target.value } : lead))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </label>

              <label className="col-span-2 sm:col-span-1 text-xs text-zinc-300">
                <span className="block mb-1 font-mono uppercase text-zinc-500 text-[10px]">Company</span>
                <input
                  value={editingLead.company}
                  onChange={(e) => setEditingLead((lead) => (lead ? { ...lead, company: e.target.value } : lead))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </label>

              <label className="col-span-2 sm:col-span-1 text-xs text-zinc-300">
                <span className="block mb-1 font-mono uppercase text-zinc-500 text-[10px]">Status</span>
                <select
                  value={editingLead.status}
                  onChange={(e) => setEditingLead((lead) => (lead ? { ...lead, status: e.target.value as LeadStatus } : lead))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-2 sm:col-span-1 text-xs text-zinc-300">
                <span className="block mb-1 font-mono uppercase text-zinc-500 text-[10px]">Email</span>
                <input
                  value={editingLead.email}
                  onChange={(e) => setEditingLead((lead) => (lead ? { ...lead, email: e.target.value } : lead))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </label>

              <label className="col-span-2 sm:col-span-1 text-xs text-zinc-300">
                <span className="block mb-1 font-mono uppercase text-zinc-500 text-[10px]">Phone</span>
                <input
                  value={editingLead.phone}
                  onChange={(e) => setEditingLead((lead) => (lead ? { ...lead, phone: e.target.value } : lead))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={closeEditLead}
                className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-xs font-bold uppercase"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveEditedLead()}
                className="px-4 py-2 rounded-lg border border-cyan-500/40 bg-cyan-600 text-white text-xs font-bold uppercase hover:bg-cyan-500"
              >
                Save Lead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
