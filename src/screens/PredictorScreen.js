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
import { supabase } from '../../lib/supabase'; // Adjust this relative path based on your folder structure

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
      const { data: participants, error } = await supabase
        .from('clp_training_participants')
        .select(`
          MemberIDNo,
          type,
          sub_type,
          clp_training_id,
          members (
            Firstname,
            Lastname,
            PastoralService,
            Gender
          )
        `);

      if (error) throw error;

      // 2. Map and filter valid candidates by aggregating past role workloads
      const memberHistoryMap = {};
      participants.forEach(p => {
        if (!p.members) return;
        const id = p.MemberIDNo;
        
        if (!memberHistoryMap[id]) {
          memberHistoryMap[id] = {
            idNo: id,
            name: `${p.members.Firstname} ${p.members.Lastname}`,
            pastoralRole: p.members.PastoralService || 'Member',
            pastRoles: []
          };
        }
        if (p.type === 'service_team' && p.sub_type) {
          memberHistoryMap[id].pastRoles.push(p.sub_type);
        } else if (p.type === 'participant') {
          memberHistoryMap[id].pastRoles.push('Graduate/Participant');
        }
      });

      const candidatesList = Object.values(memberHistoryMap);

      if (candidatesList.length === 0) {
        throw new Error("No historical data found in clp_training_participants to evaluate.");
      }

      // 3. Make the API call directly via native HTTPS Fetch
      const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY; // Secure this or use a backend endpoint instead
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
              content: `You are an expert church administrative AI assistant predicting leadership configurations for the next dynamic Catholic Life Program (CLP) batch cycle.
              Analyze historical deployments and structures from the given candidate dataset. The positions shouldn't be assigned to the same individual, and each role has specific pastoral role requirements. Also, their Lastname shouldn't the the same
              
              Enforce these strict matching rules:
              - Supervising Unit Head: Must have pastoralRole == 'UH'
              - Team Servant: Must have PastoralService == 'HH under members table '
              - Prayer Warrior: Must have PastoralService == 'HH members table'
              - Facilitators: Output an array containing a minimum of 2 separate valid candidates. Must have PastoralService == 'Member' or 'HH' or 'MEMBER'
              - Team Leader: Atleast 2 years of being a participant from clp_training_participants
              - Team Leader: Column in members table (PastoralService should be HH, MEMBER)
              - Team Leader: Gender should be Male
              - Team Leader: So every generation should check the clp_training_participants and members table
              - Team Leader: Should not have been taken a Team Leader role (so clp_training_participants table and type = service_team and sub_type = Team Leader is excluded)
              - Absolute Constraint: Do not assign the exact same MemberIDNo to multiple roles.`
            },
            {
              role: 'user',
              content: `Here is the current pool matrix dataset: ${JSON.stringify(candidatesList)}. 
              Formulate the absolute best optimal leadership structural profile.`
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
            <Text style={styles.globeEmoji}>🌐</Text>
          </Animated.View>
        </View>

        {/* Informational Header */}
        <Text style={styles.title}>AI Leadership Matrix Predictor</Text>
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
            <Text style={styles.actionBtnText}>🔮 Generate Next Batch Roster</Text>
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
  globeEmoji: {
    fontSize: 44,
    textAlign: 'center',
    ...Platform.select({
      ios: { marginTop: 0 },
      android: { marginTop: -4 },
      web: { userSelect: 'none' }
    })
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
    backgroundColor: '#002060',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    marginBottom: 24,
  },
  actionBtnDisabled: {
    backgroundColor: '#64748b',
    opacity: 0.7,
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