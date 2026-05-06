export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  status: 'pending' | 'called' | 'converted' | 'failed';
  sentiment?: string;
  notes?: string;
  lastCallDate?: string;
}

export interface CallLog {
  id: string;
  leadId: string;
  timestamp: string;
  duration: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
  transcription: string[];
}

export interface AgentStats {
  totalCalls: number;
  conversionRate: number;
  averageSentiment: number;
  activeLines: number;
}
