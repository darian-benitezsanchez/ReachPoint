// screens/execution.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  PanResponder,
  Animated,
  ScrollView,
} from 'react-native';
import studentsJson from '../data/students.json';
import {
  Campaign,
  applyFilters,
  getStudentId,
} from '../data/campaignsData';
import {
  loadOrInitProgress,
  recordOutcome,
  getSummary,
  CampaignProgress,
  // ✅ use centralized survey persistence
  recordSurveyResponse,
  getSurveyResponse,
} from '../data/campaignProgress';

type Props = {
  campaign: Campaign;                // pass in from route or parent
  onDone?: () => void;              // optional: navigate away when user taps Close/Done
};

type Student = Record<string, any>;

export default function ExecutionScreen({ campaign, onDone }: Props) {
  // Normalize students array
  const allStudents: Student[] = Array.isArray(studentsJson)
    ? (studentsJson as Student[])
    : (studentsJson as any)?.data ?? [];

  // Contacts in THIS campaign (recompute from saved filters)
  const filteredStudents = useMemo(
    () => applyFilters(allStudents, campaign.filters),
    [allStudents, campaign.filters]
  );

  // ID queue for this run (must match creation logic)
  const queueIds = useMemo(
    () => filteredStudents.map((s, i) => getStudentId(s, i)),
    [filteredStudents]
  );

  // Lookup student by our derived ID
  const idToStudent = useMemo(() => {
    const map: Record<string, Student> = {};
    filteredStudents.forEach((s, i) => {
      const id = getStudentId(s, i);
      map[id] = s;
    });
    return map;
  }, [filteredStudents]);

  // Progress state
  const [progress, setProgress] = useState<CampaignProgress | null>(null);
  const [mode, setMode] = useState<'idle' | 'running' | 'summary' | 'missed'>('idle');
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [passStrategy, setPassStrategy] = useState<'unattempted' | 'missed'>('unattempted');

  // Survey UI state (per-contact)
  const [selectedSurveyAnswer, setSelectedSurveyAnswer] = useState<string | null>(null);

  // Swipe anim
  const swipeX = useRef(new Animated.Value(0)).current;

  // Initialize or load progress for THIS queue
  useEffect(() => {
    (async () => {
      const p = await loadOrInitProgress(campaign.id, queueIds);
      setProgress(p);
    })();
  }, [campaign.id, queueIds]);

  const totals = progress?.totals ?? { total: 0, made: 0, answered: 0, missed: 0 };
  const pct = totals.total ? totals.made / totals.total : 0;

  /**
   * Pick the next contact ID based on:
   *  - The fixed queue order (queueIds)
   *  - The current saved progress (attempts/outcomes)
   *  - Strategy: 'unattempted' | 'missed'
   *  - Optional skipId: avoid immediately repeating the same contact (useful in 'missed' pass)
   */
  function pickNextId(
    p: CampaignProgress | null,
    strategy: 'unattempted' | 'missed',
    skipId?: string
  ): string | undefined {
    if (!p) return undefined;

    if (strategy === 'unattempted') {
      for (const id of queueIds) {
        if (id === skipId) continue;
        const c = p.contacts[id];
        if (!c || c.attempts === 0) return id;
      }
      return undefined;
    }

    // 'missed': first whose last outcome is 'no_answer'
    for (const id of queueIds) {
      if (id === skipId) continue;
      const c = p.contacts[id];
      if (c?.outcome === 'no_answer') return id;
    }
    return undefined;
  }

  async function advance(strategy: 'unattempted' | 'missed', skipId?: string) {
    // Ensure we’re using the freshest on-disk progress
    const fresh = await loadOrInitProgress(campaign.id, queueIds);
    setProgress(fresh);
    const nextId = pickNextId(fresh, strategy, skipId);
    setCurrentId(nextId);
    setSelectedSurveyAnswer(null); // reset selection when advancing
    if (!nextId) setMode('summary');
  }

  const beginCalls = async () => {
    setPassStrategy('unattempted');
    setMode('running');
    await advance('unattempted');
  };

  const beginMissed = async () => {
    setPassStrategy('missed');
    setMode('missed');
    await advance('missed');
  };

  // Load previously saved survey answer from centralized progress when currentId changes
  useEffect(() => {
    (async () => {
      if (!currentId) return;
      const prev = await getSurveyResponse(campaign.id, currentId);
      setSelectedSurveyAnswer(prev);
    })();
  }, [campaign.id, currentId]);

  // Save survey answer to centralized progress (so exports see it immediately)
  const onSelectSurvey = async (answer: string) => {
    if (!currentId) return;
    setSelectedSurveyAnswer(answer);
    await recordSurveyResponse(campaign.id, currentId, answer);
  };

  const onOutcome = async (outcome: 'answered' | 'no_answer') => {
    if (!currentId) return;
    // Save call outcome
    const p = await recordOutcome(campaign.id, currentId, outcome);
    setProgress(p);

    // In 'missed' pass: after logging 'no_answer', skip the same ID
    const skip = passStrategy === 'missed' ? currentId : undefined;
    await advance(passStrategy, skip);
  };

  // Swipe gestures (full screen)
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 18 && Math.abs(g.dy) < 24,
      onPanResponderMove: (_, g) => swipeX.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        const threshold = 80;
        if (g.dx > threshold) {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
          onOutcome('answered');
        } else if (g.dx < -threshold) {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
          onOutcome('no_answer');
        } else {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const currentStudent = currentId ? idToStudent[currentId] : undefined;

  // Use the real phone field ("Mobile Phone") with fallbacks
  const phone =
    (currentStudent?.['Mobile Phone*'] as string | undefined) ??
    (currentStudent?.phone as string | undefined) ??
    (currentStudent?.phone_number as string | undefined) ??
    (currentStudent?.mobile as string | undefined) ??
    '';

  const callNow = () => {
    if (!phone) return;
    Linking.openURL(`tel:${String(phone)}`);
  };

  // Convenience
  const survey = campaign.survey; // optional: { question, options, ... }

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d12' }}>
      {/* Progress Bar */}
      <View style={styles.progressWrap}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
        <Text style={styles.progressText}>
          {totals.made}/{totals.total} complete • {totals.answered} answered • {totals.missed} missed
        </Text>
      </View>

      {/* Modes */}
      {mode === 'idle' && (
        <View style={styles.center}>
          <Text style={styles.title}>{campaign.name}</Text>
          <Text style={styles.muted}>
            {queueIds.length} contact{queueIds.length === 1 ? '' : 's'} in this campaign
          </Text>
          <TouchableOpacity style={[styles.btn, styles.primaryBtn, { marginTop: 16 }]} onPress={beginCalls}>
            <Text style={styles.primaryBtnText}>Begin Calls</Text>
          </TouchableOpacity>
        </View>
      )}

      {(mode === 'running' || mode === 'missed') && currentStudent && (
        <Animated.View style={{ flex: 1, transform: [{ translateX: swipeX }] }} {...panResponder.panHandlers}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
            <Text style={styles.title}>
              {String(currentStudent.first_name ?? '')} {String(currentStudent.last_name ?? '')}
            </Text>
            <Text style={styles.hint}>Swipe right = Answered, Swipe left = No answer</Text>

            {/* Big call button */}
            <TouchableOpacity style={[styles.btn, styles.callBtn]} onPress={callNow} disabled={!phone}>
              <Text style={styles.callBtnText}>
                {phone ? `Call ${phone}` : 'No phone number'}
              </Text>
            </TouchableOpacity>

            {/* Student details */}
            <View style={styles.detailsCard}>
              {Object.keys(currentStudent).map((k) => (
                <View key={k} style={styles.kvRow}>
                  <Text style={styles.k}>{k}</Text>
                  <Text style={styles.v}>{String(currentStudent[k])}</Text>
                </View>
              ))}
            </View>

            {/* ---------------- Survey block (if configured) ---------------- */}
            {!!survey && !!survey.question && Array.isArray(survey.options) && survey.options.length > 0 && (
              <View style={styles.surveyCard}>
                <Text style={styles.surveyTitle}>{survey.question}</Text>
                <View style={styles.surveyChips}>
                  {survey.options.map((opt) => {
                    const sel = selectedSurveyAnswer === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        style={[styles.surveyChip, sel && styles.surveyChipSel]}
                        onPress={() => onSelectSurvey(opt)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.surveyChipText, sel && styles.surveyChipTextSel]}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {selectedSurveyAnswer ? (
                  <Text style={styles.surveySaved}>Saved: {selectedSurveyAnswer}</Text>
                ) : (
                  <Text style={styles.surveyHint}>Tap an option to record a response</Text>
                )}
              </View>
            )}

            {/* Manual outcome buttons */}
            <View style={styles.actionsRow}>
              <TouchableOpacity style={[styles.btn, styles.noBtn]} onPress={() => onOutcome('no_answer')}>
                <Text style={styles.noBtnText}>No Answer</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.yesBtn]} onPress={() => onOutcome('answered')}>
                <Text style={styles.yesBtnText}>Answered</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      )}

      {mode === 'summary' && (
        <SummaryBlock
          campaignId={campaign.id}
          onRepeatMissed={async () => {
            await beginMissed();
          }}
          onFinish={onDone}
        />
      )}
    </View>
  );
}

/* ---------------------- Summary subcomponent ---------------------- */
function SummaryBlock({
  campaignId,
  onRepeatMissed,
  onFinish,
}: {
  campaignId: string;
  onRepeatMissed?: () => void;
  onFinish?: () => void;
}) {
  const [totals, setTotals] = useState<{ total: number; made: number; answered: number; missed: number } | null>(null);

  useEffect(() => {
    (async () => {
      const t = await getSummary(campaignId);
      setTotals(t);
    })();
  }, [campaignId]);

  if (!totals) return null;

  const allDone = totals.missed === 0 && totals.made === totals.total;

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Campaign Summary</Text>
      <View style={styles.summaryCard}>
        <Row label="Total contacts" value={String(totals.total)} />
        <Row label="Calls made" value={String(totals.made)} />
        <Row label="Answered" value={String(totals.answered)} />
        <Row label="Missed" value={String(totals.missed)} />
      </View>

      {!allDone && (
        <TouchableOpacity style={[styles.btn, styles.warnBtn, { marginTop: 12 }]} onPress={onRepeatMissed}>
          <Text style={styles.warnBtnText}>Proceed to Missed Contacts</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.btn, styles.primaryBtn, { marginTop: 12 }]} onPress={onFinish}>
        <Text style={styles.primaryBtnText}>{allDone ? 'Done' : 'Finish for now'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowKV}>
      <Text style={styles.rowK}>{label}</Text>
      <Text style={styles.rowV}>{value}</Text>
    </View>
  );
}

/* ------------------------------ styles ------------------------------ */
const styles = StyleSheet.create({
  progressWrap: { padding: 16, paddingBottom: 8 },
  progressBar: {
    height: 10,
    backgroundColor: '#1c2741',
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#22325a',
  },
  progressFill: { height: '100%', backgroundColor: '#36c48f' },
  progressText: { color: '#9fb4de', marginTop: 8, fontSize: 12, textAlign: 'center' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { color: '#e9eefb', fontSize: 22, fontWeight: '800', marginBottom: 6 },
  muted: { color: '#96a0b3' },
  hint: { color: '#9fb4de', marginBottom: 10 },

  btn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  primaryBtn: { backgroundColor: '#36c48f' },
  primaryBtnText: { color: '#08371f', fontWeight: '900' },

  callBtn: { alignSelf: 'center', backgroundColor: '#36c48f', marginTop: 10, marginBottom: 14 },
  callBtnText: { color: '#08371f', fontWeight: '900', fontSize: 16 },

  detailsCard: { backgroundColor: '#111521', borderWidth: 1, borderColor: '#22325a', borderRadius: 14, padding: 12 },
  kvRow: { flexDirection: 'row', paddingVertical: 6, gap: 10 },
  k: { width: 120, color: '#9fb4de', fontSize: 12 },
  v: { flex: 1, color: '#eaf2ff' },

  /* ----- Survey styles ----- */
  surveyCard: {
    marginTop: 14,
    backgroundColor: '#0b1222',
    borderWidth: 1,
    borderColor: '#1c2741',
    borderRadius: 12,
    padding: 12,
  },
  surveyTitle: { color: '#dfe7fb', fontWeight: '800', marginBottom: 8, fontSize: 16 },
  surveyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  surveyChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#213158',
    backgroundColor: '#111521',
  },
  surveyChipSel: {
    backgroundColor: '#36c48f',
    borderColor: '#36c48f',
  },
  surveyChipText: { color: '#cfe3ff', fontWeight: '800' },
  surveyChipTextSel: { color: '#08371f', fontWeight: '900' },
  surveySaved: { color: '#9fb4de', marginTop: 8, fontSize: 12 },
  surveyHint: { color: '#8aa0c8', marginTop: 8, fontSize: 12 },

  /* Outcome buttons */
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 14 },
  yesBtn: { backgroundColor: '#1f3a2a', flex: 1, alignItems: 'center' },
  yesBtnText: { color: '#b9f4d7', fontWeight: '900' },
  noBtn: { backgroundColor: '#3a2a2a', flex: 1, alignItems: 'center' },
  noBtnText: { color: '#ffe0e0', fontWeight: '900' },

  summaryCard: { width: '90%', backgroundColor: '#111521', borderWidth: 1, borderColor: '#22325a', borderRadius: 14, padding: 12 },
  rowKV: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  rowK: { color: '#9fb4de' },
  rowV: { color: '#eaf2ff', fontWeight: '800' },

  warnBtn: { backgroundColor: '#ffc857' },
  warnBtnText: { color: '#3b2b00', fontWeight: '900' },
});
