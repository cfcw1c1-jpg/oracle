import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { supabase } from '../../lib/supabase';

export default function PredictorScreen() {
  // Animation states
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(1)).current;

  // Predictor Workflow states
  const [predicting, setPredicting] = useState(false);
  const [roster, setRoster] = useState(null);

  useEffect(() => {
    // Continuous 360-degree rotation animation for the globe
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Soft continuous pulse animation for the background indicator ring
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1.2,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 1.0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [spinValue, pulseValue]);

  // Interpolate rotation values
  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Cross-platform alert fallback
  const showAlert = (title, message) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  // --- OPENAI ENGINE PREDICTION SERVICE VIA FETCH ---
  async function generateNextLeaderPredictions() {
    try {
      setPredicting(true);
      setRoster(null);

      // 1. Fetch participants cross-referenced with parent profiles
      // Using !inner tells Supabase to drop rows where the member details do not exist
      const { data: participants, error } = await supabase
        .from('clp_training_participants')
        .select(`
          MemberIDNo,
          type,
          sub_type,
          clp_training_id,
          members!inner (
            Firstname,
            Lastname,
            PastoralService,
            Gender,
            NameOfHouseholdHead
          ),
          clp_trainings (
            start_date,
            end_date
          )
        `);

      if (error) throw error;

      // 2. Map and filter valid candidates by aggregating past role workloads correctly
      const memberHistoryMap = {};
      
      participants.forEach(p => {
        if (!p.members) return;
        
        // DATABASE EXTRA PROTECTION LAYER:
        // Double-check string value matches to catch any edge cases or alternative casing configurations
        const rawGender = p.members.Gender ? p.members.Gender.trim().toLowerCase() : '';
        if (rawGender === 'female' || rawGender === 'f') {
          return; // Skip and exclude this record completely from the data pool sent to the AI
        }

        const id = p.MemberIDNo;
        const recordDate = p.clp_trainings?.end_date ? String(p.clp_trainings.end_date) : null;
        
        if (!memberHistoryMap[id]) {
          const cleanPastoralRole = p.members.PastoralService ? p.members.PastoralService.trim().toUpperCase() : 'MEMBER';
          
          memberHistoryMap[id] = {
            idNo: id,
            name: `${p.members.Firstname} ${p.members.Lastname}`.trim(),
            pastoralRole: cleanPastoralRole,
            pastRoles: [],
            gender: 'male', // Explicitly typed because females are fully pruned out
            dateGraduated: recordDate || '2026-01-01', 
            nameOfHouseholdHead: p.members.NameOfHouseholdHead ? p.members.NameOfHouseholdHead.trim() : ''
          };
        } else {
          // Keep updating history timeline with oldest real graduation records found
          if (recordDate && (memberHistoryMap[id].dateGraduated === '2026-01-01' || recordDate < memberHistoryMap[id].dateGraduated)) {
            memberHistoryMap[id].dateGraduated = recordDate;
          }
        }

        // Aggregate history items across variations
        if (p.type === 'service_team' && p.sub_type) {
          if (!memberHistoryMap[id].pastRoles.includes(p.sub_type)) {
            memberHistoryMap[id].pastRoles.push(p.sub_type);
          }
        } else if (p.type === 'participant') {
          if (!memberHistoryMap[id].pastRoles.includes('Graduate/Participant')) {
            memberHistoryMap[id].pastRoles.push('Graduate/Participant');
          }
        }
      });

      const candidatesList = Object.values(memberHistoryMap);

      if (candidatesList.length === 0) {
        throw new Error("No qualified historical male candidates found to evaluate.");
      }

      console.log(candidatesList);

      // 3. Make the API call directly via native HTTPS Fetch
      const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an expert church administrative AI assistant predicting leadership configurations for a Catholic Life Program (CLP) batch cycle.
              
              CRITICAL DATA POOL CONFIGURATION: 
              - The candidate data pool provided contains exclusively eligible male records.
              - The "pastoralRole" attribute is strictly capitalized string: 'HH', 'UH', or 'MEMBER'.
              - The current system calendar anchor year is 2026. Evaluate "dateGraduated" timelines relative to 2026.

              Enforce these structural conditions perfectly. Disregarding any qualification rule means the roster output is invalid.

              1. Team Leader:
                 - pastoralRole MUST be exactly 'HH' or 'MEMBER'. Do not select 'UH'.
                 - dateGraduated must be more than 2 years ago (dated 2024 or earlier).
                 - pastRoles MUST NOT contain 'Team Leader'.

              2. Assistant Team Leader:
                 - pastoralRole MUST be exactly 'HH' or 'MEMBER'. Do not select 'UH'.
                 - dateGraduated must be more than 2 years ago (dated 2024 or earlier).
                 - pastRoles MUST NOT contain 'Assistant Team Leader'.

              3. Supervising Unit Head:
                 - pastoralRole MUST be exactly 'UH'.

              4. Prayer Warrior:
                 - pastoralRole MUST be exactly 'HH'.
                 - pastRoles MUST contain 'Prayer Warrior'.

              5. Music Ministry:
                 - pastoralRole MUST be exactly 'HH' or 'UH'.
                 - pastRoles MUST contain 'Music Ministry'.

              6. Team Servant (Servant Head):
                 - pastoralRole MUST be exactly 'HH'.
                 - Cross-Reference Rule: The candidate's "nameOfHouseholdHead" string value MUST match the exact full name text of whichever candidate you assigned to the "supervisingUnitHead" position above.

              7. Facilitators:
                 - Provide an array containing at least 2 candidates.
                 - pastoralRole MUST be exactly 'MEMBER'.
                 - pastoralRole should not be 'CH'.
                 - dateGraduated must be at least 1 year ago (dated 2025 or earlier).

              Universal Strict Constraints:
              - No Duplicate Assignments: A specific unique "idNo" can only appear ONCE across the entire roster response setup.
              - Try to minimize selecting multiple people with the same Lastname if alternatives exist.`
            },
            {
              role: 'user',
              content: `Here is the current pre-filtered male candidate dataset: ${JSON.stringify(candidatesList)}. Formulate the absolute best optimal leadership structural profile.`
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "clp_roster_prediction",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  teamLeader: { type: "object", properties: { idNo: { type: "string" }, name: { type: "string" } }, required: ["idNo", "name"], additionalProperties: false },
                  assistantTeamLeader: { type: "object", properties: { idNo: { type: "string" }, name: { type: "string" } }, required: ["idNo", "name"], additionalProperties: false },
                  supervisingUnitHead: { type: "object", properties: { idNo: { type: "string" }, name: { type: "string" } }, required: ["idNo", "name"], additionalProperties: false },
                  teamServant: { type: "object", properties: { idNo: { type: "string" }, name: { type: "string" } }, required: ["idNo", "name"], additionalProperties: false },
                  prayerWarrior: { type: "object", properties: { idNo: { type: "string" }, name: { type: "string" } }, required: ["idNo", "name"], additionalProperties: false },
                  musicMinistry: { type: "object", properties: { idNo: { type: "string" }, name: { type: "string" } }, required: ["idNo", "name"], additionalProperties: false },
                  facilitators: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { idNo: { type: "string" }, name: { type: "string" } },
                      required: ["idNo", "name"],
                      additionalProperties: false
                    }
                  }
                },
                required: [
                  "teamLeader", "assistantTeamLeader", "supervisingUnitHead", 
                  "teamServant", "prayerWarrior", "musicMinistry", "facilitators"
                ],
                additionalProperties: false
              }
            }
          }
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData?.error?.message || 'Failed connecting to completion server');
      }

      const rawData = await response.json();
      const result = JSON.parse(rawData.choices[0].message.content);
      setRoster(result);
    } catch (err) {
      showAlert('Engine Allocation Fault', err.message);
    } finally {
      setPredicting(false);
    }
  }

  // Row Renderer for generated assignments
  const renderRosterRow = (title, label, candidate) => (
    <View style={styles.rosterRow} key={title + candidate?.idNo}>
      <View style={styles.roleCol}>
        <Text style={styles.roleTitle}>{title}</Text>
        <View style={styles.metaLabel}>
          <Text style={styles.metaLabelText}>{label}</Text>
        </View>
      </View>
      <View style={styles.candidateCol}>
        <Text style={styles.candidateName}>{candidate?.name || 'No Matching Assignment'}</Text>
        {candidate?.idNo && <Text style={styles.candidateId}>ID: {candidate.idNo}</Text>}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent} 
        style={{ width: '100%' }}
        showsVerticalScrollIndicator={false}
      >
        {/* Animated Loading Globe Section */}
        <View style={styles.animationContainer}>
          <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseValue }] }]} />
          <Animated.View style={[styles.globeWrapper, { transform: [{ rotate: spin }] }]}>
            <Ionicons name="globe-outline" size={40} color="#002060" />
          </Animated.View>
        </View>

        {/* Informational Header */}
        <Text style={styles.title}>Christian Life Program - Oracle</Text>
        <Text style={styles.subtitle}>
          Evaluates past historical training datasets against structural roles to project optimized leadership rosters.
        </Text>

        {/* Action Button */}
        <TouchableOpacity 
          style={[styles.actionBtn, predicting && styles.actionBtnDisabled]}
          onPress={generateNextLeaderPredictions}
          disabled={predicting}
        >
          {predicting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="sparkles-outline" size={15} color="#ffffff" style={styles.actionBtnIcon} />
              <Text style={styles.actionBtnText}>Generate Next Batch Roster</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Render Roster Display Output Card */}
        {roster && !predicting && (
          <View style={styles.matrixCard}>
            <View style={styles.matrixHeader}>
              <Text style={styles.matrixHeaderText}>Forecasted Roster Configuration</Text>
            </View>
            
            {renderRosterRow("Team Leader", "Seasoned Core", roster.teamLeader)}
            {renderRosterRow("Assistant Team Leader", "Core Deployable", roster.assistantTeamLeader)}
            {renderRosterRow("Supervising Unit Head", "Required: UH Title", roster.supervisingUnitHead)}
            {renderRosterRow("Team Servant", "Required: HH Title", roster.teamServant)}
            {renderRosterRow("Prayer Warrior", "Required: HH Title", roster.prayerWarrior)}
            {renderRosterRow("Music Ministry", "Talent Track", roster.musicMinistry)}

            <View style={styles.sectionSeparator}>
              <Text style={styles.separatorText}>Assigned Facilitators (Min. 2)</Text>
            </View>

            {roster.facilitators.map((fac, index) => 
              renderRosterRow(`Facilitator Option #${index + 1}`, "Assigned Cohort", fac)
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 30,
  },
  animationContainer: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  pulseRing: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#eff6ff',
    borderWidth: 2,
    borderColor: '#bfdbfe',
    opacity: 0.6,
  },
  globeWrapper: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 40,
    ...Platform.select({
      web: { boxShadow: '0 4px 12px 0 rgb(0 32 96 / 0.15)' },
      default: { elevation: 4, shadowColor: '#002060', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 6 }
    }),
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    maxWidth: 420,
  },
  actionBtn: {
    flexDirection: 'row',
    backgroundColor: '#002060',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    width: '100%',
    maxWidth: 400,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  actionBtnDisabled: {
    backgroundColor: '#64748b',
    opacity: 0.7,
  },
  actionBtnIcon: {
    marginRight: 8,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  matrixCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    width: '100%',
    maxWidth: 500,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px 0 rgba(0,0,0,0.04)' },
      default: { elevation: 2 }
    })
  },
  matrixHeader: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  matrixHeaderText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rosterRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    alignItems: 'center',
  },
  roleCol: {
    width: '45%',
    paddingRight: 6,
  },
  roleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  metaLabel: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  metaLabelText: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '600',
  },
  candidateCol: {
    width: '55%',
  },
  candidateName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#002060',
  },
  candidateId: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 2,
  },
  sectionSeparator: {
    backgroundColor: '#eff6ff',
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  separatorText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1e40af',
    textTransform: 'uppercase',
  },
});