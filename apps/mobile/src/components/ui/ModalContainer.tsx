import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, RADII, SPACING } from '@/theme/tokens';

interface ModalContainerProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Wrap the body in a ScrollView (default true). */
  scroll?: boolean;
}

/**
 * Bottom sheet. The backdrop is a SIBLING behind the sheet (not a wrapper), so
 * it never intercepts touches or scroll gestures inside the sheet.
 */
export const ModalContainer: React.FC<ModalContainerProps> = ({
  visible,
  onClose,
  title,
  subtitle,
  children,
  contentStyle,
  scroll = true,
}) => {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }, contentStyle]}>
          <View style={styles.handleContainer}>
            <View style={styles.dragHandle} />
          </View>

          {(title || subtitle) && (
            <View style={styles.header}>
              <View style={styles.titleCol}>
                {title && <Text style={styles.titleText}>{title}</Text>}
                {subtitle && <Text style={styles.subtitleText}>{subtitle}</Text>}
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                testID="modal-close"
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

          {scroll ? (
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.body}>{children}</View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 15, 0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.bgSurface,
    borderTopLeftRadius: RADII.lg,
    borderTopRightRadius: RADII.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: '90%',
  },
  handleContainer: { alignItems: 'center', paddingVertical: 10 },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.borderMedium },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  titleCol: { flex: 1 },
  titleText: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  subtitleText: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.bgSurfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.md,
  },
  closeBtnText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700' },
  bodyScroll: { flexGrow: 0 },
  body: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.md },
});
