import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

export default function PredictorScreen() {
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(1)).current;

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

  return (
    <View style={styles.container}>
      <View style={styles.centerContent}>
        {/* Animated Loading Globe Section */}
        <View style={styles.animationContainer}>
          <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseValue }] }]} />
          <Animated.View style={[styles.globeWrapper, { transform: [{ rotate: spin }] }]}>
            <Text style={styles.globeEmoji}>🌐</Text>
          </Animated.View>
        </View>

        {/* Informational Text Blocks (Simplified Wording) */}
        <Text style={styles.title}>Leader Predictor Coming Soon</Text>
        <Text style={styles.subtitle}>
          We are building an smart AI tool to help look at training history, finished modules, and roles to suggest who can step up as the next Christian Life Program (CLP) leaders.
        </Text>
        
        <View style={styles.badge}>
          <Text style={styles.badgeText}>🚀 WORK IN PROGRESS</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  centerContent: {
    alignItems: 'center',
    maxWidth: 400,
    textAlign: 'center',
  },
  animationContainer: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
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
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  badge: {
    backgroundColor: '#002060',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});