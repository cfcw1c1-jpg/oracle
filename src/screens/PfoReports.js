import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabase';

// Complete master tracking matrix columns list synced with full definitions data
const TRAINING_COLUMNS = [
  // Evangelism Tracks
  { id: 'ET_1-1. The Great Commission', label: 'ET 1: The Great Commission', group: 'Evangelism Tracks' },
  { id: 'ET_2-2. Evangelization in CFC', label: 'ET 2: Evangelization in CFC', group: 'Evangelism Tracks' },
  
  // CLP Training Tracks
  { id: 'CLPT_1-1. Evangelism and Spiritual Warfare', label: 'CLPT 1: Evangelism & Spiritual Warfare', group: 'CLP Training Tracks' },
  { id: 'CLPT_2-2. What is a CLP?', label: 'CLPT 2: What is a CLP?', group: 'CLP Training Tracks' },
  { id: 'CLPT_3-3. How To Handle a Discussion Group', label: 'CLPT 3: How To Handle a Discussion Group', group: 'CLP Training Tracks' },
  
  // Tongues Workshop
  { id: 'TW_1-1. The Gift of Tongues', label: 'TW 1: The Gift of Tongues', group: 'Tongues Workshop' },
  
  // Covenant Orientation Tracks
  { id: 'CO_1-1. Our Covenant in CFC', label: 'CO 1: Our Covenant in CFC', group: 'Covenant Orientation Tracks' },
  { id: 'CO_2-2. Prayer and Scripture', label: 'CO 2: Prayer and Scripture', group: 'Covenant Orientation Tracks' },
  { id: 'CO_3-3. Strengthening Family Life', label: 'CO 3: Strengthening Family Life', group: 'Covenant Orientation Tracks' },
  { id: 'CO_4-4. Our Christian Culture in CFC', label: 'CO 4: Our Christian Culture in CFC', group: 'Covenant Orientation Tracks' },
  
  // Marriage Enrichment Retreat 1
  { id: 'MER 1_1-1. Serving God Through Christian Marriage', label: 'MER1 1: Serving God', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_2-2. The Christian Couple as a Pastoral Team', label: 'MER1 2: Couple Pastoral Team', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_3-3. The Role of a Christian Husband', label: 'MER1 3: Christian Husband', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_4-4. The Role of a Christian Wife', label: 'MER1 4: Christian Wife', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_5-5. Effective Communication in Marriage', label: 'MER1 5: Communication', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_6-6. Healing Our Marriages', label: 'MER1 6: Healing Marriages', group: 'Marriage Enrichment Retreat 1' },
  { id: 'MER 1_7-7. Building Our Homes for God', label: 'MER1 7: Building Homes for God', group: 'Marriage Enrichment Retreat 1' },
  
  // Financial Stewardship
  { id: 'FS_1-1. Taking Responsibility for God’s Work through our Fina', label: 'FS 1: Financial Stewardship', group: 'Financial Stewardship' },
  
  // Foundations for Christian Living
  { id: 'FCL_1-FCL1: Sons and Daughters of God', label: 'FCL 1: Sons & Daughters of God', group: 'Foundations for Christian Living' },
  { id: 'FCL_2-FCL2: Brothers and Sisters in the Lord', label: 'FCL 2: Brothers & Sisters', group: 'Foundations for Christian Living' },
  { id: 'FCL_3-FCL3: Growing in Faith', label: 'FCL 3: Growing in Faith', group: 'Foundations for Christian Living' },
  { id: 'FCL_4-FCL4: Knowing God’s Will', label: 'FCL 4: Knowing God’s Will', group: 'Foundations for Christian Living' },
  { id: 'FCL_5-FCL5: Overcoming the World', label: 'FCL 5: Overcoming the World', group: 'Foundations for Christian Living' },
  { id: 'FCL_6-FCL6: Overcoming the Flesh', label: 'FCL 6: Overcoming the Flesh', group: 'Foundations for Christian Living' },
  { id: 'FCL_7-FCL7: Overcoming the Work of Evil Spirits', label: 'FCL 7: Overcoming Evil Spirits', group: 'Foundations for Christian Living' },
  { id: 'FCL_8-FCL8: Repairing Wrongdoing', label: 'FCL 8: Repairing Wrongdoing', group: 'Foundations for Christian Living' },
  { id: 'FCL_9-FCL9: The Christian and Money', label: 'FCL 9: The Christian and Money', group: 'Foundations for Christian Living' },
  { id: 'FCL_10-FCL10: Headship and Submission', label: 'FCL 10: Headship & Submission', group: 'Foundations for Christian Living' },
  { id: 'FCL_11-FCL11: Faithfulness and Order', label: 'FCL 11: Faithfulness & Order', group: 'Foundations for Christian Living' },
  { id: 'FCL_12-FCL12: Unity in Christ', label: 'FCL 12: Unity in Christ', group: 'Foundations for Christian Living' },

  // Spiritual Gifts Seminar
  { id: 'SG_1-1. What are Spiritual Gifts?', label: 'SG 1: What are Spiritual Gifts?', group: 'Spiritual Gifts Seminar' },
  { id: 'SG_2-2. Gift of Healing', label: 'SG 2: Gift of Healing', group: 'Spiritual Gifts Seminar' },
  { id: 'SG_3-3. Gift of Prophecy', label: 'SG 3: Gift of Prophecy', group: 'Spiritual Gifts Seminar' },
  { id: 'SG_4-4. Gift of Praise and Tongues', label: 'SG 4: Gift of Praise & Tongues', group: 'Spiritual Gifts Seminar' },
  
  // Marriage Enrichment Retreat 2
  { id: 'MER 2_1-1. What Makes A Christian Marriage Work', label: 'MER2 1: What Makes Marriage Work', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_2-2. Unity in Marriage', label: 'MER2 2: Unity in Marriage', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_3-3. Communication', label: 'MER2 3: Communication', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_4-4. Sex in Marriage', label: 'MER2 4: Sex in Marriage', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_5-5. Christian Parenting', label: 'MER2 5: Christian Parenting', group: 'Marriage Enrichment Retreat 2' },
  { id: 'MER 2_6-6. Empowering Our Marriage', label: 'MER2 6: Empowering Our Marriage', group: 'Marriage Enrichment Retreat 2' },

  // Mission With The Poor
  { id: 'MWPR_1-MWPR1:Sharing for the Common Good', label: 'MWPR 1: Sharing for the Common Good', group: 'Mission with the Poor' },
  { id: 'MWPR_2-MWPR2:Caring for The person in need', label: 'MWPR 2: Caring for the Person in Need', group: 'Mission with the Poor' },
  { id: 'MWPR_3-MWPR3:Church of the Poor', label: 'MWPR 3: Church of the Poor', group: 'Mission with the Poor' },
  { id: 'MWPR_4-MWPR4:Future Full of Hope', label: 'MWPR 4: Future Full of Hope', group: 'Mission with the Poor' },

  // Christian Personal Relationships
  { id: 'CPR_1-CPR1: Learning to Love One Another', label: 'CPR 1: Learning to Love', group: 'Christian Personal Relationships' },
  { id: 'CPR_2-CPR2: Honor and Respect', label: 'CPR 2: Honor & Respect', group: 'Christian Personal Relationships' },
  { id: 'CPR_3-CPR3: Taming the Tongue', label: 'CPR 3: Taming the Tongue', group: 'Christian Personal Relationships' },
  { id: 'CPR_4-CPR4: Correction', label: 'CPR 4: Correction', group: 'Christian Personal Relationships' },
  { id: 'CPR_5-CPR5: Working Out Difficulties in CFC', label: 'CPR 5: Working Out Difficulties', group: 'Christian Personal Relationships' },
  { id: 'CPR_6-CPR6: Relating with People Outside CFC', label: 'CPR 6: Relating with People Outside', group: 'Christian Personal Relationships' },
  
  // Healing Workshop
  { id: 'HW_1-1. Receiving the Gift of Healing', label: 'HW 1: Gift of Healing', group: 'Healing Workshop' },
  
  // Christian Maturity/Emotions Tiers
  { id: 'CHE_1-CHE1: Emotions in our Christian Life', label: 'CHE 1: Emotions in Christian Life', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_2-CHE2: Christian Love and Human Desire', label: 'CHE 2: Love & Human Desire', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_3-CHE3: True and False Humility', label: 'CHE 3: True & False Humility', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_4-CHE4: Guilt and Repentance', label: 'CHE 4: Guilt & Repentance', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_5-CHE5: Righteous and Unrighteous Anger', label: 'CHE 5: Righteous & Unrighteous Anger', group: 'Christian Maturity / Emotions' },
  { id: 'CHE_6-CHE6: Fear', label: 'CHE 6: Fear', group: 'Christian Maturity / Emotions' },
  
  // Living as a People of God
  { id: 'LPG_1-LPG1: Our Basic Commitment', label: 'LPG 1: Our Basic Commitment', group: 'Living as a People of God' },
  { id: 'LPG_2-LPG2: Functioning as a Body', label: 'LPG 2: Functioning as a Body', group: 'Living as a People of God' },
  { id: 'LPG_3-LPG3: Governance and Personal Direction', label: 'LPG 3: Governance & Direction', group: 'Living as a People of God' },
  { id: 'LPG_4-LPG4: Peace and Discipline', label: 'LPG 4: Peace & Discipline', group: 'Living as a People of God' },
  { id: 'LPG_5-LPG5: Unity and Disagreement', label: 'LPG 5: Unity & Disagreement', group: 'Living as a People of God' },
  { id: 'LPG_6-LPG6: Our Personal Responsibility', label: 'LPG 6: Personal Responsibility', group: 'Living as a People of God' },
  
  // Fruit of the Spirit Tracks
  { id: 'FOS_1-FOS1: The Image of God', label: 'FOS 1: The Image of God', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_2-FOS2: Love and Discipline', label: 'FOS 2: Love & Discipline', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_3-FOS3: Meekness and Aggressiveness', label: 'FOS 3: Meekness & Aggressiveness', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_4-FOS4: Joy and Sorrow', label: 'FOS 4: Joy & Sorrow', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_5-FOS5: Faithfulness and Self-Control', label: 'FOS 5: Faithfulness & Self-Control', group: 'Fruit of the Spirit Tracks' },
  { id: 'FOS_6-FOS6: Patience and Perseverance', label: 'FOS 6: Patience & Perseverance', group: 'Fruit of the Spirit Tracks' },
  
  // Household Leaders Training
  { id: 'HLT_1-HLT1: Being a Servant', label: 'HLT 1: Being a Servant', group: 'Household Leaders Training' },
  { id: 'HLT_2-HLT2: The Household: Purpose| Dynamic and Leadership', label: 'HLT 2: Purpose & Dynamics', group: 'Household Leaders Training' },
  { id: 'HLT_3-HLT3: Being Leaders of Households', label: 'HLT 3: Leaders of Households', group: 'Household Leaders Training' },
  { id: 'HLT_4-HLT4: Building a Relationship with your Members', label: 'HLT 4: Rels with Members', group: 'Household Leaders Training' },
  { id: 'HLT_5-HLT5: Zeal for Righteousness', label: 'HLT 5: Zeal for Righteousness', group: 'Household Leaders Training' },
  { id: 'HLT_6-HLT6: Good Example', label: 'HLT- 6: Good Example', group: 'Household Leaders Training' },
  { id: 'HLT_7-HLT7: Single-mindedness for God', label: 'HLT 7: Single-Mindedness', group: 'Household Leaders Training' },
  { id: 'HLT_8-HLT8: Brotherly Love', label: 'HLT 8: Brotherly Love', group: 'Household Leaders Training' },
  { id: 'HLT_9-HLT9: Evangelistic Headship', label: 'HLT 9: Evangelistic Headship', group: 'Household Leaders Training' },
  { id: 'HLT_10-HLT10: The Ministry of Encouragement', label: 'HLT 10: Encouragement', group: 'Household Leaders Training' },
  { id: 'HLT_11-HLT11: Correction - A Pastoral Tool', label: 'HLT 11: Correction Tool', group: 'Household Leaders Training' },
  { id: 'HLT_12-HLT12: The Power To Intercede', label: 'HLT 12: Power To Intercede', group: 'Household Leaders Training' },
  { id: 'HLT_13-HLT13: Prayer', label: 'HLT 13: Prayer', group: 'Household Leaders Training' },
  { id: 'HLT_14-HLT14: Faith In God', label: 'HLT 14: Faith In God', group: 'Household Leaders Training' },
  { id: 'HLT_15-HLT15: Humble Leadership', label: 'HLT 15: Humble Leadership', group: 'Household Leaders Training' },
  { id: 'HLT_16-HLT16: Evaluation', label: 'HLT 16: Evaluation', group: 'Household Leaders Training' },
  
  // Unit Leaders Training
  { id: 'ULT_1-ULT1: The Unit Head As Pastoral Leader', label: 'ULT 1: Unit Head Leader', group: 'Unit Leaders Training' },
  { id: 'ULT_2-ULT2: Shepherds After God’s Own Heart', label: 'ULT 2: Shepherds after God', group: 'Unit Leaders Training' },
  { id: 'ULT_3-ULT3: Being a Burden or a Blessing', label: 'ULT 3: Burden or Blessing', group: 'Unit Leaders Training' },
  { id: 'ULT_4-ULT4: The Prayer of Power', label: 'ULT 4: Prayer of Power', group: 'Unit Leaders Training' },
  { id: 'ULT_5-ULT5: Call To Discipleship', label: 'ULT 5: Call To Discipleship', group: 'Unit Leaders Training' },
  { id: 'ULT_6-ULT6: Total Surrender To God', label: 'ULT 6: Total Surrender', group: 'Unit Leaders Training' },
  { id: 'ULT_7-ULT7: Fit For The Fight', label: 'ULT 7: Fit For The Fight', group: 'Unit Leaders Training' },
  { id: 'ULT_8-ULT8: Earthly and Heavenly Treasure', label: 'ULT 8: Treasures', group: 'Unit Leaders Training' },
  { id: 'ULT_9-ULT9: On Fire or Burned Out?', label: 'ULT 9: On Fire or Burned Out', group: 'Unit Leaders Training' },
  { id: 'ULT_10-ULT10: Problems as Gateway to Mature Leadership', label: 'ULT 10: Gateway to Leadership', group: 'Unit Leaders Training' },
  { id: 'ULT_11-ULT11: Unity Among Brethren', label: 'ULT 11: Unity Among Brethren', group: 'Unit Leaders Training' },
  { id: 'ULT_12-ULT12: Kingdom Relationship', label: 'ULT 12: Kingdom Relationship', group: 'Unit Leaders Training' },
  
  // Chapter Leaders Training
  { id: 'CLT_1-CLT1: Orientation', label: 'CLT 1: Orientation', group: 'Chapter Leaders Training' },
  { id: 'CLT_2-CLT2: The Role of Elders in CFC', label: 'CLT 2: Role of Elders', group: 'Chapter Leaders Training' },
  { id: 'CLT_3-CLT3: The Elder As A Shepherd', label: 'CLT 3: Elder As Shepherd', group: 'Chapter Leaders Training' },
  { id: 'CLT_4-CLT4: Our Multi-faceted Identity', label: 'CLT 4: Multi-Faceted Identity', group: 'Chapter Leaders Training' },
  { id: 'CLT_5-CLT5: The Humility of a Christian Leader', label: 'CLT 5: Humility of Leader', group: 'Chapter Leaders Training' },
  { id: 'CLT_6-CLT6: The Character of an Elder', label: 'CLT 6: Character of Elder', group: 'Chapter Leaders Training' },
  { id: 'CLT_7-CLT7: Maturity of Character', label: 'CLT 7: Maturity of Character', group: 'Chapter Leaders Training' },
  { id: 'CLT_8-CLT8: Perseverance', label: 'CLT 8: Perseverance', group: 'Chapter Leaders Training' },
  { id: 'CLT_9-CLT9: The Deceitful Bow - Dangers in Pastoral Life', label: 'CLT 9: Deceitful Bow Dangers', group: 'Chapter Leaders Training' },
  
  // Mission Core Retreats
  { id: 'MCR_1-God`s Plan for CFC', label: 'MCR 1: God’s Plan for CFC', group: 'Mission Core Retreats' },
  { id: 'MCR_2-Discipleship – God’s call for CFC', label: 'MCR 2: Discipleship Call', group: 'Mission Core Retreats' },
  { id: 'MCR_3-Personal Loyalty', label: 'MCR 3: Personal Loyalty', group: 'Mission Core Retreats' },
  { id: 'MCR_4-Leaving All For God', label: 'MCR 4: Leaving All For God', group: 'Mission Core Retreats' },
  { id: 'MCR_5-Giving All To God', label: 'MCR 5: Giving All To God', group: 'Mission Core Retreats' },
  { id: 'MCR_6-The CFC Mission Core – Mission and Commitment', label: 'MCR 6: Mission & Commitment', group: 'Mission Core Retreats' },
  
  // Speakers Training Workshops
  { id: 'STW_1-1. Communication and Public Speaking', label: 'STW 1: Communication & Speaking', group: 'Speakers Training Workshops' },
  { id: 'STW_2-2. Practicing and Delivering the Talk', label: 'STW 2: Delivering the Talk', group: 'Speakers Training Workshops' },
  
  // ABBA Father Series
  { id: 'ABBA_1-Talk 1: God`s Plan for Fathers', label: 'ABBA 1: God’s Plan for Fathers', group: 'ABBA Father Series' },
  { id: 'ABBA_2-Talk 2: A Father;s Response', label: 'ABBA 2: A Father’s Response', group: 'ABBA Father Series' },
  { id: 'ABBA_3-Talk 3: Redeeming Love', label: 'ABBA 3: Redeeming Love', group: 'ABBA Father Series' },
  { id: 'ABBA_4-Talk 4: How do I Love Thee', label: 'ABBA 4: How do I Love Thee', group: 'ABBA Father Series' },
  
  // Structural Status
  { id: 'SMB_1-', label: 'SMB 1', group: 'Structural Status' },
  { id: 'UM_1-', label: 'UM 1', group: 'Structural Status' }
];

const getCleanTrackCode = (rawId) => {
  const segment = rawId.split('-')[0];
  return segment.replace('_', '.').replace(/\s+/g, '');
};

export default function PfoTrainingReports() {
  const [selectedTrainings, setSelectedTrainings] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [assignedAreaNames, setAssignedAreaNames] = useState([]);
  const [areaFilter, setAreaFilter] = useState('All');
  const [areaDropdownOpen, setAreaDropdownOpen] = useState(false);

  useEffect(() => {
    generateReport();
  }, [selectedTrainings]);

  useEffect(() => {
    loadAssignedAreas();
  }, []);

  // Areas explicitly assigned to the signed-in account (Portal Users ->
  // Areas) -- same convention as the Directory/PFO Trainings Area filters.
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

  const handleToggleTraining = (item) => {
    // Guards removed so any item (including the first chosen item) can be unchecked smoothly
    if (selectedTrainings.some((t) => t.id === item.id)) {
      setSelectedTrainings(selectedTrainings.filter((t) => t.id !== item.id));
    } else {
      setSelectedTrainings([...selectedTrainings, item]);
    }
  };

  // Operates on whatever the search box currently narrows the list down to
  // (all tracks when the search is empty) -- same convention as the
  // Directory's "select all" checkbox, which only ever acts on the filtered
  // rows visible at the time.
  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredTrainingColumns.map((t) => t.id));
      setSelectedTrainings(selectedTrainings.filter((t) => !filteredIds.has(t.id)));
    } else {
      const selectedIds = new Set(selectedTrainings.map((t) => t.id));
      const toAdd = filteredTrainingColumns.filter((t) => !selectedIds.has(t.id));
      setSelectedTrainings([...selectedTrainings, ...toAdd]);
    }
  };

  async function generateReport() {
    if (selectedTrainings.length === 0) {
      setReportData([]);
      return;
    }
    try {
      setLoading(true);

      const selectionColumns = selectedTrainings.map(t => `"${t.id}"`).join(', ');
      const { data, error } = await supabase
        .from('pfo_members')
        .select(`MemberIDNo, ${selectionColumns}, members (Firstname, Lastname, AreaName)`);

      if (error) throw error;

      const processedData = (data || []).map(item => {
        const attendedCount = selectedTrainings.filter(t => {
          const val = item[t.id];
          return val === 'Y' || val === 'y';
        }).length;
        return {
          ...item,
          attendedCount,
          attendedAll: attendedCount === selectedTrainings.length
        };
      });

      const sortedReport = processedData.sort((a, b) => {
        const nameA = (a.members?.Lastname || '').toLowerCase();
        const nameB = (b.members?.Lastname || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      setReportData(sortedReport);
    } catch (err) {
      console.error('Error compiling multi-matrix report data:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredTrainingColumns = useMemo(() => {
    const cleanQuery = searchQuery.trim().toLowerCase();
    if (!cleanQuery) return TRAINING_COLUMNS;

    return TRAINING_COLUMNS.filter((item) => {
      const labelMatch = item.label?.toLowerCase().includes(cleanQuery);
      const groupMatch = item.group?.toLowerCase().includes(cleanQuery);
      return labelMatch || groupMatch;
    });
  }, [searchQuery]);

  const allFilteredSelected = filteredTrainingColumns.length > 0
    && filteredTrainingColumns.every((item) => selectedTrainings.some((t) => t.id === item.id));

  const areaOptions = useMemo(() => {
    if (assignedAreaNames.length > 0) {
      return ['All', ...Array.from(new Set(assignedAreaNames)).sort()];
    }
    const values = new Set(reportData.map((row) => (row.members?.AreaName || 'No Area').trim()));
    return ['All', ...Array.from(values).sort()];
  }, [reportData, assignedAreaNames]);

  // Prefix match (same convention used across the app) so an Area named
  // "West 1C2" also covers AreaName variants like "West 1C2B"/"West 1C2D".
  const filteredReportData = useMemo(() => {
    if (areaFilter === 'All') return reportData;
    return reportData.filter((row) => {
      const memberAreaName = (row.members?.AreaName || '').trim();
      return areaFilter === 'No Area' ? !memberAreaName : memberAreaName.toLowerCase().startsWith(areaFilter.toLowerCase());
    });
  }, [reportData, areaFilter]);

  // Shared by every export format so filenames never drift out of sync.
  function makeFileTimestamp(now) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  }

  // Builds the exact same matrix content used by both the TXT and PDF exports,
  // so the two formats never drift out of sync with each other.
  function buildReportContent() {
    const matrixRegistry = filteredReportData;

    const now = new Date();
    const fileTimestamp = makeFileTimestamp(now);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const displayTimestamp = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    let textContent = `=======================================================================\n`;
    textContent += `                     PFO TRAINING MATRIX ACCREDITATION\n`;
    textContent += `=======================================================================\n`;
    textContent += `COMPILED DATE:     ${displayTimestamp} ${hours}:${minutes}:${seconds}\n`;
    textContent += `TOTAL DATA COUNT:  ${matrixRegistry.length} Registered Row Entries\n`;
    textContent += `STATUS KEY:        Y = Attended Already | N = Not Yet Attended\n`;
    textContent += `-----------------------------------------------------------------------\n`;
    textContent += `MANDATED TRACK FILTER TARGETS CHECKED:\n`;

    selectedTrainings.forEach((t) => {
      textContent += `  [${getCleanTrackCode(t.id)}]: — ${t.label}\n`;
    });

    textContent += `-----------------------------------------------------------------------\n\n`;

    let tableHeaderStr = `   #   | MEMBER NAME                              | ID NUMBER   | STATUS BREAKDOWN\n`;
    let dividerLine    = `-------|------------------------------------------|-------------|------------------\n`;
    textContent += tableHeaderStr + dividerLine;

    matrixRegistry.forEach((item, index) => {
      const num = String(index + 1).padEnd(4, ' ');
      const name = `${item.members?.Lastname || ''}, ${item.members?.Firstname || ''}`;
      const paddedName = name.padEnd(40, ' ').substring(0, 40);
      const idNo = (item.MemberIDNo || 'N/A').padEnd(11, ' ');

      const attendedTracks = [];
      const notAttendedTracks = [];

      selectedTrainings.forEach((t) => {
        const recordVal = item[t.id];
        const code = getCleanTrackCode(t.id);
        if (recordVal === 'Y' || recordVal === 'y') {
          attendedTracks.push(code);
        } else {
          notAttendedTracks.push(code);
        }
      });

      let trackBreakdown = '';
      if (attendedTracks.length > 0) {
        trackBreakdown += `Attended: ${attendedTracks.join(', ')}`;
      }

      if (notAttendedTracks.length > 0) {
        const notAttendedStr = notAttendedTracks.length === selectedTrainings.length ? 'All' : notAttendedTracks.join(', ');
        trackBreakdown += trackBreakdown ? ` | Not Attended: ${notAttendedStr}` : `Not Attended: ${notAttendedStr}`;
      }

      textContent += ` ${num} | ${paddedName} | ${idNo} | ${trackBreakdown}\n`;
    });

    textContent += `\n-----------------------------------------------------------------------\n`;
    textContent += `End of Matrix Document — Securely compiled via PFO Portal Engine.\n`;

    return { textContent, fileTimestamp };
  }

  async function handleExportTxt() {
    if (selectedTrainings.length === 0) {
      Alert.alert('No Filters Selected', 'Please select at least one training column filter target before running extraction.');
      return;
    }
    if (filteredReportData.length === 0) {
      Alert.alert('Empty Dataset', 'There are no member records available to process.');
      return;
    }
    try {
      setLoading(true);

      const { textContent, fileTimestamp } = buildReportContent();
      const safeFileName = `cfc-pfo-report-${fileTimestamp}.txt`;

      if (Platform.OS === 'web') {
        const element = document.createElement("a");
        const file = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
        element.href = URL.createObjectURL(file);
        element.download = safeFileName;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        return;
      }

      const file = new File(Paths.document, safeFileName);
      file.create({ overwrite: true });
      file.write(textContent);

      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/plain',
        dialogTitle: `Export Matrix Registry`
      });

    } catch (err) {
      Alert.alert('Export Failed', 'An error occurred while compiling your matrix text file.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // One column per selected track (Y/N) instead of the TXT export's combined
  // "Attended: ... | Not Attended: ..." string -- easier to filter/pivot in Excel.
  function buildReportRows() {
    const header = ['#', 'Member Name', 'Member ID', 'Area', ...selectedTrainings.map((t) => getCleanTrackCode(t.id)), 'Overall Status'];

    const rows = filteredReportData.map((item, index) => {
      const name = `${item.members?.Lastname || ''}, ${item.members?.Firstname || ''}`;
      const trackCells = selectedTrainings.map((t) => {
        const val = item[t.id];
        return val === 'Y' || val === 'y' ? 'Y' : 'N';
      });
      return [index + 1, name, item.MemberIDNo || 'N/A', item.members?.AreaName || '', ...trackCells, item.attendedAll ? 'Attended' : 'Missing'];
    });

    return [header, ...rows];
  }

  async function handleExportXlsx() {
    if (selectedTrainings.length === 0) {
      Alert.alert('No Filters Selected', 'Please select at least one training column filter target before running extraction.');
      return;
    }
    if (filteredReportData.length === 0) {
      Alert.alert('Empty Dataset', 'There are no member records available to process.');
      return;
    }
    try {
      setLoading(true);

      const safeFileName = `cfc-pfo-report-${makeFileTimestamp(new Date())}.xlsx`;
      const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      const worksheet = XLSX.utils.aoa_to_sheet(buildReportRows());
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'PFO Report');
      const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

      if (Platform.OS === 'web') {
        const byteChars = atob(base64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
        const byteArray = new Uint8Array(byteNumbers);

        const element = document.createElement('a');
        const file = new Blob([byteArray], { type: mimeType });
        element.href = URL.createObjectURL(file);
        element.download = safeFileName;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        return;
      }

      const file = new File(Paths.document, safeFileName);
      file.create({ overwrite: true });
      file.write(base64, { encoding: 'base64' });

      await Sharing.shareAsync(file.uri, {
        mimeType,
        dialogTitle: `Export Matrix Registry`
      });

    } catch (err) {
      Alert.alert('Export Failed', 'An error occurred while compiling your matrix spreadsheet file.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const renderReportItem = ({ item, index }) => {
    const fullName = item.members 
      ? `${item.members.Lastname}, ${item.members.Firstname}` 
      : `ID: ${item.MemberIDNo}`;

    return (
      <View style={[styles.reportRow, index % 2 === 1 && styles.rowAlternate]}>
        <View style={styles.numberCell}><Text style={styles.numberText}>{index + 1}</Text></View>
        <View style={styles.nameCell}><Text style={styles.nameText} numberOfLines={1}>{fullName}</Text></View>
        <View style={styles.idCell}><Text style={styles.idText}>{item.MemberIDNo}</Text></View>
        <View style={styles.tagCell}>
          <View style={[styles.statusTag, item.attendedAll ? styles.tagAttended : styles.tagMissing]}>
            <Text style={[styles.statusTagText, item.attendedAll ? styles.tagTextAttended : styles.tagTextMissing]}>
              {item.attendedAll ? 'Attended' : 'Missing'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // Passed = attended every selected track. Failed = attended none of them.
  // Mixed = attended some but not all -- a partial record that's neither a
  // clean pass nor a clean fail, worth calling out on its own.
  const { passedCount, failedCount, mixedCount } = useMemo(() => {
    let passed = 0, failed = 0, mixed = 0;
    filteredReportData.forEach((item) => {
      if (item.attendedCount === 0) failed++;
      else if (item.attendedAll) passed++;
      else mixed++;
    });
    return { passedCount: passed, failedCount: failed, mixedCount: mixed };
  }, [filteredReportData]);

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <View style={styles.titleRow}>
          <Ionicons name="trending-up-outline" size={22} color="#0f172a" style={styles.titleIcon} />
          <Text style={styles.title}>PFO Training Reports</Text>
        </View>
        <Text style={styles.subtitle}>Filter multiple milestone validation tracks synchronously.</Text>
      </View>

      <View style={styles.filtersRow}>
      <View style={styles.dropdownWrapper}>
        <Text style={styles.fieldLabel}>Selected Filter Targets ({selectedTrainings.length}):</Text>
        <TouchableOpacity
          style={styles.dropdownHeader}
          activeOpacity={0.8}
          onPress={() => setDropdownOpen(!dropdownOpen)}
        >
          <Text style={styles.dropdownHeaderText} numberOfLines={1}>
            {selectedTrainings.length > 0 ? selectedTrainings.map(t => t.label).join(', ') : 'None selected'}
          </Text>
          <Ionicons name={dropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#64748b" />
        </TouchableOpacity>

        {dropdownOpen && (
          <View style={styles.dropdownMenuContainer}>
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={15} color="#94a3b8" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search and toggle multiple tracks..."
                placeholderTextColor="#94a3b8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>

            <TouchableOpacity style={styles.selectAllRow} onPress={handleToggleSelectAll}>
              <Ionicons
                name={allFilteredSelected ? 'checkbox' : 'square-outline'}
                size={16}
                color={allFilteredSelected ? '#2563eb' : '#94a3b8'}
                style={styles.checkboxIcon}
              />
              <Text style={styles.selectAllText}>
                {allFilteredSelected ? 'Deselect All' : 'Select All'} ({filteredTrainingColumns.length})
              </Text>
            </TouchableOpacity>

            <FlatList
              data={filteredTrainingColumns}
              keyExtractor={(item) => item.id}
              nestedScrollEnabled={true}
              style={styles.dropdownMenuList}
              initialNumToRender={15}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = selectedTrainings.some(t => t.id === item.id);
                return (
                  <TouchableOpacity
                    style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                    onPress={() => handleToggleTraining(item)}
                  >
                    <View style={styles.checkboxContainer}>
                      <Ionicons
                        name={isSelected ? 'checkbox' : 'square-outline'}
                        size={16}
                        color={isSelected ? '#2563eb' : '#94a3b8'}
                        style={styles.checkboxIcon}
                      />
                      <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </View>
                    <Text style={styles.dropdownItemGroupText}>{item.group}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.dropdownEmptyText}>No training tracks match your entry.</Text>
              }
            />

            <TouchableOpacity
              style={styles.closeDropdownButton}
              onPress={() => setDropdownOpen(false)}
            >
              <Text style={styles.closeDropdownButtonText}>Apply Selected Filters</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.areaDropdownWrapper}>
        <Text style={styles.fieldLabel}>Area:</Text>
        <TouchableOpacity
          style={styles.dropdownHeader}
          activeOpacity={0.8}
          onPress={() => setAreaDropdownOpen((v) => !v)}
        >
          <Text style={styles.dropdownHeaderText} numberOfLines={1}>{areaFilter}</Text>
          <Ionicons name={areaDropdownOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#64748b" />
        </TouchableOpacity>

        {areaDropdownOpen && (
          <View style={styles.dropdownMenuContainer}>
            <FlatList
              data={areaOptions}
              keyExtractor={(item) => item}
              nestedScrollEnabled
              style={styles.dropdownMenuList}
              renderItem={({ item }) => {
                const isSelected = item === areaFilter;
                return (
                  <TouchableOpacity
                    style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
                    onPress={() => { setAreaFilter(item); setAreaDropdownOpen(false); }}
                  >
                    <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextActive]} numberOfLines={1}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
      </View>
      </View>

      <View style={styles.actionRowContainer}>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, styles.statCardPassed]}>
            <View style={[styles.statIconChip, styles.statIconChipPassed]}>
              <Ionicons name="checkmark-circle-outline" size={22} color="#16a34a" />
            </View>
            <View>
              <Text style={styles.statValue}>{loading ? '...' : passedCount}</Text>
              <Text style={styles.statLabel}>Passed Matches</Text>
            </View>
          </View>

          <View style={[styles.statCard, styles.statCardFailed]}>
            <View style={[styles.statIconChip, styles.statIconChipFailed]}>
              <Ionicons name="close-circle-outline" size={22} color="#dc2626" />
            </View>
            <View>
              <Text style={styles.statValue}>{loading ? '...' : failedCount}</Text>
              <Text style={styles.statLabel}>Failed Matches</Text>
            </View>
          </View>

          <View style={[styles.statCard, styles.statCardMixed]}>
            <View style={[styles.statIconChip, styles.statIconChipMixed]}>
              <Ionicons name="shuffle-outline" size={22} color="#b45309" />
            </View>
            <View>
              <Text style={styles.statValue}>{loading ? '...' : mixedCount}</Text>
              <Text style={styles.statLabel}>Mixed Matches</Text>
            </View>
          </View>
        </View>

        <View style={styles.buttonsContainer}>
          <TouchableOpacity
            style={[styles.actionButton, styles.completedButton]}
            activeOpacity={0.7}
            onPress={handleExportTxt}
            disabled={loading}
          >
            <Ionicons name="document-text-outline" size={14} color="#ffffff" style={styles.actionButtonIcon} />
            <Text style={styles.actionButtonText}>Export as TXT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.xlsxButton]}
            activeOpacity={0.7}
            onPress={handleExportXlsx}
            disabled={loading}
          >
            <Ionicons name="grid-outline" size={14} color="#ffffff" style={styles.actionButtonIcon} />
            <Text style={styles.actionButtonText}>Export as XLSX</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.reportCard}>
        <View style={styles.tableHeader}>
          <View style={styles.numberCellHeader}><Text style={styles.headerText}>#</Text></View>
          <View style={styles.nameCellHeader}><Text style={styles.headerText}>Member Name</Text></View>
          <View style={styles.idCellHeader}><Text style={styles.headerText}>ID Number</Text></View>
          <View style={styles.tagCellHeader}><Text style={styles.headerText}>Status</Text></View>
        </View>

        {loading ? (
          <View style={styles.centeredLoader}>
            <ActivityIndicator size="large" color="#002060" />
            <Text style={styles.loaderText}>Cross-matching dynamic criteria matrices...</Text>
          </View>
        ) : (
          <FlatList
            data={filteredReportData}
            renderItem={renderReportItem}
            keyExtractor={(item) => item.MemberIDNo?.toString()}
            removeClippedSubviews={Platform.OS === 'android'}
            maxToRenderPerBatch={25}
            windowSize={5}
            initialNumToRender={30}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No matching membership targets found.</Text>
              </View>
            }
          />
        )}
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
  // zIndex on the individual dropdowns below only orders them against each
  // other -- it doesn't let them float above actionRowContainer/reportCard,
  // which are this row's siblings, not its children. This wrapper needs its
  // own zIndex so the whole row (and whichever dropdown is open inside it)
  // paints above the cards/table that follow it.
  filtersRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, marginBottom: 14, zIndex: 10 },
  dropdownWrapper: { zIndex: 10, flex: 2, minWidth: 260 },
  areaDropdownWrapper: { zIndex: 9, flex: 1, minWidth: 180, maxWidth: 280 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, textTransform: 'uppercase' },
  dropdownHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0',
    paddingHorizontal: 14, paddingVertical: 12, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1
  },
  dropdownHeaderText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  dropdownMenuContainer: {
    position: 'absolute', top: 66, left: 0, right: 0, backgroundColor: '#ffffff',
    borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
    zIndex: 100, paddingBottom: 4
  },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f8fafc', margin: 8, borderRadius: 8, paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4, borderWidth: 1, borderColor: '#e2e8f0'
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 13, color: '#1e293b', fontWeight: '500' },
  dropdownEmptyText: { textAlign: 'center', color: '#94a3b8', paddingVertical: 20, fontSize: 13 },
  dropdownMenuList: { maxHeight: 220 },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  dropdownItemActive: { backgroundColor: '#eff6ff' },
  selectAllRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#f8fafc',
  },
  selectAllText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  checkboxContainer: { flexDirection: 'row', alignItems: 'center' },
  checkboxIcon: { marginRight: 8 },
  dropdownItemText: { fontSize: 13, fontWeight: '500', color: '#334155' },
  dropdownItemTextActive: { color: '#2563eb', fontWeight: '700' },
  dropdownItemGroupText: { fontSize: 9, color: '#94a3b8', marginTop: 2, textTransform: 'uppercase', fontWeight: '700', paddingLeft: 22 },
  closeDropdownButton: { backgroundColor: '#002060', margin: 8, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  closeDropdownButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  actionRowContainer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, flex: 1 },
  statCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1, minWidth: 180,
    backgroundColor: '#ffffff', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 18,
    borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  statCardPassed: { borderColor: '#bbf7d0' },
  statCardFailed: { borderColor: '#fecaca' },
  statCardMixed: { borderColor: '#fde68a' },
  statIconChip: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  statIconChipPassed: { backgroundColor: '#dcfce7' },
  statIconChipFailed: { backgroundColor: '#fee2e2' },
  statIconChipMixed: { backgroundColor: '#fef3c7' },
  statValue: { fontSize: 26, fontWeight: '800', color: '#0f172a' },
  statLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  buttonsContainer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  actionButton: { flexDirection: 'row', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
  completedButton: { backgroundColor: '#002060' },
  xlsxButton: { backgroundColor: '#15803d' },
  actionButtonIcon: { marginRight: 6 },
  actionButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  reportCard: { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f8fafc', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingHorizontal: 12 },
  headerText: { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
  reportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 12 },
  rowAlternate: { backgroundColor: '#f8fafc' },
  numberCellHeader: { width: 30 },
  numberCell: { width: 30 },
  numberText: { fontSize: 12, color: '#94a3b8', fontWeight: '500' },
  nameCellHeader: { flex: 1 },
  nameCell: { flex: 1 },
  nameText: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  idCellHeader: { width: 90 },
  idCell: { width: 90 },
  idText: { fontSize: 12, color: '#475569', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  tagCellHeader: { width: 80, alignItems: 'flex-end' },
  tagCell: { width: 80, alignItems: 'flex-end' },
  statusTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagAttended: { backgroundColor: '#dcfce7' },
  tagMissing: { backgroundColor: '#fee2e2' },
  statusTagText: { fontSize: 11, fontWeight: '700' },
  tagTextAttended: { color: '#15803d' },
  tagTextMissing: { color: '#b91c1c' },
  centeredLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loaderText: { marginTop: 10, fontSize: 13, color: '#64748b', fontWeight: '500' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#94a3b8', fontSize: 13, fontWeight: '500' }
}); 