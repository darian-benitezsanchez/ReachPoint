// data/campaignProgress.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Campaign, Student } from './campaignsData';

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Some SDK/type versions don't expose documentDirectory/cacheDirectory/EncodingType.
// Use a relaxed alias so TypeScript won't error, and keep runtime behavior intact.
const FS: any = FileSystem;

export type CallOutcome = 'answered' | 'no_answer';

export type CallLogEntry = {
  at: number;            // timestamp (ms)
  outcome: CallOutcome;
};

export type SurveyLogEntry = {
  at: number;            // timestamp (ms)
  answer: string;        // e.g., "Yes" | "No" | "Maybe" | "Left voicemail"
};

export type ContactProgress = {
  contactId: string;

  /** Call tracking */
  outcome?: CallOutcome;     // last call outcome (for quick totals)
  attempts: number;
  lastCalledAt?: number;     // ms
  logs?: CallLogEntry[];     // full call history

  /** Survey tracking */
  surveyAnswer?: string;         // last saved answer for this contact
  surveyLogs?: SurveyLogEntry[]; // history of survey answers
};

export type CampaignProgress = {
  campaignId: string;
  totals: {
    total: number;
    made: number;
    answered: number;
    missed: number;
  };
  contacts: Record<string, ContactProgress>;
  completed: boolean;
};

const KEY_PREFIX = 'connects.progress.v1:';
function storageKey(campaignId: string) {
  return `${KEY_PREFIX}${campaignId}`;
}

/* ===================== Init / Load / Save ===================== */

export async function loadOrInitProgress(
  campaignId: string,
  contactIds: string[],
): Promise<CampaignProgress> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (raw) {
    const parsed: CampaignProgress = JSON.parse(raw);

    // Backfill contacts + new fields
    for (const id of contactIds) {
      if (!parsed.contacts[id]) {
        parsed.contacts[id] = { contactId: id, attempts: 0, logs: [], surveyLogs: [] };
        parsed.totals.total += 1;
      } else {
        parsed.contacts[id].logs = parsed.contacts[id].logs ?? [];
        parsed.contacts[id].surveyLogs = parsed.contacts[id].surveyLogs ?? [];
      }
    }
    await AsyncStorage.setItem(storageKey(campaignId), JSON.stringify(parsed));
    return parsed;
  }

  const contacts: Record<string, ContactProgress> = {};
  for (const id of contactIds)
    contacts[id] = { contactId: id, attempts: 0, logs: [], surveyLogs: [] };

  const fresh: CampaignProgress = {
    campaignId,
    totals: { total: contactIds.length, made: 0, answered: 0, missed: 0 },
    contacts,
    completed: false,
  };
  await AsyncStorage.setItem(storageKey(campaignId), JSON.stringify(fresh));
  return fresh;
}

async function saveProgress(p: CampaignProgress) {
  // 🚫 don’t auto-mark completed. Keep whatever it was.
  // If you ever want to mark completed manually, add an explicit function for that.
  await AsyncStorage.setItem(storageKey(p.campaignId), JSON.stringify(p));
}

/* ===================== Calls: Outcomes & Totals ===================== */

export async function recordOutcome(
  campaignId: string,
  contactId: string,
  outcome: CallOutcome,
): Promise<CampaignProgress> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) throw new Error('Progress not initialized');
  const p: CampaignProgress = JSON.parse(raw);
  const c: ContactProgress =
    p.contacts[contactId] ?? { contactId, attempts: 0, logs: [], surveyLogs: [] };

  c.attempts += 1;
  c.lastCalledAt = Date.now();
  c.outcome = outcome;
  c.logs = c.logs ?? [];
  c.logs.push({ at: c.lastCalledAt, outcome });

  // Ensure survey history array exists
  c.surveyLogs = c.surveyLogs ?? [];

  p.contacts[contactId] = c;

  // Recompute totals
  let made = 0,
    ans = 0,
    miss = 0;
  for (const k of Object.keys(p.contacts)) {
    const oc = p.contacts[k].outcome;
    if (oc) {
      made += 1;
      if (oc === 'answered') ans += 1;
      if (oc === 'no_answer') miss += 1;
    }
  }
  p.totals.made = made;
  p.totals.answered = ans;
  p.totals.missed = miss;

  await saveProgress(p);
  return p;
}

export async function getSummary(
  campaignId: string,
): Promise<CampaignProgress['totals']> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) throw new Error('Progress not initialized');
  const p: CampaignProgress = JSON.parse(raw);
  return p.totals;
}

export async function clearMissedOutcomes(
  campaignId: string,
): Promise<CampaignProgress> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) throw new Error('Progress not initialized');
  const p: CampaignProgress = JSON.parse(raw);

  for (const id of Object.keys(p.contacts)) {
    if (p.contacts[id].outcome === 'no_answer') {
      p.contacts[id].outcome = undefined;
    }
  }
  let made = 0,
    ans = 0,
    miss = 0;
  for (const id of Object.keys(p.contacts)) {
    const oc = p.contacts[id].outcome;
    if (oc) {
      made += 1;
      if (oc === 'answered') ans += 1;
      if (oc === 'no_answer') miss += 1;
    }
  }
  p.totals = { ...p.totals, made, answered: ans, missed: miss };
  await saveProgress(p);
  return p;
}

export async function removeProgress(campaignId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(campaignId));
}

export async function getProgress(
  campaignId: string,
): Promise<CampaignProgress | null> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) return null;
  return JSON.parse(raw);
}

/* ===================== Surveys: Responses & Helpers ===================== */

export async function recordSurveyResponse(
  campaignId: string,
  contactId: string,
  answer: string,
): Promise<CampaignProgress> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) throw new Error('Progress not initialized');
  const p: CampaignProgress = JSON.parse(raw);

  const c: ContactProgress =
    p.contacts[contactId] ?? { contactId, attempts: 0, logs: [], surveyLogs: [] };
  c.surveyLogs = c.surveyLogs ?? [];
  c.surveyAnswer = answer;
  c.surveyLogs.push({ at: Date.now(), answer });

  p.contacts[contactId] = c;
  await saveProgress(p);
  return p;
}

export async function getSurveyResponse(
  campaignId: string,
  contactId: string,
): Promise<string | null> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) return null;
  const p: CampaignProgress = JSON.parse(raw);
  return p.contacts[contactId]?.surveyAnswer ?? null;
}

export async function getAllSurveyResponses(
  campaignId: string,
): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) return {};
  const p: CampaignProgress = JSON.parse(raw);
  const out: Record<string, string> = {};
  for (const [contactId, cp] of Object.entries(p.contacts)) {
    if (cp.surveyAnswer) out[contactId] = cp.surveyAnswer;
  }
  return out;
}

export async function clearSurveyResponse(
  campaignId: string,
  contactId: string,
): Promise<CampaignProgress> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) throw new Error('Progress not initialized');
  const p: CampaignProgress = JSON.parse(raw);

  const c = p.contacts[contactId];
  if (c) {
    delete c.surveyAnswer;
    c.surveyLogs = c.surveyLogs ?? [];
  }

  await saveProgress(p);
  return p;
}

/* ===================== CSV Utilities ===================== */

function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function lastTimestampForAnswer(cp: ContactProgress, answer: string): number | null {
  if (!cp.surveyLogs || cp.surveyLogs.length === 0) return null;
  for (let i = cp.surveyLogs.length - 1; i >= 0; i--) {
    const entry = cp.surveyLogs[i];
    if (entry.answer === answer) return entry.at;
  }
  return cp.surveyLogs[cp.surveyLogs.length - 1]?.at ?? null;
}

export async function exportSurveyCSV(campaignId: string): Promise<string> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) return 'contactId,answer,timestamp\n';

  const p: CampaignProgress = JSON.parse(raw);
  const rows: string[] = ['contactId,answer,timestamp'];

  for (const [contactId, cp] of Object.entries(p.contacts)) {
    if (!cp.surveyAnswer) continue;
    const at = lastTimestampForAnswer(cp, cp.surveyAnswer);
    const iso = at ? new Date(at).toISOString() : '';
    rows.push([csvField(contactId), csvField(cp.surveyAnswer), csvField(iso)].join(','));
  }
  rows.push('');
  return rows.join('\n');
}

export async function exportCallOutcomesCSV(campaignId: string): Promise<string> {
  const raw = await AsyncStorage.getItem(storageKey(campaignId));
  if (!raw) return 'contactId,outcome,timestamp\n';

  const p: CampaignProgress = JSON.parse(raw);
  const rows: string[] = ['contactId,outcome,timestamp'];

  for (const [contactId, cp] of Object.entries(p.contacts)) {
    const logs = cp.logs ?? [];
    for (const entry of logs) {
      const iso = entry?.at ? new Date(entry.at).toISOString() : '';
      rows.push([csvField(contactId), csvField(entry.outcome), csvField(iso)].join(','));
    }
  }
  rows.push('');
  return rows.join('\n');
}

/* ===================== Expo Save & Share ===================== */

async function writeFile(path: string, contents: string) {
  // UTF-8 is default for writeAsStringAsync; passing options is optional.
  await FileSystem.writeAsStringAsync(path, contents);
  return path;
}

function getBaseDir(): string {
  // Some SDK/type combos don't expose these in the d.ts. Access via FS:any.
  return (FS.documentDirectory ?? FS.cacheDirectory ?? '') as string;
}

export async function saveAndShareSurveyCSV(
  campaignId: string,
  fileName = `campaign_${campaignId}_survey.csv`,
): Promise<string> {
  const csv = await exportSurveyCSV(campaignId);
  const path = `${getBaseDir()}${fileName}`;
  await writeFile(path, csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Export Survey CSV',
    });
  }
  return path;
}

export async function saveAndShareCallOutcomesCSV(
  campaignId: string,
  fileName = `campaign_${campaignId}_call_outcomes.csv`,
): Promise<string> {
  const csv = await exportCallOutcomesCSV(campaignId);
  const path = `${getBaseDir()}${fileName}`;
  await writeFile(path, csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Export Call Outcomes CSV',
    });
  }
  return path;
}
