import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View
} from 'react-native';
import { supabase } from '../../lib/supabase';

// Structured columns grouped by their respective categories
export const TRAINING_COLUMNS = [
  // Evangelism Tracks
  { id: 'ET_1-1. The Great Commission', label: 'ET 1', group: 'Evangelism Tracks' },
  { id: 'ET_2-2. Evangelization in CFC', label: 'ET 2', group: 'Evangelism Tracks' },
  
  // CLP Training Tracks
  { id: 'CLPT_1-1. Evangelism and Spiritual Warfare', label: 'CLPT 1', group: 'CLP Training Tracks' },
  { id: 'CLPT_2-2. What is a CLP?', label: 'CLPT 2', group: 'CLP Training Tracks' },
  { id: 'CLPT_3-3. How To Handle a Discussion Group', label: 'CLPT 3', group: 'CLP Training Tracks' },
  
  // Tongues Workshop
  { id: 'TW_1-1. The Gift of Tongues', label: 'TW 1', group: 'Tongues Workshop' },
  
  // Covenant Orientation Tracks
  { id: 'CO_1-1. Our Covenant in CFC', label: 'CO 1', group: 'Covenant Orientation Tracks' },
  { id: 'CO_2-2. Prayer and Scripture', label: 'CO 2', group: 'Covenant Orientation Tracks' },
  { id: 'CO_3-3. Strengthening Family Life', label: 'CO 3', group: 'Covenant Orientation Tracks' },
  { id: 'CO_4-4. Our Christian Culture in CFC', label: 'CO 4', group: 'Covenant Orientation Tracks' },
  
  // Marriage Enrichment Retreat 1
  { id: 'MER 1_1-1. Serving God Through Christian Marriage', label: 'MER1 1', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_2-2. The Christian Couple as a Pastoral Team', label: 'MER1 2', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_3-3. The Role of a Christian Husband', label: 'MER1 3', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_4-4. The Role of a Christian Wife', label: 'MER1 4', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_5-5. Effective Communication in Marriage', label: 'MER1 5', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_6-6. Healing Our Marriages', label: 'MER1 6', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_7-7. Building Our Homes for God', label: 'MER1 7', group: 'Marriage Enrichment Retreat 1' },
  
  // Financial Stewardship
  { id: 'FS_1-1. Taking Responsibility for God’s Work through our Fina', label: 'FS 1', group: 'Financial Stewardship' },
  
  // Foundations for Christian Living
  { id: 'FCL_1-FCL1: Sons and Daughters of God', label: 'FCL 1', group: 'Foundations for Christian Living' },
  { id: 'FCL_2-FCL2: Brothers and Sisters in the Lord', label: 'FCL 2', group: 'Foundations for Christian Living' },
  { id: 'FCL_3-FCL3: Growing in Faith', label: 'FCL 3', group: 'Foundations for Christian Living' },
  { id: 'FCL_4-FCL4: Knowing God’s Will', label: 'FCL 4', group: 'Foundations for Christian Living' },
  { id: 'FCL_5-FCL5: Overcoming the World', label: 'FCL 5', group: 'Foundations for Christian Living' },
  { id: 'FCL_6-FCL6: Overcoming the Flesh', label: 'FCL 6', group: 'Foundations for Christian Living' },
  { id: 'FCL_7-FCL7: Overcoming the Work of Evil Spirits', label: 'FCL 7', group: 'Foundations for Christian Living' },
  { id: 'FCL_8-FCL8: Repairing Wrongdoing', label: 'FCL 8', group: 'Foundations for Christian Living' },
  { id: 'FCL_9-FCL9: The Christian and Money', label: 'FCL 9', group: 'Foundations for Christian Living' },
  { id: 'FCL_10-FCL10: Headship and Submission', label: 'FCL 10', group: 'Foundations for Christian Living' },
  { id: 'FCL_11-FCL11: Faithfulness and Order', label: 'FCL 11', group: 'Foundations for Christian Living' },
  { id: 'FCL_12-FCL12: Unity in Christ', label: 'FCL 12', group: 'Foundations for Christian Living' },
  
  // Spiritual Gifts Seminar
  { id: 'SG_1-1. What are Spiritual Gifts?', label: 'SG 1', group: 'Spiritual Gifts Seminar' },
  { id: 'SG_2-2. Gift of Healing', label: 'SG 2', group: 'Spiritual Gifts Seminar' },
  { id: 'SG_3-3. Gift of Prophecy', label: 'SG 3', group: 'Spiritual Gifts Seminar' },
  { id: 'SG_4-4. Gift of Praise and Tongues', label: 'SG 4', group: 'Spiritual Gifts Seminar' },
  
  // Marriage Enrichment Retreat 2
  { id: 'MER 2_1-1. What Makes A Christian Marriage Work', label: 'MER2 1', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_2-2. Unity in Marriage', label: 'MER2 2', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_3-3. Communication', label: 'MER2 3', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_4-4. Sex in Marriage', label: 'MER2 4', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_5-5. Christian Parenting', label: 'MER2 5', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_6-6. Empowering Our Marriage', label: 'MER2 6', group: 'Marriage Enrichment Retreat 2' },

  // Mission With The Poor
  { id: 'MWPR_1-MWPR1:Sharing for the Common Good', label: 'MWPR 1', group: 'Mission with the Poor' },
  { id: 'MWPR_2-MWPR2:Caring for The person in need', label: 'MWPR 2', group: 'Mission with the Poor' },
  { id: 'MWPR_3-MWPR3:Church of the Poor', label: 'MWPR 3', group: 'Mission with the Poor' },
  { id: 'MWPR_4-MWPR4:Future Full of Hope', label: 'MWPR 4', group: 'Mission with the Poor' },

  // Christian Personal Relationships
  { id: 'CPR_1-CPR1: Learning to Love One Another', label: 'CPR 1', group: 'Christian Personal Relationships' },
  { id: 'CPR_2-CPR2: Honor and Respect', label: 'CPR 2', group: 'Christian Personal Relationships' },
  { id: 'CPR_3-CPR3: Taming the Tongue', label: 'CPR 3', group: 'Christian Personal Relationships' },
  { id: 'CPR_4-CPR4: Correction', label: 'CPR 4', group: 'Christian Personal Relationships' },
  { id: 'CPR_5-CPR5: Working Out Difficulties in CFC', label: 'CPR 5', group: 'Christian Personal Relationships' },
  { id: 'CPR_6-CPR6: Relating with People Outside CFC', label: 'CPR 6', group: 'Christian Personal Relationships' },
  
  // Healing Workshop
  { id: 'HW_1-1. Receiving the Gift of Healing', label: 'HW 1', group: 'Healing Workshop' },
  
  // Christian Maturity/Emotions Tiers
  { id: 'CHE_1-CHE1: Emotions in our Christian Life', label: 'CHE 1', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_2-CHE2: Christian Love and Human Desire', label: 'CHE 2', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_3-CHE3: True and False Humility', label: 'CHE 3', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_4-CHE4: Guilt and Repentance', label: 'CHE 4', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_5-CHE5: Righteous and Unrighteous Anger', label: 'CHE 5', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_6-CHE6: Fear', label: 'CHE 6', group: 'Christian Maturity / Emotions' },
  
  // Living as a People of God
  { id: 'LPG_1-LPG1: Our Basic Commitment', label: 'LPG 1', group: 'Living as a People of God' },
  { id: 'LPG_2-LPG2: Functioning as a Body', label: 'LPG 2', group: 'Living as a People of God' },
  { id: 'LPG_3-LPG3: Governance and Personal Direction', label: 'LPG 3', group: 'Living as a People of God' },
  { id: 'LPG_4-LPG4: Peace and Discipline', label: 'LPG 4', group: 'Living as a People of God' },
  { id: 'LPG_5-LPG5: Unity and Disagreement', label: 'LPG 5', group: 'Living as a People of God' },
  { id: 'LPG_6-LPG6: Our Personal Responsibility', label: 'LPG 6', group: 'Living as a People of God' },
  
  // Fruit of the Spirit Tracks
  { id: 'FOS_1-FOS1: The Image of God', label: 'FOS 1', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_2-FOS2: Love and Discipline', label: 'FOS 2', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_3-FOS3: Meekness and Aggressiveness', label: 'FOS 3', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_4-FOS4: Joy and Sorrow', label: 'FOS 4', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_5-FOS5: Faithfulness and Self-Control', label: 'FOS 5', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_6-FOS6: Patience and Perseverance', label: 'FOS 6', group: 'Fruit of the Spirit Tracks' },
  
  // Household Leaders Training
  { id: 'HLT_1-HLT1: Being a Servant', label: 'HLT 1', group: 'Household Leaders Training' },
  { id: 'HLT_2-HLT2: The Household: Purpose| Dynamic and Leadership', label: 'HLT 2', group: 'Household Leaders Training' },
  { id: 'HLT_3-HLT3: Being Leaders of Households', label: 'HLT 3', group: 'Household Leaders Training' },
  { id: 'HLT_4-HLT4: Building a Relationship with your Members', label: 'HLT 4', group: 'Household Leaders Training' },
  { id: 'HLT_5-HLT5: Zeal for Righteousness', label: 'HLT 5', group: 'Household Leaders Training' },
  { id: 'HLT_6-HLT6: Good Example', label: 'HLT 6', group: 'Household Leaders Training' },
  { id: 'HLT_7-HLT7: Single-mindedness for God', label: 'HLT 7', group: 'Household Leaders Training' },
  { id: 'HLT_8-HLT8: Brotherly Love', label: 'HLT 8', group: 'Household Leaders Training' },
  { id: 'HLT_9-HLT9: Evangelistic Headship', label: 'HLT 9', group: 'Household Leaders Training' },
  { id: 'HLT_10-HLT10: The Ministry of Encouragement', label: 'HLT 10', group: 'Household Leaders Training' },
  { id: 'HLT_11-HLT11: Correction - A Pastoral Tool', label: 'HLT 11', group: 'Household Leaders Training' },
  { id: 'HLT_12-HLT12: The Power To Intercede', label: 'HLT 12', group: 'Household Leaders Training' },
  { id: 'HLT_13-HLT13: Prayer', label: 'HLT 13', group: 'Household Leaders Training' },
  { id: 'HLT_14-HLT14: Faith In God', label: 'HLT 14', group: 'Household Leaders Training' },
  { id: 'HLT_15-HLT15: Humble Leadership', label: 'HLT 15', group: 'Household Leaders Training' },
  { id: 'HLT_16-HLT16: Evaluation', label: 'HLT 16', group: 'Household Leaders Training' },
  
  // Unit Leaders Training
  { id: 'ULT_1-ULT1: The Unit Head As Pastoral Leader', label: 'ULT 1', group: 'Unit Leaders Training' },
  { id: 'ULT_2-ULT2: Shepherds After God’s Own Heart', label: 'ULT 2', group: 'Unit Leaders Training' },
  { id: 'ULT_3-ULT3: Being a Burden or a Blessing', label: 'ULT 3', group: 'Unit Leaders Training' },
  { id: 'ULT_4-ULT4: The Prayer of Power', label: 'ULT 4', group: 'Unit Leaders Training' },
  { id: 'ULT_5-ULT5: Call To Discipleship', label: 'ULT 5', group: 'Unit Leaders Training' },
  { id: 'ULT_6-ULT6: Total Surrender To God', label: 'ULT 6', group: 'Unit Leaders Training' },
  { id: 'ULT_7-ULT7: Fit For The Fight', label: 'ULT 7', group: 'Unit Leaders Training' },
  { id: 'ULT_8-ULT8: Earthly and Heavenly Treasure', label: 'ULT 8', group: 'Unit Leaders Training' },
  { id: 'ULT_9-ULT9: On Fire or Burned Out?', label: 'ULT 9', group: 'Unit Leaders Training' },
  { id: 'ULT_10-ULT10: Problems as Gateway to Mature Leadership', label: 'ULT 10', group: 'Unit Leaders Training' },
  { id: 'ULT_11-ULT11: Unity Among Brethren', label: 'ULT 11', group: 'Unit Leaders Training' },
  { id: 'ULT_12-ULT12: Kingdom Relationship', label: 'ULT 12', group: 'Unit Leaders Training' },
  
  // Chapter Leaders Training
  { id: 'CLT_1-CLT1: Orientation', label: 'CLT 1', group: 'Chapter Leaders Training' },
  { id: 'CLT_2-CLT2: The Role of Elders in CFC', label: 'CLT 2', group: 'Chapter Leaders Training' },
  { id: 'CLT_3-CLT3: The Elder As A Shepherd', label: 'CLT 3', group: 'Chapter Leaders Training' },
  { id: 'CLT_4-CLT4: Our Multi-faceted Identity', label: 'CLT 4', group: 'Chapter Leaders Training' },
  { id: 'CLT_5-CLT5: The Humility of a Christian Leader', label: 'CLT 5', group: 'Chapter Leaders Training' },
  { id: 'CLT_6-CLT6: The Character of an Elder', label: 'CLT 6', group: 'Chapter Leaders Training' },
  { id: 'CLT_7-CLT7: Maturity of Character', label: 'CLT 7', group: 'Chapter Leaders Training' },
  { id: 'CLT_8-CLT8: Perseverance', label: 'CLT 8', group: 'Chapter Leaders Training' },
  { id: 'CLT_9-CLT9: The Deceitful Bow - Dangers in Pastoral Life', label: 'CLT 9', group: 'Chapter Leaders Training' },
  
  // Mission Core Retreats
  { id: 'MCR_1-God`s Plan for CFC', label: 'MCR 1', group: 'Mission Core Retreats' },
  { id: 'MCR_2-Discipleship – God’s call for CFC', label: 'MCR 2', group: 'Mission Core Retreats' },
  { id: 'MCR_3-Personal Loyalty', label: 'MCR 3', group: 'Mission Core Retreats' },
  { id: 'MCR_4-Leaving All For God', label: 'MCR 4', group: 'Mission Core Retreats' },
  { id: 'MCR_5-Giving All To God', label: 'MCR 5', group: 'Mission Core Retreats' },
  { id: 'MCR_6-The CFC Mission Core – Mission and Commitment', label: 'MCR 6', group: 'Mission Core Retreats' },
  
  // Speakers Training Workshops
  { id: 'STW_1-1. Communication and Public Speaking', label: 'STW 1', group: 'Speakers Training Workshops' },
  { id: 'STW_2-2. Practicing and Delivering the Talk', label: 'STW 2', group: 'Speakers Training Workshops' },
  
  // ABBA Father Series
  { id: 'ABBA_1-Talk 1: God`s Plan for Fathers', label: 'ABBA 1', group: 'ABBA Father Series' },
  { id: 'ABBA_2-Talk 2: A Father;s Response', label: 'ABBA 2', group: 'ABBA Father Series' },
  { id: 'ABBA_3-Talk 3: Redeeming Love', label: 'ABBA 3', group: 'ABBA Father Series' },
  { id: 'ABBA_4-Talk 4: How do I Love Thee', label: 'ABBA 4', group: 'ABBA Father Series' },
  
  // Extra Structural Fields
  { id: 'SMB_1-', label: 'SMB 1', group: 'Structural Status' },
  { id: 'UM_1-', label: 'UM 1', group: 'Structural Status' }
];

export const parseTrainingName = (idString) => {
  if (!idString) return '';
  const components = idString.split(/[.:-]/);
  return components.length > 1 ? components[components.length - 1].trim() : idString;
};

const getGroupedHeaders = () => {
  const groups = [];
  let currentGroup = null;
  TRAINING_COLUMNS.forEach((col) => {
    if (!currentGroup || currentGroup.name !== col.group) {
      currentGroup = { name: col.group, count: 1 };
      groups.push(currentGroup);
    } else {
      currentGroup.count += 1;
    }
  });
  return groups;
};

// TRAINING_COLUMNS is static, so this never needs to be recomputed on render.
const GROUPED_HEADERS = getGroupedHeaders();

const MODULE_COLUMN_WIDTH = 110;
const ROW_HEIGHT = 44;
const NAME_COLUMN_WIDTH = 180;
const ID_COLUMN_WIDTH = 120;
// Both header stacks (the fixed Name/ID panel and the scrollable training
// panel) use these same fixed heights so their rows line up exactly.
const GROUP_HEADER_HEIGHT = 34;
const COLUMN_HEADER_HEIGHT = 52;

// Owns its own search text locally so typing here only re-renders this small
// dropdown, not the entire (expensive) matrix table below it.
const MemberFilterDropdown = memo(function MemberFilterDropdown({ members, selectedIds, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const label = useMemo(() => {
    if (selectedIds.size === 0) return 'All members';

    const names = members
      .filter((m) => selectedIds.has(m.MemberIDNo))
      .map((m) => `${m.Firstname} ${m.Lastname}`.trim());

    if (names.length <= 2) return names.join(', ');
    return `${selectedIds.size} members selected`;
  }, [selectedIds, members]);

  const filteredOptions = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return members;

    return members.filter((m) => {
      const first = m.Firstname.toLowerCase();
      const last = m.Lastname.toLowerCase();
      const idStr = m.MemberIDNo?.toString().toLowerCase() || '';
      return first.includes(cleanQuery) || last.includes(cleanQuery) || idStr.includes(cleanQuery);
    });
  }, [query, members]);

  return (
    <View style={styles.memberFilterWrapper}>
      <TouchableOpacity style={styles.memberFilterHeader} activeOpacity={0.8} onPress={() => setOpen((v) => !v)}>
        <Ionicons name="people-outline" size={14} color="#64748b" style={{ marginRight: 6 }} />
        <Text style={styles.memberFilterHeaderText} numberOfLines={1}>{label}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color="#64748b" style={{ marginLeft: 6 }} />
      </TouchableOpacity>

      {open && (
        <View style={[styles.memberFilterMenu, styles.memberFilterMenuRight]}>
          <View style={styles.memberFilterSearchBar}>
            <Ionicons name="search" size={14} color="#94a3b8" style={{ marginRight: 6 }} />
            <TextInput
              style={styles.memberFilterSearchInput}
              placeholder="Search members to filter..."
              placeholderTextColor="#94a3b8"
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
          </View>

          <FlatList
            data={filteredOptions}
            keyExtractor={(m) => m.MemberIDNo?.toString()}
            style={styles.memberFilterList}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: m }) => {
              const isSelected = selectedIds.has(m.MemberIDNo);
              return (
                <TouchableOpacity
                  style={[styles.memberFilterItem, isSelected && styles.memberFilterItemActive]}
                  onPress={() => onToggle(m.MemberIDNo)}
                >
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={16}
                    color={isSelected ? '#002060' : '#94a3b8'}
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.memberFilterItemText} numberOfLines={1}>{m.Lastname}, {m.Firstname}</Text>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={styles.memberFilterEmptyText}>No matching members.</Text>}
          />

          <View style={styles.memberFilterActionsRow}>
            <TouchableOpacity onPress={onClear}>
              <Text style={styles.memberFilterClearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.memberFilterApplyBtn} onPress={() => setOpen(false)}>
              <Text style={styles.memberFilterApplyBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
});

// Single-select Area filter, same visual language as MemberFilterDropdown
// above. Options are narrowed to the signed-in account's assigned areas
// when it has any (see loadAssignedAreas in PfoList) so this always
// matches what area-scoping RLS already limits the roster to.
const AreaFilterDropdown = memo(function AreaFilterDropdown({ options, value, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.memberFilterWrapper}>
      <TouchableOpacity style={styles.memberFilterHeader} activeOpacity={0.8} onPress={() => setOpen((v) => !v)}>
        <Ionicons name="location-outline" size={14} color="#64748b" style={{ marginRight: 6 }} />
        <Text style={styles.memberFilterHeaderText} numberOfLines={1}>Area: {value}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color="#64748b" style={{ marginLeft: 6 }} />
      </TouchableOpacity>

      {open && (
        <View style={styles.memberFilterMenu}>
          <ScrollView style={styles.memberFilterList} nestedScrollEnabled>
            {options.map((option) => {
              const isSelected = option === value;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.memberFilterItem, isSelected && styles.memberFilterItemActive]}
                  onPress={() => { onChange(option); setOpen(false); }}
                >
                  <Text style={[styles.memberFilterItemText, isSelected && styles.memberFilterItemTextActive]} numberOfLines={1}>
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
});

// A single Y/N cell, memoized so toggling one training column for one member
// only re-renders that one cell instead of the whole (150-column-wide) row.
const TrainingCell = memo(function TrainingCell({ memberId, colId, value, onToggle }) {
  const isChecked = value === 'Y' || value === 'y';
  return (
    <TouchableOpacity
      style={styles.moduleColumnWidth}
      onPress={() => onToggle(memberId, colId, value)}
      activeOpacity={0.5}
    >
      <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
        {isChecked && <Ionicons name="checkmark" size={14} color="#ffffff" />}
      </View>
    </TouchableOpacity>
  );
});

// The fixed left panel's row: just Name/ID. Memoized for the same reason as
// RightRow below. ID Number is dropped on narrow screens to save the
// horizontal space it costs on an already horizontally-scrolling matrix.
const LeftRow = memo(function LeftRow({ row, index, showIdColumn }) {
  const fullName = row.members ? `${row.members.Lastname}, ${row.members.Firstname}` : `ID: ${row.MemberIDNo}`;
  const isAlternate = index % 2 === 1;

  return (
    <View style={[styles.tableRow, isAlternate && styles.rowAlternate]}>
      <View style={[styles.cell, styles.nameColumnWidth]}>
        <Text style={styles.nameText} numberOfLines={1}>{fullName}</Text>
      </View>
      {showIdColumn && (
        <View style={[styles.cell, styles.idColumnWidth]}>
          <Text style={styles.idText}>{row.MemberIDNo}</Text>
        </View>
      )}
    </View>
  );
});

// The scrollable right panel's row: every training-column cell. Memoized so
// re-renders triggered elsewhere (typing in a search box, toggling a
// checkbox in a DIFFERENT row) skip every row whose own props haven't
// actually changed instead of rebuilding all ~150 cells.
const RightRow = memo(function RightRow({ row, index, onToggleCheckbox }) {
  const isAlternate = index % 2 === 1;

  return (
    <View style={[styles.tableRow, isAlternate && styles.rowAlternate]}>
      {TRAINING_COLUMNS.map((col) => (
        <TrainingCell
          key={col.id}
          memberId={row.MemberIDNo}
          colId={col.id}
          value={row[col.id]}
          onToggle={onToggleCheckbox}
        />
      ))}
    </View>
  );
});

export default function PfoList() {
  const { width } = useWindowDimensions();
  const isNarrow = width < 768;

  const [matrixData, setMatrixData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [assignedAreaNames, setAssignedAreaNames] = useState([]);
  const [areaFilter, setAreaFilter] = useState('All');

  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());

  useEffect(() => {
    fetchMatrix();
    loadAssignedAreas();
  }, []);

  // Areas explicitly assigned to the signed-in account (Portal Users ->
  // Areas) -- same convention as MembersList.js's Directory Area filter, so
  // this dropdown only ever offers areas the account can actually see.
  async function loadAssignedAreas() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('user_areas')
        .select('areas ( name )')
        .eq('profile_id', user.id);
      if (error) throw error;
      const names = (data || []).map((row) => row.areas?.name).filter(Boolean);
      setAssignedAreaNames(names);
    } catch (err) {
      console.error('Error loading assigned areas:', err.message);
    }
  }

  async function fetchMatrix() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('pfo_members')
        .select('MemberIDNo, *, members (Firstname, Lastname, AreaName)');

      if (error) throw error;

      // Fixed: Alphabetically sort the array rows explicitly by member Lastname 
      const sortedData = (data || []).sort((a, b) => {
        const nameA = (a.members?.Lastname || '').toLowerCase();
        const nameB = (b.members?.Lastname || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      setMatrixData(sortedData);
    } catch (err) {
      console.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  const handleToggleCheckbox = useCallback(async (memberId, courseColumnId, currentValue) => {
    const newValue = (currentValue === 'Y' || currentValue === 'y') ? 'N' : 'Y';

    setMatrixData(prev => prev.map(item =>
      item.MemberIDNo === memberId ? { ...item, [courseColumnId]: newValue } : item
    ));

    try {
      const { error } = await supabase
        .from('pfo_members')
        .update({ [courseColumnId]: newValue })
        .eq('MemberIDNo', memberId);
      if (error) throw error;
    } catch (err) {
      console.error(err.message);
      setMatrixData(prev => prev.map(item =>
        item.MemberIDNo === memberId ? { ...item, [courseColumnId]: currentValue } : item
      ));
    }
  }, []);

  const areaOptions = useMemo(() => {
    if (assignedAreaNames.length > 0) {
      return ['All', ...Array.from(new Set(assignedAreaNames)).sort()];
    }
    const values = new Set(
      matrixData.map((row) => (row.members?.AreaName || 'No Area').trim())
    );
    return ['All', ...Array.from(values).sort()];
  }, [matrixData, assignedAreaNames]);

  const filteredMatrixData = useMemo(() => {
    const cleanQuery = searchQuery.trim().toLowerCase();

    return matrixData.filter((row) => {
      const first = row.members?.Firstname?.toLowerCase() || '';
      const last = row.members?.Lastname?.toLowerCase() || '';
      const idStr = row.MemberIDNo?.toString().toLowerCase() || '';
      const matchesSearch = !cleanQuery || first.includes(cleanQuery) || last.includes(cleanQuery) || idStr.includes(cleanQuery);
      const matchesMemberFilter = selectedMemberIds.size === 0 || selectedMemberIds.has(row.MemberIDNo);
      // Prefix match (same convention as the Directory Area filter and the
      // area-scoping RLS) so an Area named "West 1C2" also covers AreaName
      // variants like "West 1C2B"/"West 1C2D".
      const memberAreaName = (row.members?.AreaName || '').trim();
      const matchesArea = areaFilter === 'All'
        || (areaFilter === 'No Area' ? !memberAreaName : memberAreaName.toLowerCase().startsWith(areaFilter.toLowerCase()));
      return matchesSearch && matchesMemberFilter && matchesArea;
    });
  }, [searchQuery, matrixData, selectedMemberIds, areaFilter]);

  // --- Filter by Members dropdown ---

  const toggleMemberFilter = useCallback((memberId) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }, []);

  const clearMemberFilter = useCallback(() => setSelectedMemberIds(new Set()), []);

  const availableMembersForFilter = useMemo(() => {
    return matrixData.map((row) => ({
      MemberIDNo: row.MemberIDNo,
      Firstname: row.members?.Firstname || '',
      Lastname: row.members?.Lastname || '',
    }));
  }, [matrixData]);

  // The left (Name/ID) list has its own scrolling disabled; it's just kept
  // in lockstep with the right (training columns) list, which is the only
  // one the user actually scrolls vertically.
  const leftListRef = useRef(null);
  const handleRightScroll = useCallback((event) => {
    const y = event.nativeEvent.contentOffset.y;
    leftListRef.current?.scrollToOffset({ offset: y, animated: false });
  }, []);

  const renderLeftRow = useCallback(({ item, index }) => (
    <LeftRow row={item} index={index} showIdColumn={!isNarrow} />
  ), [isNarrow]);

  const renderRightRow = useCallback(({ item, index }) => (
    <RightRow row={item} index={index} onToggleCheckbox={handleToggleCheckbox} />
  ), [handleToggleCheckbox]);

  if (loading) return <ActivityIndicator size="large" color="#002060" style={styles.centered} />;

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <View style={styles.titleRow}>
          <Ionicons name="bar-chart-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>Pastoral Formation Grid Matrix</Text>
        </View>
        <Text style={styles.subtitle}>Manage qualifications and course milestones instantly across the roster.</Text>
      </View>

      <View style={styles.controlsRow}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={16} color="#94a3b8" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name or ID..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        <MemberFilterDropdown
          members={availableMembersForFilter}
          selectedIds={selectedMemberIds}
          onToggle={toggleMemberFilter}
          onClear={clearMemberFilter}
        />

        <AreaFilterDropdown options={areaOptions} value={areaFilter} onChange={setAreaFilter} />
      </View>

      <View style={styles.tableWrapper}>
        <View style={styles.tableSplitRow}>
          {/* Fixed left panel: Name/ID never scroll away, so the member a
              row belongs to is always visible while scrolling through the
              training columns on the right. */}
          <View style={[styles.leftPanel, isNarrow && { width: NAME_COLUMN_WIDTH }]}>
            <View style={styles.leftGroupHeaderSpacer} />
            <View style={styles.leftColumnHeaderRow}>
              <View style={[styles.cellHeader, styles.nameColumnWidth]}>
                <Text style={styles.headerText}>Member Name</Text>
              </View>
              {!isNarrow && (
                <View style={[styles.cellHeader, styles.idColumnWidth]}>
                  <Text style={styles.headerText}>ID Number</Text>
                </View>
              )}
            </View>

            <FlatList
              ref={leftListRef}
              data={filteredMatrixData}
              renderItem={renderLeftRow}
              keyExtractor={(item) => item.MemberIDNo?.toString()}
              getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
            />
          </View>

          {/* Scrollable right panel: every training column. */}
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
            <View>
              <View style={styles.tableRowGroupHeader}>
                {GROUPED_HEADERS.map((group, idx) => (
                  <View
                    key={`${group.name}-${idx}`}
                    style={[styles.groupHeaderCell, { width: group.count * MODULE_COLUMN_WIDTH }, idx % 2 === 1 && styles.groupHeaderCellAlt]}
                  >
                    <Text style={styles.groupHeaderText} numberOfLines={1}>{group.name}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.tableRowHeader}>
                {TRAINING_COLUMNS.map((col) => (
                  <View key={col.id} style={[styles.cellHeader, styles.moduleColumnWidth, styles.columnBorderRight]}>
                    <Text style={styles.headerText} numberOfLines={1}>{col.label}</Text>
                    <Text style={styles.headerSubtitleText} numberOfLines={2}>{parseTrainingName(col.id) || col.label}</Text>
                  </View>
                ))}
              </View>

              <FlatList
                data={filteredMatrixData}
                renderItem={renderRightRow}
                keyExtractor={(item) => item.MemberIDNo?.toString()}
                getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
                onScroll={handleRightScroll}
                scrollEventThrottle={16}
                removeClippedSubviews={Platform.OS === 'android'}
                // Each row renders ~150 training-column cells, far heavier than a
                // typical list item, so batches are kept small to avoid janking
                // the scroll thread with too much synchronous render work at once.
                maxToRenderPerBatch={6}
                updateCellsBatchingPeriod={30}
                windowSize={4}
                initialNumToRender={8}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>No tracking profiles matched your search and filters.</Text>
                  </View>
                }
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16 },
  heroSection: { paddingVertical: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  titleIcon: { marginRight: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  controlsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10, marginBottom: 14, zIndex: 15 },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 5, borderWidth: 1, borderColor: '#e2e8f0',
    maxWidth: 360, flexGrow: 1, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#1e293b', fontWeight: '500' },

  memberFilterWrapper: { position: 'relative' },
  memberFilterHeader: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 9,
    borderWidth: 1, borderColor: '#e2e8f0', maxWidth: 240,
  },
  memberFilterHeaderText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#334155' },
  memberFilterMenu: {
    // Area's own trigger sits alone on its row and lands near the screen's
    // LEFT edge (controlsRow wraps it there once Member's row is full) --
    // left:0 keeps its fixed-width menu growing rightward, safely on-screen.
    position: 'absolute', top: 46, left: 0, width: 280,
    backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1',
    shadowColor: '#0f172a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8,
    elevation: 6, zIndex: 100, paddingBottom: 4,
  },
  // Member's own trigger instead sits paired with the search box on the
  // FIRST row, near the screen's RIGHT edge -- the same fixed-width menu
  // needs to grow leftward from there instead, or it overflows off-screen.
  memberFilterMenuRight: { left: undefined, right: 0 },
  memberFilterSearchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc',
    margin: 8, borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  memberFilterSearchInput: { flex: 1, fontSize: 13, color: '#1e293b' },
  memberFilterList: { maxHeight: 220 },
  memberFilterItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  memberFilterItemActive: { backgroundColor: '#eff6ff' },
  memberFilterItemText: { fontSize: 13, fontWeight: '500', color: '#334155', flex: 1 },
  memberFilterItemTextActive: { color: '#002060', fontWeight: '700' },
  memberFilterEmptyText: { textAlign: 'center', color: '#94a3b8', paddingVertical: 20, fontSize: 13 },
  memberFilterActionsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: 8,
  },
  memberFilterClearText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  memberFilterApplyBtn: { backgroundColor: '#002060', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  memberFilterApplyBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },

  tableWrapper: { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', marginBottom: 20 },
  tableSplitRow: { flex: 1, flexDirection: 'row' },
  leftPanel: {
    width: NAME_COLUMN_WIDTH + ID_COLUMN_WIDTH, borderRightWidth: 2, borderRightColor: '#e2e8f0',
    ...Platform.select({
      web: { boxShadow: '2px 0 4px 0 rgba(15, 23, 42, 0.06)' },
      default: { elevation: 2 },
    }),
  },
  leftGroupHeaderSpacer: { height: GROUP_HEADER_HEIGHT, backgroundColor: '#1e293b', borderBottomWidth: 1, borderColor: '#334155' },
  leftColumnHeaderRow: {
    flexDirection: 'row', height: COLUMN_HEADER_HEIGHT, backgroundColor: '#002060',
    borderBottomWidth: 1, borderColor: '#001540',
  },
  tableRowGroupHeader: { flexDirection: 'row', height: GROUP_HEADER_HEIGHT, backgroundColor: '#1e293b', borderBottomWidth: 1, borderColor: '#334155' },
  groupHeaderCell: { justifyContent: 'center', alignItems: 'center', paddingVertical: 8, borderRightWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a' },
  groupHeaderCellAlt: { backgroundColor: '#1e293b' },
  groupHeaderText: { color: '#94a3b8', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', paddingHorizontal: 4 },
  tableRowHeader: { flexDirection: 'row', height: COLUMN_HEADER_HEIGHT, backgroundColor: '#002060', borderBottomWidth: 1, borderColor: '#001540' },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#f1f5f9', height: ROW_HEIGHT },
  rowAlternate: { backgroundColor: '#f8fafc' },
  nameColumnWidth: { width: NAME_COLUMN_WIDTH, paddingHorizontal: 12 },
  idColumnWidth: { width: ID_COLUMN_WIDTH, paddingHorizontal: 8 },
  moduleColumnWidth: { width: 110, alignItems: 'center', justifyContent: 'center' },
  columnBorderRight: { borderRightWidth: 1, borderRightColor: '#002e8c' },
  cellHeader: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  headerText: { color: '#ffffff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  headerSubtitleText: { color: '#93c5fd', fontSize: 9, fontWeight: '500', textAlign: 'center', marginTop: 3 },
  cell: { justifyContent: 'center' },
  nameText: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  idText: { fontSize: 12, color: '#64748b', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: '#cbd5e1', backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center' },
  checkboxChecked: { backgroundColor: '#22c55e', borderColor: '#16a34a' },
  emptyContainer: { padding: 40, alignItems: 'center', width: 300 },
  emptyText: { color: '#64748b', fontSize: 14, fontWeight: '500' }
});