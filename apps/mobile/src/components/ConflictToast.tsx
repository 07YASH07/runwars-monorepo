import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';

interface ConflictToastProps {
  visible: boolean;
  playerName: string;
  playerColor: string;
}

const { width } = Dimensions.get('window');

export default function ConflictToast({ visible, playerName, playerColor }: ConflictToastProps) {
  const slideAnim = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 50,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  // Render anyway for animation to work when dismissing
  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }] }]}>
      <Text style={styles.icon}>⚔️</Text>
      <View style={styles.textContainer}>
        <Text style={styles.title}>Territory Captured!</Text>
        <Text style={styles.message}>
          <Text style={{ color: playerColor, fontWeight: 'bold' }}>{playerName}</Text> has taken your zone!
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    backgroundColor: '#1E1E38',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#FF4D4D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#FF4D4D',
    zIndex: 9999,
  },
  icon: {
    fontSize: 24,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#FF4D4D',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  message: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
