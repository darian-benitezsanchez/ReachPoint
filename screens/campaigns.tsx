// screens/campaigns.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Platform, Alert }
 from 'react-native';

import { syncCampaignToSupabase } from '../utils/cloudSync';

import { Campaign, listCampaigns, deleteCampaign, applyFilters, getStudentId } from '../data/campaignsData';
import studentsJson from '../data/students.json';
import {
  removeProgress,
  getProgress,
  exportSurveyCSV,
  exportCallOutcomesCSV,
} from '../data/campaignProgress';
import { exportCsvSmart } from '../utils/exportReport';

type Props = {
  onCreatePress?: () => void;
  onOpenCampaign?: (campaign: Campaign) => void;
};

type Student = Record<string, any>;

/** Build "Reminders: 2025-09-01, 2025-09-15" from campaign.reminders */
function remindersLabel(c: Campaign): string {
  if (!c.reminders?.length) return 'Reminders: —';
  const set = new Set<string>();
  for (const r of c.reminders) for (const d of r.dates ?? []) set.add(d);
  const list = Array.from(set).sort();
  return list.length ? `Reminders: ${list.join(', ')}` : 'Reminders: —';
}

export default function CampaignsScreen({ onCreatePress, onOpenCampaign }: Props) {
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await listCampaigns();
    setCampaigns(list);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const allStudents: Student[] = Array.isArray(studentsJson)
    ? (studentsJson as Student[])
    : (studentsJson as any)?.data ?? [];

  // ---------- Delete handling (native uses Alert, web uses inline confirm) ----------
  const requestDelete = (c: Campaign) => {
    if (Platform.OS === 'web') {
      setConfirmingDeleteId(c.id);
      return;
    }
    Alert.alert(
      'Delete campaign?',
      `This will remove "${c.name}" and its progress.\n\nTip: Download a report first if you want to keep a record.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCampaign(c.id);
            await removeProgress(c.id).catch(() => {});
            refresh();
          },
        },
      ]
    );
  };

  const performDelete = async (id: string) => {
    await deleteCampaign(id);
    await removeProgress(id).catch(() => {});
    setConfirmingDeleteId(null);
    refresh();
  };

  // ---------- CSV helpers (for summary export: Full Name, Outcome, Response, Timestamp) ----------
  function csvEscape(val: any) {
    const s = String(val ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function buildCSV(headers: string[], rows: Array<Record<string, any>>): string {
    const head = headers.map(csvEscape).join(',');
    const body = rows.map(r => headers.map(h => csvEscape(r[h])).join(',')).join('\n');
    return `${head}\n${body}`;
  }

  /** Try a few common field names to build a full name. */
  function deriveFullName(stu: Record<string, any>): string {
    const candidates = [
      `${String(stu?.first_name ?? '').trim()} ${String(stu?.last_name ?? '').trim()}`.trim(),
      `${String(stu?.FirstName ?? '').trim()} ${String(stu?.LastName ?? '').trim()}`.trim(),
      `${String(stu?.['First Name'] ?? '').trim()} ${String(stu?.['Last Name'] ?? '').trim()}`.trim(),
      String(stu?.name ?? '').trim(),
      String(stu?.full_name ?? '').trim(),
    ].filter(Boolean);
    return candidates[0] || '';
  }

  /** Get the last timestamp for the CURRENT survey answer of a contact. */
  function lastTimestampForAnswer(
    cp: any /* ContactProgress */,
    answer: string | undefined | null
  ): number | null {
    if (!cp?.surveyLogs?.length || !answer) return null;
    for (let i = cp.surveyLogs.length - 1; i >= 0; i--) {
      const entry = cp.surveyLogs[i];
      if (entry?.answer === answer) return entry.at ?? null;
    }
    return null;
  }

  /**
   * New summary export:
   * Columns: Full Name | Outcome | Response | Timestamp
   * (Timestamp = latest of lastCalledAt and time the current survey answer was recorded)
   * We also append Student ID, Campaign ID, Campaign Name for traceability (remove if not needed).
   */
  async function downloadReport(c: Campaign) {
    try {
      const filtered = applyFilters(allStudents, c.filters);

      const idToStudent: Record<string, Student> = {};
      filtered.forEach((s, i) => { idToStudent[getStudentId(s, i)] = s; });

      const prog = await getProgress(c.id);

      const headers = [
        'Full Name',
        'Outcome',
        'Response',
        'Timestamp',
        'Student ID',
        'Campaign ID',
        'Campaign Name',
      ];

      const rows: Array<Record<string, any>> = [];

      filtered.forEach((student, idx) => {
        const sid = getStudentId(student, idx);
        const st = idToStudent[sid];
        const fullName = deriveFullName(st);

        const cp = prog?.contacts?.[sid];
        const outcome = cp?.outcome ?? '';
        const response = cp?.surveyAnswer ?? '';

        const tCall = cp?.lastCalledAt ?? 0;
        const tResp = lastTimestampForAnswer(cp, cp?.surveyAnswer) ?? 0;
        const t = Math.max(tCall, tResp);
        const iso = t ? new Date(t).toISOString() : '';

        rows.push({
          'Full Name': fullName,
          'Outcome': outcome,
          'Response': response,
          'Timestamp': iso,
          'Student ID': sid,
          'Campaign ID': c.id,
          'Campaign Name': c.name,
        });
      });

      const csv = buildCSV(headers, rows);
      const fileName = `campaign-${c.id}-summary.csv`;

      const { mode, uri } = await exportCsvSmart(fileName, csv);
      setToast(mode === 'shared'
        ? `Shared ${fileName}`
        : `Copied CSV to clipboard • Saved at ${uri}`
      );
    } catch (e: any) {
      setToast(`Export failed: ${e?.message ?? String(e)}`);
    }
  }

  // New: survey responses CSV (contactId,answer,timestamp)
  async function downloadSurveyCSV(c: Campaign) {
    try {
      const csv = await exportSurveyCSV(c.id);
      const fileName = `campaign-${c.id}-survey.csv`;
      const { mode, uri } = await exportCsvSmart(fileName, csv);
      setToast(mode === 'shared'
        ? `Shared ${fileName}`
        : `Copied CSV to clipboard • Saved at ${uri}`
      );
    } catch (e: any) {
      setToast(`Survey export failed: ${e?.message ?? String(e)}`);
    }
  }

  // New: call outcomes CSV (contactId,outcome,timestamp)
  async function downloadCallOutcomesCSV(c: Campaign) {
    try {
      const csv = await exportCallOutcomesCSV(c.id);
      const fileName = `campaign-${c.id}-call-outcomes.csv`;
      const { mode, uri } = await exportCsvSmart(fileName, csv);
      setToast(mode === 'shared'
        ? `Shared ${fileName}`
        : `Copied CSV to clipboard • Saved at ${uri}`
      );
    } catch (e: any) {
      setToast(`Outcomes export failed: ${e?.message ?? String(e)}`);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading campaigns…</Text>
      </View>
    );
  }

  if (!campaigns.length) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.title}>No campaigns yet</Text>
        <Text style={styles.muted}>Create a campaign to start calling.</Text>
        <Pressable style={styles.primaryBtn} onPress={onCreatePress} role="button" tabIndex={0}>
          <Text style={styles.primaryBtnText}>Create Campaign</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Your Campaigns</Text>
        <Pressable style={styles.ghostBtn} onPress={onCreatePress} role="button" tabIndex={0}>
          <Text style={styles.ghostBtnText}>+ New</Text>
        </Pressable>
      </View>

      <FlatList
        data={campaigns}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => {
          const isConfirming = confirmingDeleteId === item.id;
          const reminderText = remindersLabel(item);

          return (
            <View style={styles.card}>
              {/* Header: tap to open campaign */}
              <Pressable
                style={styles.cardHead}
                onPress={() => onOpenCampaign?.(item)}
                role="button"
                tabIndex={0}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.cardSub}>
                    Created {new Date(item.createdAt).toLocaleDateString()} • {item.studentIds.length} students
                  </Text>
                  <Text style={styles.cardReminders} numberOfLines={2}>{reminderText}</Text>
                </View>
              </Pressable>

              {/* Actions row */}
              {!isConfirming ? (
                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => requestDelete(item)}
                    role="button"
                    style={styles.iconBtnDanger}
                    hitSlop={12}
                    tabIndex={0}
                    aria-label={`Delete ${item.name}`}
                  >
                    <Text style={styles.iconBtnDangerText}>🗑️</Text>
                  </Pressable>

                  <View style={{ flex: 1 }} />

                  {/* Summary report (Full Name, Outcome, Response, Timestamp) */}
                  <Pressable
                    onPress={() => downloadReport(item)}
                    role="button"
                    style={styles.iconBtn}
                    hitSlop={12}
                    accessibilityLabel="Download summary report"
                    aria-label="Download summary report"
                    tabIndex={0}
                  >
                    <Text style={styles.iconBtnText}>📥</Text>
                  </Pressable>

                  {/* Call outcomes CSV */}
                  <Pressable
                    onPress={() => downloadCallOutcomesCSV(item)}
                    role="button"
                    style={[styles.iconBtn, { marginLeft: 8 }]}
                    hitSlop={12}
                    accessibilityLabel="Download call outcomes CSV"
                    aria-label="Download call outcomes CSV"
                    tabIndex={0}
                  >
                    <Text style={styles.iconBtnText}>📊</Text>
                  </Pressable>

                  {/* Survey responses CSV (only if the campaign has a survey) */}
                  {item.survey ? (
                    <Pressable
                      onPress={() => downloadSurveyCSV(item)}
                      role="button"
                      style={[styles.iconBtn, { marginLeft: 8 }]}
                      hitSlop={12}
                      accessibilityLabel="Download survey responses CSV"
                      aria-label="Download survey responses CSV"
                      tabIndex={0}
                    >
                      <Text style={styles.iconBtnText}>📝</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <View style={[styles.actionsRow, { gap: 8 }]}>
                  <Text style={styles.confirmText}>Delete this campaign?</Text>
                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => setConfirmingDeleteId(null)}
                    role="button"
                    style={styles.smallBtn}
                    tabIndex={0}
                  >
                    <Text style={styles.smallBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => performDelete(item.id)}
                    role="button"
                    style={[styles.smallBtn, styles.smallBtnDanger]}
                    tabIndex={0}
                  >
                    <Text style={styles.smallBtnDangerText}>Delete</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        }}
      />

      {/* tiny toast (no alerts) */}
      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, padding:16, backgroundColor:'#0b0d12' },
  center:{ flex:1, alignItems:'center', justifyContent:'center' },
  title:{ color:'#e9eefb', fontSize:22, fontWeight:'800', marginBottom:8 },
  muted:{ color:'#96a0b3' },

  headerRow:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:8 },
  ghostBtn:{ paddingHorizontal:12, paddingVertical:8, borderRadius:10, borderWidth:1, borderColor:'#22325a' },
  ghostBtnText:{ color:'#cfe3ff', fontWeight:'800' },

  primaryBtn:{ backgroundColor:'#36c48f', paddingHorizontal:16, paddingVertical:12, borderRadius:12, marginTop:16 },
  primaryBtnText:{ color:'#08371f', fontWeight:'900' },

  card:{ backgroundColor:'#111521', borderColor:'#22325a', borderWidth:1, borderRadius:14, padding:14, marginTop:12 },
  cardHead:{ flexDirection:'row', alignItems:'flex-start', gap:10 },

  cardTitle:{ color:'#eaf2ff', fontWeight:'900', fontSize:16 },
  cardSub:{ color:'#9fb4de', marginTop:6 },
  cardReminders:{ color:'#9fb4de', marginTop:6, fontSize:12 },

  actionsRow:{ flexDirection:'row', alignItems:'center', marginTop:12 },

  iconBtn:{
    width:44, height:44, borderRadius:10,
    borderWidth:1, borderColor:'#22325a',
    alignItems:'center', justifyContent:'center',
    backgroundColor:'#1a2440',
  },
  iconBtnText:{ color:'#cfe3ff', fontSize:20, lineHeight:22 },

  iconBtnDanger:{
    width:44, height:44, borderRadius:10,
    borderWidth:1, borderColor:'#5b2a2a',
    alignItems:'center', justifyContent:'center',
    backgroundColor:'#3a2a2a',
  },
  iconBtnDangerText:{ color:'#ffb3b3', fontSize:20, lineHeight:22 },

  confirmText:{ color:'#ffdccd', marginRight:8 },

  smallBtn:{ paddingHorizontal:12, paddingVertical:10, borderRadius:10, borderWidth:1, borderColor:'#22325a', backgroundColor:'#1a2440' },
  smallBtnText:{ color:'#cfe3ff', fontWeight:'800' },
  smallBtnDanger:{ backgroundColor:'#3a2a2a', borderColor:'#5b2a2a' },
  smallBtnDangerText:{ color:'#ffd1d1', fontWeight:'900' },

  toast:{
    position:'absolute',
    left:16, right:16, bottom:20,
    backgroundColor:'#111521',
    borderColor:'#22325a',
    borderWidth:1,
    borderRadius:12,
    padding:12,
  },
  toastText:{ color:'#cfe3ff', textAlign:'center' },
});
