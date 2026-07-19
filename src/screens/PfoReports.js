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

export default function PfoTrainingReports() {
  const [selectedTraining, setSelectedTraining] = useState(TRAINING_COLUMNS[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    generateReport();
  }, [selectedTraining]);

  async function generateReport() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('pfo_members')
        .select(`MemberIDNo, "${selectedTraining.id}", members (Firstname, Lastname)`);

      if (error) throw error;

      const graduatesOnly = (data || []).filter(item => {
        const val = item[selectedTraining.id];
        return val === 'Y' || val === 'y';
      });

      const sortedReport = graduatesOnly.sort((a, b) => {
        const nameA = (a.members?.Lastname || '').toLowerCase();
        const nameB = (b.members?.Lastname || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      setReportData(sortedReport);
    } catch (err) {
      console.error('Error compiling matrix report data:', err.message);
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

// Generates and extracts a structured plain text (.txt) registry
  async function executeExtractionPipeline(targetType) {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('pfo_members')
        .select(`MemberIDNo, "${selectedTraining.id}", members (Firstname, Lastname)`);

      if (error) throw error;

      const filteredDataset = (data || []).filter(item => {
        const val = item[selectedTraining.id];
        const isCompleted = val === 'Y' || val === 'y';
        return targetType === 'YES' ? isCompleted : !isCompleted;
      });

      if (filteredDataset.length === 0) {
        Alert.alert('Empty Dataset', `There are no member records available matching "${targetType === 'YES' ? 'Completed' : 'Not Yet Attended'}" criteria.`);
        return;
      }

      filteredDataset.sort((a, b) => {
        const nameA = (a.members?.Lastname || '').toLowerCase();
        const nameB = (b.members?.Lastname || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });

      const reportSubTitle = targetType === 'YES' ? 'COMPLETED MILESTONE REGISTRY' : 'NOT YET ATTENDED REGISTRY';
      const timestamp = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // Build structured plain text file layout
      let textContent = `==================================================\n`;
      textContent += `           PFO TRAINING STATUS REPORT\n`;
      textContent += `==================================================\n`;
      textContent += `TRACK:       ${selectedTraining.group}\n`;
      textContent += `MODULE:      ${selectedTraining.label}\n`;
      textContent += `REGISTRY:    ${reportSubTitle}\n`;
      textContent += `DATE:        ${timestamp}\n`;
      textContent += `TOTAL:       ${filteredDataset.length} Records\n`;
      textContent += `--------------------------------------------------\n\n`;
      textContent += `   #   | MEMBER NAME                              | ID NUMBER\n`;
      textContent += `-------|------------------------------------------|-----------\n`;

      filteredDataset.forEach((item, index) => {
        const num = String(index + 1).padEnd(4, ' ');
        const name = `${item.members?.Lastname || ''}, ${item.members?.Firstname || ''}`;
        const paddedName = name.padEnd(40, ' ').substring(0, 40); // Limit length to keep table structured
        const idNo = item.MemberIDNo || 'N/A';
        
        textContent += ` ${num} | ${paddedName} | ${idNo}\n`;
      });

      textContent += `\n--------------------------------------------------\n`;
      textContent += `End of Report — Securely compiled via PFO Portal Engine.\n`;

      const safeFileName = `${selectedTraining.id.split('.')[0].replace(/\s+/g, '_')}_${targetType}.txt`;

      // --- WEB DOWNLOAD IMPLEMENTATION ---
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

      // --- MOBILE DOWNLOAD IMPLEMENTATION (iOS / Android) ---
      const { FileSystem } = require('expo-file-system');
      const fileUri = `${FileSystem.documentDirectory}${safeFileName}`;
      
      await FileSystem.writeAsStringAsync(fileUri, textContent, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(fileUri, { 
        mimeType: 'text/plain', 
        dialogTitle: `Export Text Registry: ${selectedTraining.label}` 
      });

    } catch (err) {
      Alert.alert('Export Failed', 'An error occurred while compiling your plain text registry file.');
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
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <Text style={styles.title}>📈 PFO Training Reports</Text>
        <Text style={styles.subtitle}>Filter, verify and extract profile groups by completed milestone metrics.</Text>
      </View>

      <View style={styles.dropdownWrapper}>
        <Text style={styles.fieldLabel}>Select Target Training Module:</Text>
        <TouchableOpacity 
          style={styles.dropdownHeader} 
          activeOpacity={0.8}
          onPress={() => setDropdownOpen(!dropdownOpen)}
        >
          <Text style={styles.dropdownHeaderText} numberOfLines={1}>
            {selectedTraining.label}
          </Text>
          <Text style={styles.dropdownArrow}>{dropdownOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {dropdownOpen && (
          <View style={styles.dropdownMenuContainer}>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="🔍 Search training tracks..."
                placeholderTextColor="#94a3b8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>

            <FlatList
              data={filteredTrainingColumns}
              keyExtractor={(item) => item.id}
              nestedScrollEnabled={true}
              style={styles.dropdownMenuList}
              initialNumToRender={15}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.dropdownItem, item.id === selectedTraining.id && styles.dropdownItemActive]}
                  onPress={() => {
                    setSelectedTraining(item);
                    setDropdownOpen(false);
                    setSearchQuery('');
                  }}
                >
                  <Text style={[styles.dropdownItemText, item.id === selectedTraining.id && styles.dropdownItemTextActive]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={styles.dropdownItemGroupText}>{item.group}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.dropdownEmptyText}>No training tracks match your entry.</Text>
              }
            />
          </View>
        )}
      </View>

      <View style={styles.actionRowContainer}>
        <View style={styles.kpiSplitCard}>
          <Text style={styles.kpiLabel}>Total Graduates</Text>
          <Text style={styles.kpiValue}>{loading ? '...' : reportData.length}</Text>
        </View>

        <View style={styles.buttonsContainer}>
          <TouchableOpacity 
            style={[styles.actionButton, styles.completedButton]}
            activeOpacity={0.7}
            onPress={() => executeExtractionPipeline('YES')}
            disabled={loading}
          >
            <Text style={styles.actionButtonText}>📄 TXT Copy of Completed Members</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.actionButton, styles.nonCompletedButton]}
            activeOpacity={0.7}
            onPress={() => executeExtractionPipeline('NO')}
            disabled={loading}
          >
            <Text style={styles.actionButtonText}>📄 TXT Copy of Non-Completed Members</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.reportCard}>
        <View style={styles.tableHeader}>
          <View style={styles.numberCellHeader}><Text style={styles.headerText}>#</Text></View>
          <View style={styles.nameCellHeader}><Text style={styles.headerText}>Member Name</Text></View>
          <View style={styles.idCellHeader}><Text style={styles.headerText}>ID Number</Text></View>
        </View>

        {loading ? (
          <View style={styles.centeredLoader}>
            <ActivityIndicator size="large" color="#002060" />
            <Text style={styles.loaderText}>Compiling specialized registry records...</Text>
          </View>
        ) : (
          <FlatList
            data={reportData}
            renderItem={renderReportItem}
            keyExtractor={(item) => item.MemberIDNo?.toString()}
            removeClippedSubviews={Platform.OS === 'android'}
            maxToRenderPerBatch={25}
            windowSize={5}
            initialNumToRender={30}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No matching membership targets have completed this specific deployment milestone track yet.</Text>
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
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 4 },
  dropdownWrapper: { zIndex: 10, marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, textTransform: 'uppercase' },
  dropdownHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#ffffff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0',
    paddingHorizontal: 14, paddingVertical: 12, shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1
  },
  dropdownHeaderText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  dropdownArrow: { fontSize: 12, color: '#64748b', fontWeight: '700' },
  dropdownMenuContainer: {
    position: 'absolute', top: 66, left: 0, right: 0, backgroundColor: '#ffffff',
    borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
    zIndex: 100, paddingBottom: 4
  },
  searchContainer: {
    backgroundColor: '#f8fafc', margin: 8, borderRadius: 8, paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4, borderWidth: 1, borderColor: '#e2e8f0'
  },
  searchInput: { fontSize: 13, color: '#1e293b', fontWeight: '500' },
  dropdownEmptyText: { textAlign: 'center', color: '#94a3b8', paddingVertical: 20, fontSize: 13 },
  dropdownMenuList: { maxHeight: 220 },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  dropdownItemActive: { backgroundColor: '#eff6ff' },
  dropdownItemText: { fontSize: 13, fontWeight: '500', color: '#334155' },
  dropdownItemTextActive: { color: '#2563eb', fontWeight: '700' },
  dropdownItemGroupText: { fontSize: 9, color: '#94a3b8', marginTop: 2, textTransform: 'uppercase', fontWeight: '700' },
  actionRowContainer: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', marginBottom: 14, gap: 10 },
  kpiSplitCard: { flex: 0.35, backgroundColor: '#ffffff', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center' },
  kpiLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase' },
  kpiValue: { fontSize: 22, fontWeight: '800', color: '#002060', marginTop: 2 },
  buttonsContainer: { flex: 0.65, gap: 8, justifyContent: 'space-between' },
  actionButton: { flex: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 },
  completedButton: { backgroundColor: '#002060' },
  nonCompletedButton: { backgroundColor: '#475569' }, 
  actionButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  reportCard: { flex: 1, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', marginBottom: 20 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#002060', paddingVertical: 10, alignItems: 'center' },
  headerText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  reportRow: { flexDirection: 'row', alignItems: 'center', height: 44, borderBottomWidth: 1, borderColor: '#f1f5f9' },
  rowAlternate: { backgroundColor: '#f8fafc' },
  numberCellHeader: { width: 45, paddingLeft: 14 },
  numberCell: { width: 45, paddingLeft: 14 },
  numberText: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  nameCellHeader: { flex: 1, paddingHorizontal: 8 },
  nameCell: { flex: 1, paddingHorizontal: 8 },
  nameText: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  idCellHeader: { width: 110, paddingHorizontal: 8 },
  idCell: { width: 110, paddingHorizontal: 8 },
  idText: { fontSize: 12, color: '#64748b', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  centeredLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  loaderText: { fontSize: 13, color: '#64748b', marginTop: 10, fontWeight: '500' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#64748b', fontSize: 13, fontWeight: '500', textAlign: 'center', lineHeight: 18 }
});