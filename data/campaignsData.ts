// data/campaignsData.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import students from './students.json'; // keep your JSON next to this file

export type Operator = '=' | '~' | '>' | '>=' | '<' | '<=';
export type FilterCondition = {
  field: string;
  op: Operator;
  value: string;
};

export type Reminder = {
  contactId: string;
  dates: string[]; // ISO dates: "YYYY-MM-DD"
};

/** --------- NEW: Survey types (optional per-campaign) --------- */
export type SurveyInput = {
  question: string;
  options: string[]; // e.g., ["Yes","No","Maybe"]
};

export type Survey = SurveyInput & {
  createdAt: number;   // ms since epoch
  updatedAt: number;   // ms since epoch
  active?: boolean;    // optional flag if you want to toggle later
};

export type Campaign = {
  id: string;
  name: string;
  createdAt: number; // ms
  filters: FilterCondition[];
  studentIds: string[]; // ids from students.json
  reminders: Reminder[]; // per-contact chosen dates
  /** NEW: optional survey */
  survey?: Survey;
};

const STORAGE_KEY = 'connects.campaigns.v1';

export type Student = Record<string, any> & {
  id?: string | number;       // recommend you have an 'id' column; if not, index used
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
};

// ---- Students (read-only from bundled JSON) ----
export function getAllStudents(): Student[] {
  // If your students.json is an array, this just returns it.
  // If it's an object like { data: [...] }, adjust accordingly.
  if (Array.isArray(students)) return students as Student[];
  if (students && Array.isArray((students as any).data)) return (students as any).data;
  return [];
}

export function getStudentId(s: Student, fallbackIndex: number): string {
  const raw = s.id ?? String(fallbackIndex);
  return String(raw);
}

// ---- Campaign persistence ----
export async function listCampaigns(): Promise<Campaign[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Campaign[]) : [];
  } catch {
    return [];
  }
}

export async function saveCampaign(campaign: Campaign): Promise<void> {
  const existing = await listCampaigns();
  const idx = existing.findIndex(c => c.id === campaign.id);
  if (idx >= 0) existing[idx] = campaign;
  else existing.unshift(campaign);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export async function clearAllCampaigns(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function deleteCampaign(id: string): Promise<void> {
  const existing = await listCampaigns();
  const next = existing.filter(c => c.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** ----------------------- NEW: Survey helpers ----------------------- */

/**
 * Read the survey for a campaign (or null if none).
 */
export async function getCampaignSurvey(campaignId: string): Promise<Survey | null> {
  const all = await listCampaigns();
  const found = all.find(c => c.id === campaignId);
  return found?.survey ?? null;
}

/**
 * Upsert just the survey on a given campaign, preserving everything else.
 * Creates timestamps and keeps an 'active' flag if already present.
 */
export async function setCampaignSurvey(campaignId: string, input: SurveyInput): Promise<Campaign | null> {
  const all = await listCampaigns();
  const idx = all.findIndex(c => c.id === campaignId);
  if (idx < 0) return null;

  const now = Date.now();
  const prev = all[idx];
  const nextSurvey: Survey = {
    question: input.question.trim(),
    options: input.options.map(o => o.trim()).filter(Boolean),
    createdAt: prev.survey?.createdAt ?? now,
    updatedAt: now,
    active: prev.survey?.active ?? true,
  };

  const updated: Campaign = { ...prev, survey: nextSurvey };
  all[idx] = updated;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return updated;
}

/**
 * Remove the survey from a campaign (leaves the campaign intact).
 */
export async function clearCampaignSurvey(campaignId: string): Promise<Campaign | null> {
  const all = await listCampaigns();
  const idx = all.findIndex(c => c.id === campaignId);
  if (idx < 0) return null;

  const prev = all[idx];
  if (!prev.survey) return prev;

  const updated: Campaign = { ...prev };
  delete (updated as any).survey;

  all[idx] = updated;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return updated;
}

/**
 * Lightweight index of surveys for cross-script usage.
 * Returns only campaigns that currently have a survey.
 */
export async function listCampaignSurveys(): Promise<Array<{ id: string; name: string; survey: Survey }>> {
  const all = await listCampaigns();
  return all
    .filter(c => !!c.survey)
    .map(c => ({ id: c.id, name: c.name, survey: c.survey! }));
}

// ---- Filtering logic (AND) ----
export function applyFilters(data: Student[], filters: FilterCondition[]): Student[] {
  if (!filters.length) return data;
  return data.filter((row) =>
    filters.every((f) => {
      const raw = (row as any)[f.field];
      const cell = raw === undefined || raw === null ? '' : String(raw);
      const val = String(f.value);
      if (['>', '>=', '<', '<='].includes(f.op)) {
        const a = parseFloat(cell);
        const b = parseFloat(val);
        if (isNaN(a) || isNaN(b)) return false;
        if (f.op === '>') return a > b;
        if (f.op === '>=') return a >= b;
        if (f.op === '<') return a < b;
        if (f.op === '<=') return a <= b;
      } else if (f.op === '=') {
        return cell.toLowerCase() === val.toLowerCase();
      } else if (f.op === '~') {
        return cell.toLowerCase().includes(val.toLowerCase());
      }
      return false;
    })
  );
}

// ---- Utility ----
export function uniqueFieldsFromStudents(): string[] {
  const all = getAllStudents();
  const set = new Set<string>();
  all.forEach((s) => Object.keys(s).forEach((k) => set.add(k)));
  return Array.from(set);
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// (Keep this if another part of your app imports a default; otherwise safe to remove)
declare const value: any;
export default value;
