// utils/buildCloudRows.ts
import { applyFilters, getStudentId, Campaign } from '../data/campaignsData';
import studentsJson from '../data/students.json';
import { getProgress } from '../data/campaignProgress';

type Student = Record<string, any>;

export type CloudRow = {
  full_name: string;
  outcome: string;       // "answered" | "no_answer" | ""
  response: string;      // survey answer label or ""
  timestamp: string;     // ISO string (last relevant activity)
  student_id: string;
  campaign_id: string;
  campaign_name: string;
};

function lastSurveyTimestamp(cp?: { surveyLogs?: { at: number }[] }): number | null {
  const logs = cp?.surveyLogs ?? [];
  if (!logs.length) return null;
  return logs[logs.length - 1]!.at;
}

export async function buildCloudRowsForCampaign(c: Campaign): Promise<CloudRow[]> {
  // 1) normalize students
  const students: Student[] = Array.isArray(studentsJson)
    ? (studentsJson as Student[])
    : (studentsJson as any)?.data ?? [];

  // 2) contacts selected by this campaign
  const filtered = applyFilters(students, c.filters);

  // 3) progress
  const progress = await getProgress(c.id);

  // 4) flatten
  const rows: CloudRow[] = [];
  filtered.forEach((student, idx) => {
    const sid = getStudentId(student, idx);
    const cp = progress?.contacts?.[sid];

    const fullName = `${String(student.first_name ?? '').trim()} ${String(student.last_name ?? '').trim()}`.trim();
    const outcome = cp?.outcome ?? '';
    const response = cp?.surveyAnswer ?? '';

    // choose the most relevant timestamp:
    // - prefer last survey timestamp if present
    // - otherwise use lastCalledAt
    const surveyAt = lastSurveyTimestamp(cp ?? undefined);
    const ts = surveyAt ?? cp?.lastCalledAt ?? null;
    const iso = ts ? new Date(ts).toISOString() : '';

    rows.push({
      full_name: fullName,
      outcome,
      response,
      timestamp: iso,
      student_id: sid,
      campaign_id: c.id,
      campaign_name: c.name,
    });
  });

  return rows;
}
