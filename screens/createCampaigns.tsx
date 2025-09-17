// screens/createCampaigns.tsx
// ✅ iPhone-friendly: custom modal dropdowns, high-contrast colors
// ✅ Type-ahead suggestions for the "Value" input (unique values for the chosen field)
// ✅ Optional "Call Question" step before picking reminder dates (skippable)

import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Pressable,
  Platform,
  Keyboard,
  LayoutChangeEvent,
} from 'react-native';
import {
  applyFilters,
  getAllStudents,
  getStudentId,
  uniqueFieldsFromStudents,
  FilterCondition,
  Operator,
  saveCampaign,
  Campaign,
  toISODate,
} from '../data/campaignsData';

type Props = {
  onSaved?: (campaign: Campaign) => void;
};

const OPERATORS: Operator[] = ['=', '~', '>', '>=', '<', '<='];

/* ---------------------------- Reusable Dropdown ---------------------------- */
function Dropdown({
  label,
  value,
  options,
  onChange,
  style,
}: {
  label?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  style?: any;
}) {
  const [open, setOpen] = useState(false);
  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <View style={style}>
      {label ? <Text style={styles.dropdownLabel}>{label}</Text> : null}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setOpen(true)}
        style={styles.dropdownField}
        accessibilityRole="button"
      >
        <Text style={styles.dropdownValue} numberOfLines={1}>
          {value || 'Select'}
        </Text>
        <Text style={styles.dropdownChevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet} pointerEvents="box-none">
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{label || 'Select'}</Text>
                <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
                  <Text style={styles.modalClose}>Close</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 8 }}>
                {options.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => choose(opt)}
                    style={styles.optionRow}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.optionText}>{opt}</Text>
                    {opt === value ? <Text style={styles.optionTick}>✓</Text> : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ---------------------------- Suggestions Panel ---------------------------- */
function Suggestions({
  visible,
  items,
  onChoose,
  anchorWidth,
}: {
  visible: boolean;
  items: string[];
  onChoose: (v: string) => void;
  anchorWidth: number;
}) {
  if (!visible) return null;
  return (
    <View
      style={[
        styles.suggestWrap,
        {
          width: anchorWidth || '100%',
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.suggestCard}>
        <ScrollView
          style={{ maxHeight: 240 }}
          contentContainerStyle={{ paddingVertical: 4 }}
          keyboardShouldPersistTaps="handled"
        >
          {items.length ? (
            items.map((val) => (
              <TouchableOpacity key={val} style={styles.suggestItem} onPress={() => onChoose(val)}>
                <Text numberOfLines={1} style={styles.suggestText}>
                  {val}
                </Text>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.suggestEmpty}>
              <Text style={styles.suggestEmptyText}>No suggestions</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

/* ------------------------------ Main Screen ------------------------------ */
export default function CreateCampaignsScreen({ onSaved }: Props) {
  const students = useMemo(() => getAllStudents(), []);
  const fields = useMemo(() => uniqueFieldsFromStudents(), []);

  // Build an index of unique values by field for fast suggestions
  const valuesByField = useMemo(() => {
    const map = new Map<string, string[]>();
    fields.forEach((f) => map.set(f, []));
    const tmp = new Map<string, Set<string>>();
    fields.forEach((f) => tmp.set(f, new Set<string>()));
    for (const row of students) {
      for (const f of fields) {
        if (row && Object.prototype.hasOwnProperty.call(row, f)) {
          const v = (row as any)[f];
          if (v !== undefined && v !== null) {
            const s = String(v);
            if (s.trim()) tmp.get(f)!.add(s);
          }
        }
      }
    }
    tmp.forEach((set, f) => {
      map.set(
        f,
        Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      );
    });
    return map;
  }, [students, fields]);

  const [name, setName] = useState('');
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [step, setStep] = useState<'filters' | 'question' | 'dates'>('filters');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  // Filter editor state
  const [field, setField] = useState(fields[0] ?? '');
  const [op, setOp] = useState<Operator>('=');
  const [value, setValue] = useState('');

  // Suggestions state
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestWidth, setSuggestWidth] = useState(0);
  const valueAnchorRef = useRef<View>(null);

  const matched = useMemo(() => applyFilters(students, filters), [students, filters]);

  const addCondition = () => {
    if (!field || !op || value.trim() === '') return;
    setFilters((prev) => [...prev, { field, op, value }]);
    setValue('');
    setShowSuggest(false);
    Keyboard.dismiss();
  };
  const removeCondition = (idx: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== idx));
  };

  /* --------------------------- NEW: Question step --------------------------- */
  const DEFAULT_OPTIONS = ['Yes', 'No', 'Maybe'];
  const [collectResponses, setCollectResponses] = useState<boolean>(true);
  const [questionText, setQuestionText] = useState<string>('Are you attending the event?');
  const [options, setOptions] = useState<string[]>(DEFAULT_OPTIONS.slice());
  const [newOption, setNewOption] = useState<string>('');

  const addOption = () => {
    const clean = newOption.trim();
    if (!clean) return;
    if (options.includes(clean)) {
      setNewOption('');
      return;
    }
    setOptions((prev) => [...prev, clean]);
    setNewOption('');
  };
  const removeOption = (label: string) => {
    setOptions((prev) => prev.filter((o) => o !== label));
  };
  const resetToDefaultOptions = () => setOptions(DEFAULT_OPTIONS.slice());

  const goFromFilters = () => {
    if (!name.trim()) return;
    setStep('question'); // go to the new question step next
    setShowSuggest(false);
    Keyboard.dismiss();
  };

  const goFromQuestion = () => {
    // if user disabled collection OR wrote a non-empty question, proceed
    if (!collectResponses || questionText.trim().length > 0) {
      setStep('dates');
    }
  };

  const toggleDate = (iso: string) => {
    setSelectedDates((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso]));
  };

  const onSave = async () => {
    const studentIds = matched.map((s, i) => getStudentId(s, i));
    const reminders = studentIds.map((id) => ({ contactId: id, dates: selectedDates.slice().sort() }));

    // Allow saving optional survey metadata
    type SavedCampaign = Campaign & {
      survey?: { question: string; options: string[] };
    };

    const base: SavedCampaign = {
      id: `${Date.now()}`,
      name: name.trim() || `Campaign ${new Date().toLocaleDateString()}`,
      createdAt: Date.now(),
      filters,
      studentIds,
      reminders,
    };

    const now = Date.now();
    const campaign: SavedCampaign = collectResponses
      ? {
          ...base,
          survey: {
            question: questionText.trim(),
            options: options.map((o) => o.trim()).filter(Boolean),
            createdAt: now,
            updatedAt: now,
            active: true,
          },
        }
      : base; 

    // Cast to Campaign for the existing saver; extra fields persist if your storage is schemaless
    await saveCampaign(campaign as Campaign);
    onSaved?.(campaign as Campaign);
  };

  // Filter suggestions for the current "field" based on "value" term
  const suggestions = useMemo(() => {
    const pool = valuesByField.get(field) ?? [];
    const term = value.trim().toLowerCase();
    if (!term) return pool.slice(0, 50);
    return pool.filter((v) => v.toLowerCase().includes(term)).slice(0, 50);
  }, [valuesByField, field, value]);

  const onValueFocus = () => {
    valueAnchorRef.current?.measureInWindow((_x, _y, w) => {
      if (w && w > 0) setSuggestWidth(w);
    });
    setShowSuggest(true);
  };
  const onValueBlur = () => {
    setTimeout(() => setShowSuggest(false), 120);
  };

  const onAnchorLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w) setSuggestWidth(w);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d12' }}>
      {step === 'filters' ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Create Campaign</Text>

          <Text style={styles.label}>Campaign name</Text>
          <TextInput
            placeholder="Fall Outreach Week 1"
            placeholderTextColor="#93a0b8"
            value={name}
            onChangeText={setName}
            style={styles.input}
            returnKeyType="next"
          />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Filters</Text>

            <View style={[styles.row, { marginBottom: 10 }]}>
              <Dropdown
                label="Field"
                value={field}
                options={fields as string[]}
                onChange={(f) => {
                  setField(f);
                  setShowSuggest(false);
                }}
                style={{ flex: 1.4 }}
              />
              <Dropdown
                label="Operator"
                value={op}
                options={OPERATORS}
                onChange={(v) => setOp(v as Operator)}
                style={{ width: 140 }}
              />
            </View>

            {/* Value input with anchored Suggestions */}
            <View ref={valueAnchorRef} onLayout={onAnchorLayout} style={{ position: 'relative' }}>
              <View style={[styles.row, { marginBottom: 8 }]}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="value"
                  placeholderTextColor="#93a0b8"
                  value={value}
                  onChangeText={(t) => {
                    setValue(t);
                    if (!showSuggest) setShowSuggest(true);
                  }}
                  onFocus={onValueFocus}
                  onBlur={onValueBlur}
                  returnKeyType="done"
                  onSubmitEditing={addCondition}
                />
                <TouchableOpacity
                  style={[styles.btn, styles.ghostBtn, { marginLeft: 8 }]}
                  onPress={addCondition}
                >
                  <Text style={styles.ghostBtnText}>Add</Text>
                </TouchableOpacity>
              </View>

              {/* Suggestions overlay */}
              <Suggestions
                visible={showSuggest}
                items={suggestions}
                onChoose={(v) => {
                  setValue(v);
                  setShowSuggest(false);
                }}
                anchorWidth={suggestWidth}
              />
            </View>

            {/* Existing conditions */}
            <View style={styles.chipsWrap}>
              {filters.map((f, i) => (
                <View key={`${f.field}-${i}`} style={styles.chip}>
                  <Text style={styles.chipText}>
                    <Text style={{ fontWeight: '800' }}>{f.field}</Text> {f.op}{' '}
                    <Text style={{ fontStyle: 'italic' }}>{f.value}</Text>
                  </Text>
                  <TouchableOpacity onPress={() => removeCondition(i)}>
                    <Text style={styles.chipRemove}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            <View style={styles.statusCompact}>
              <Text style={styles.statusText}>
                {matched.length} match{matched.length === 1 ? '' : 'es'}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.btn,
                styles.primaryBtn,
                { marginTop: 8, alignSelf: 'flex-start', opacity: name.trim() ? 1 : 0.6 },
              ]}
              onPress={goFromFilters}
              disabled={!name.trim()}
            >
              <Text style={styles.primaryBtnText}>Next: Optional call question</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : step === 'question' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
          <Text style={styles.title}>Create Campaign</Text>
          <Text style={[styles.sectionTitle, { marginTop: 4 }]}>Optional: Add a call question</Text>
          <Text style={{ color: '#9fb4de', marginBottom: 10 }}>
            Collect lightweight call outcomes (e.g., “Yes / No / Maybe”). You can skip this if you
            don’t need to capture responses.
          </Text>

          {/* Toggle collect/skip */}
          <View style={[styles.row, { marginBottom: 10 }]}>
            <TouchableOpacity
              onPress={() => setCollectResponses(true)}
              style={[styles.togglePill, collectResponses && styles.togglePillOn]}
              activeOpacity={0.85}
            >
              <Text style={[styles.togglePillText, collectResponses && styles.togglePillTextOn]}>Collect responses</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setCollectResponses(false)}
              style={[styles.togglePill, !collectResponses && styles.togglePillOn]}
              activeOpacity={0.85}
            >
              <Text style={[styles.togglePillText, !collectResponses && styles.togglePillTextOn]}>Skip</Text>
            </TouchableOpacity>
          </View>

          {/* Question + options (disabled UI if skipping) */}
          <Text style={[styles.label, { opacity: collectResponses ? 1 : 0.5 }]}>Question to ask</Text>
          <TextInput
            editable={collectResponses}
            placeholder='e.g., "Are you attending the event?"'
            placeholderTextColor="#93a0b8"
            value={questionText}
            onChangeText={setQuestionText}
            style={[styles.input, !collectResponses && { opacity: 0.5 }]}
          />

          <Text style={[styles.sectionTitle, { marginTop: 6, opacity: collectResponses ? 1 : 0.5 }]}>
            Answer options
          </Text>
          <View style={[styles.chipsWrap, !collectResponses && { opacity: 0.5 }]}>
            {options.map((opt) => (
              <View key={opt} style={styles.optChip}>
                <Text style={styles.optChipText}>{opt}</Text>
                {collectResponses ? (
                  <TouchableOpacity onPress={() => removeOption(opt)} hitSlop={10}>
                    <Text style={styles.optChipX}>×</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </View>

          {collectResponses ? (
            <View style={[styles.row, { marginTop: 8 }]}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Add another option (e.g., 'Left voicemail')"
                placeholderTextColor="#93a0b8"
                value={newOption}
                onChangeText={setNewOption}
                onSubmitEditing={addOption}
                returnKeyType="done"
              />
              <TouchableOpacity style={[styles.btn, styles.ghostBtn]} onPress={addOption}>
                <Text style={styles.ghostBtnText}>Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.ghostBtn]}
                onPress={resetToDefaultOptions}
              >
                <Text style={styles.ghostBtnText}>Reset</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.btn,
              styles.primaryBtn,
              {
                marginTop: 14,
                opacity: collectResponses ? (questionText.trim() ? 1 : 0.6) : 1,
              },
            ]}
            onPress={goFromQuestion}
            disabled={collectResponses && !questionText.trim()}
          >
            <Text style={styles.primaryBtnText}>Next: Select reminder dates</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.ghostBtn, { marginTop: 10 }]}
            onPress={() => setStep('filters')}
          >
            <Text style={styles.ghostBtnText}>Back to filters</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          <Text style={styles.title}>Create Campaign</Text>
          <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Select call reminder dates</Text>

          <MiniCalendar onToggleDate={toggleDate} selected={selectedDates} />

          <View style={styles.selectedDates}>
            {selectedDates.sort().map((d) => (
              <View key={d} style={styles.datePill}>
                <Text style={styles.datePillText}>{d}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.primaryBtn, { marginTop: 12, opacity: selectedDates.length ? 1 : 0.6 }]}
            onPress={onSave}
            disabled={!selectedDates.length}
          >
            <Text style={styles.primaryBtnText}>Save Campaign</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.ghostBtn, { marginTop: 10 }]} onPress={() => setStep('question')}>
            <Text style={styles.ghostBtnText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

/** Tiny month-view calendar (multi-date selection) */
function MiniCalendar({
  months = 2,
  onToggleDate,
  selected,
}: {
  months?: number;
  onToggleDate: (iso: string) => void;
  selected: string[];
}) {
  const today = new Date();
  const monthBlocks = useMemo(() => {
    const blocks: { title: string; days: Date[] }[] = [];
    for (let m = 0; m < months; m++) {
      const d0 = new Date(today.getFullYear(), today.getMonth() + m, 1);
      const month = d0.getMonth();
      const days: Date[] = [];
      const padStart = (d0.getDay() + 6) % 7; // Mon=0
      for (let i = 0; i < padStart; i++) days.push(new Date(NaN));
      const iter = new Date(d0);
      while (iter.getMonth() === month) {
        days.push(new Date(iter));
        iter.setDate(iter.getDate() + 1);
      }
      const title = d0.toLocaleString(undefined, { month: 'long', year: 'numeric' });
      blocks.push({ title, days });
    }
    return blocks;
  }, [months]);

  return (
    <View>
      {monthBlocks.map((blk, idx) => (
        <View key={idx} style={styles.calBlock}>
          <Text style={styles.calTitle}>{blk.title}</Text>
          <View style={styles.calHeader}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <Text key={d} style={styles.calHeadCell}>
                {d}
              </Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {blk.days.map((d, i) => {
              if (isNaN(d.getTime())) {
                return <View key={i} style={styles.calCell} />;
              }
              const iso = toISODate(d);
              const isSel = selected.includes(iso);
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.calCell, isSel && styles.calCellSel]}
                  onPress={() => onToggleDate(iso)}
                >
                  <Text style={[styles.calCellText, isSel && styles.calCellTextSel]}>{d.getDate()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------- styles ------------------------------- */
const styles = StyleSheet.create({
  title: { color: '#e9eefb', fontSize: 22, fontWeight: '800', marginBottom: 12 },
  label: { color: '#cfe3ff', marginBottom: 6 },
  input: {
    backgroundColor: '#0b1222',
    color: '#eaf2ff',
    borderWidth: 1,
    borderColor: '#26324a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },

  section: { marginTop: 6, paddingTop: 6 },
  sectionTitle: { color: '#dfe7fb', fontSize: 16, fontWeight: '800', marginBottom: 8 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  /* Dropdown */
  dropdownLabel: { color: '#9fb4de', marginBottom: 6, fontSize: 12 },
  dropdownField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b1222',
    borderWidth: 1,
    borderColor: '#26324a',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  dropdownValue: { color: '#eaf2ff', fontWeight: '700', flex: 1 },
  dropdownChevron: { color: '#9fb4de', fontSize: 16, marginLeft: 8 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { padding: 12 },
  modalCard: {
    backgroundColor: '#111521',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#22325a',
    padding: 12,
    maxHeight: Platform.select({ ios: 440, default: 480 }),
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { color: '#eaf2ff', fontWeight: '800', fontSize: 16 },
  modalClose: { color: '#9fb4de', fontWeight: '800' },
  optionRow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#1c2741',
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionText: { color: '#eaf2ff', fontSize: 16, flex: 1 },
  optionTick: { color: '#36c48f', fontWeight: '900' },

  btn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 },
  primaryBtn: { backgroundColor: '#36c48f' },
  primaryBtnText: { color: '#08371f', fontWeight: '900' },
  ghostBtn: { borderWidth: 1, borderColor: '#22325a', backgroundColor: '#111521' },
  ghostBtnText: { color: '#cfe3ff', fontWeight: '800' },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#213158',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { color: '#dbe6ff' },
  chipRemove: { color: '#dbe6ff', fontWeight: '900', marginLeft: 4 },

  statusCompact: {
    marginTop: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#1c2741',
    borderRadius: 10,
    backgroundColor: '#0b1222',
  },
  statusText: { color: '#b9f4d7', fontWeight: '800' },

  /* Suggestions */
  suggestWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 52,
    zIndex: 50,
  },
  suggestCard: {
    backgroundColor: '#0b1222',
    borderWidth: 1,
    borderColor: '#243253',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  suggestItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#172442',
  },
  suggestText: { color: '#eaf2ff' },
  suggestEmpty: { padding: 12, alignItems: 'center' },
  suggestEmptyText: { color: '#9fb4de' },

  /* Calendar */
  calBlock: { marginTop: 10, backgroundColor: '#0b1222', borderWidth: 1, borderColor: '#1c2741', borderRadius: 12, padding: 10 },
  calTitle: { color: '#eaf2ff', fontWeight: '800', marginBottom: 8 },
  calHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  calHeadCell: { color: '#9fb4de', width: 36, textAlign: 'center', fontSize: 12 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    margin: 2,
    backgroundColor: '#111521',
    borderWidth: 1,
    borderColor: '#1c2741',
  },
  calCellSel: { backgroundColor: '#36c48f' },
  calCellText: { color: '#cfe3ff', fontWeight: '800' },
  calCellTextSel: { color: '#08371f' },

  selectedDates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 8 },
  datePill: { borderWidth: 1, borderColor: '#213158', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#111521' },
  datePillText: { color: '#dbe6ff' },

  /* New: question step pills */
  togglePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22325a',
    backgroundColor: '#111521',
  },
  togglePillOn: {
    backgroundColor: '#36c48f',
    borderColor: '#36c48f',
  },
  togglePillText: { color: '#cfe3ff', fontWeight: '800' },
  togglePillTextOn: { color: '#08371f', fontWeight: '900' },

  optChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#213158',
    backgroundColor: '#111521',
  },
  optChipText: { color: '#eaf2ff', fontWeight: '800' },
  optChipX: { color: '#eaf2ff', fontWeight: '900', marginLeft: 2 },
});
