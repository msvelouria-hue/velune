import React, { useState, useEffect, type ComponentProps } from "react";
import { StyleSheet, ScrollView, View, TouchableOpacity, Switch, Alert, Platform, ActivityIndicator, Modal, TextInput } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { VestiaryColors } from "@/constants/Colors";
import { IconSymbol } from "@/components/ui/IconSymbol";
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import * as Calendar from 'expo-calendar';
import { Camera } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import notificationService from '@/utils/notificationService';
import { cloudSyncService } from '@/utils/cloudSyncService';
import { getUserProfile, saveUserProfile, isBetaTester, UserProfile, MakeupPreferenceLevel } from '@/utils/userProfileService';
import { clearUserScopedLocalData } from '@/utils/authStorage';
import { backgroundRemovalQueue, createBackgroundRemovalService } from '@/utils/backgroundRemoval';
import type { PermissionState } from '@/utils/wardrobeTypes';

interface PermissionStatus {
  status: PermissionState;
  canAskAgain?: boolean;
}

type PermissionType = 'location' | 'camera' | 'photos' | 'calendar';
type IconName = ComponentProps<typeof IconSymbol>['name'];
type PermissionsState = Record<PermissionType, PermissionStatus>;

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [permissions, setPermissions] = useState<PermissionsState>({
    location: { status: 'undetermined' },
    camera: { status: 'undetermined' },
    photos: { status: 'undetermined' },
    calendar: { status: 'undetermined' },
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationTime, setNotificationTime] = useState({ hour: 8, minute: 0 });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, phase: '' });
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [temperaturePreference, setTemperaturePreference] = useState<'cold' | 'neutral' | 'warm'>('neutral');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showBetaFeatures, setShowBetaFeatures] = useState(false);
  const [outfitAlgorithm, setOutfitAlgorithm] = useState<'basic' | 'premium'>('basic');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState({ current: 0, total: 0 });
  const [makeupPreferenceLevel, setMakeupPreferenceLevel] = useState<MakeupPreferenceLevel>('minimal');
  const [makeupAllergyOrAvoid, setMakeupAllergyOrAvoid] = useState('');
  const [makeupNotes, setMakeupNotes] = useState('');
  const [showMakeupDetails, setShowMakeupDetails] = useState(false);

  useEffect(() => {
    checkAllPermissions();
    loadNotificationSettings();
    loadLastSyncTime();
    loadTemperaturePreference();
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      const profile = await getUserProfile();
      setUserProfile(profile);
      setShowBetaFeatures(isBetaTester(profile));
      setOutfitAlgorithm(profile?.outfitAlgorithm || 'basic');
      setMakeupPreferenceLevel(profile?.makeupPreferenceLevel || 'minimal');
      setMakeupAllergyOrAvoid(profile?.makeupAllergyOrAvoid || '');
      setMakeupNotes(profile?.makeupNotes || '');
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const handleAlgorithmChange = async (algorithm: 'basic' | 'premium') => {
    try {
      setOutfitAlgorithm(algorithm);
      await saveUserProfile({ outfitAlgorithm: algorithm });
      await AsyncStorage.setItem('outfitAlgorithm', algorithm);
      Alert.alert(
        'Algorithm Updated',
        algorithm === 'premium'
          ? 'Premium AI will now create your outfit suggestions using advanced reasoning.'
          : 'Basic algorithm will use rule-based outfit selection.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error saving algorithm preference:', error);
      Alert.alert('Error', 'Failed to save preference. Please try again.');
    }
  };

  const handleMakeupLevelChange = async (level: MakeupPreferenceLevel) => {
    try {
      setMakeupPreferenceLevel(level);
      await saveUserProfile({ makeupPreferenceLevel: level });
      const levelLabels: Record<MakeupPreferenceLevel, string> = {
        none: "I won't suggest any makeup items",
        minimal: "I'll focus on subtle, natural looks",
        everyday: "I'll suggest balanced, everyday makeup",
        full: "I'll include complete makeup looks when appropriate"
      };
      Alert.alert('Makeup Preference Saved', levelLabels[level], [{ text: 'OK' }]);
    } catch (error) {
      console.error('Error saving makeup preference:', error);
      Alert.alert('Error', 'Failed to save preference. Please try again.');
    }
  };

  const handleMakeupDetailsSave = async () => {
    try {
      await saveUserProfile({
        makeupAllergyOrAvoid,
        makeupNotes
      });
      setShowMakeupDetails(false);
      Alert.alert('Details Saved', 'Your makeup preferences have been updated.', [{ text: 'OK' }]);
    } catch (error) {
      console.error('Error saving makeup details:', error);
      Alert.alert('Error', 'Failed to save details. Please try again.');
    }
  };

  const checkAllPermissions = async () => {
    try {
      // Check Location permission
      const locationStatus = await Location.getForegroundPermissionsAsync();

      // Check Camera permission
      const cameraStatus = await Camera.getCameraPermissionsAsync();

      // Check Photos permission
      const photosStatus = await MediaLibrary.getPermissionsAsync();

      // Check Calendar permission (iOS requires both Calendar AND Reminders)
      const calendarStatus = await Calendar.getCalendarPermissionsAsync();
      const remindersStatus = await Calendar.getRemindersPermissionsAsync();
      const calendarGranted = calendarStatus.granted && remindersStatus.granted;

      setPermissions({
        location: { status: locationStatus.granted ? 'granted' : locationStatus.canAskAgain ? 'undetermined' : 'denied' },
        camera: { status: cameraStatus.granted ? 'granted' : cameraStatus.canAskAgain ? 'undetermined' : 'denied' },
        photos: { status: photosStatus.granted ? 'granted' : photosStatus.canAskAgain ? 'undetermined' : 'denied' },
        calendar: { status: calendarGranted ? 'granted' : 'undetermined' },
      });
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  };

  const refreshAllPermissions = async () => {
    setIsRefreshing(true);
    try {
      // Request all permissions sequentially with user feedback
      await requestPermission('location');
      await requestPermission('camera');
      await requestPermission('photos');
      await requestPermission('calendar');

      // Check final status
      await checkAllPermissions();

      Alert.alert(
        'Permissions Updated',
        'All permissions have been refreshed. Check the status above.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error refreshing permissions:', error);
      Alert.alert('Error', 'Failed to refresh permissions. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const requestPermission = async (type: PermissionType) => {
    try {
      let result;

      switch (type) {
        case 'location':
          result = await Location.requestForegroundPermissionsAsync();
          break;
        case 'camera':
          result = await Camera.requestCameraPermissionsAsync();
          break;
        case 'photos':
          result = await MediaLibrary.requestPermissionsAsync();
          break;
        case 'calendar':
          // iOS requires BOTH Calendar and Reminders permissions to access calendar events
          // Request both permissions together (no alert - handled in onboarding)
          const calendarResult = await Calendar.requestCalendarPermissionsAsync();
          const remindersResult = await Calendar.requestRemindersPermissionsAsync();

          // Both must be granted for full calendar functionality
          const bothGranted = calendarResult.granted && remindersResult.granted;
          result = { granted: bothGranted, canAskAgain: calendarResult.canAskAgain || remindersResult.canAskAgain };

          console.log(`📅 Calendar permission: ${calendarResult.granted ? 'granted' : 'denied'}`);
          console.log(`📅 Reminders permission: ${remindersResult.granted ? 'granted' : 'denied'}`);
          break;
      }

      if (result) {
        setPermissions(prev => ({
          ...prev,
          [type]: {
            status: result.granted ? 'granted' : result.canAskAgain ? 'undetermined' : 'denied'
          }
        }));

        if (!result.granted && !result.canAskAgain) {
          Alert.alert(
            'Permission Required',
            `Please go to Settings > Privacy & Security to enable ${type} access for this app.`,
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      console.error(`Error requesting ${type} permission:`, error);
      Alert.alert('Error', `Failed to request ${type} permission. Please try again.`);
    }
  };

  const getPermissionIcon = (status: PermissionState): { name: IconName; color: string } => {
    switch (status) {
      case 'granted':
        return { name: 'checkmark.circle.fill', color: '#10B981' };
      case 'denied':
        return { name: 'xmark.circle.fill', color: '#EF4444' };
      default:
        return { name: 'questionmark.circle.fill', color: '#F59E0B' };
    }
  };

  const getPermissionText = (status: string) => {
    switch (status) {
      case 'granted':
        return 'Allowed';
      case 'denied':
        return 'Denied';
      default:
        return 'Not Set';
    }
  };

  const loadNotificationSettings = async () => {
    try {
      const enabled = await AsyncStorage.getItem('notificationsEnabled');
      const time = await AsyncStorage.getItem('notificationTime');

      if (enabled !== null) {
        setNotificationsEnabled(enabled === 'true');
      }

      if (time) {
        setNotificationTime(JSON.parse(time));
      }
    } catch (error) {
      console.error('Error loading notification settings:', error);
    }
  };

  const loadLastSyncTime = async () => {
    try {
      const lastSync = await cloudSyncService.getLastSyncTime();
      setLastSyncTime(lastSync);
    } catch (error) {
      console.error('Error loading last sync time:', error);
    }
  };

  const loadTemperaturePreference = async () => {
    try {
      const pref = await AsyncStorage.getItem('temperaturePreference');
      if (pref === 'cold' || pref === 'neutral' || pref === 'warm') {
        setTemperaturePreference(pref);
      }
    } catch (error) {
      console.error('Error loading temperature preference:', error);
    }
  };

  const handleTemperaturePreferenceChange = async (preference: 'cold' | 'neutral' | 'warm') => {
    try {
      setTemperaturePreference(preference);
      await AsyncStorage.setItem('temperaturePreference', preference);
      Alert.alert(
        'Preference Saved',
        preference === 'cold'
          ? 'Got it! I\'ll suggest warmer clothing for you.'
          : preference === 'warm'
            ? 'Got it! I\'ll suggest lighter clothing for you.'
            : 'Got it! I\'ll use standard temperature recommendations.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error saving temperature preference:', error);
      Alert.alert('Error', 'Failed to save preference. Please try again.');
    }
  };

  const formatLastSyncTime = (isoString: string | null): string => {
    if (!isoString) return 'Never synced';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } catch {
      return 'Unknown';
    }
  };

  const handleSyncData = async () => {
    if (isSyncing) return;

    Alert.alert(
      'Refresh from Cloud',
      'This will replace the local closet cache with the current Firestore closet. It will not upload local items, delete duplicates, or run cleanup.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Refresh Now',
          onPress: async () => {
            setIsSyncing(true);
            setSyncProgress({ current: 0, total: 0, phase: 'Refreshing...' });

            try {
              const result = await cloudSyncService.refreshLocalItemsFromCloud();

              await loadLastSyncTime();

              if (global.onItemsUpdated) {
                global.onItemsUpdated();
              }

              Alert.alert(
                'Refresh Complete',
                `Items in Firestore: ${result.cloudCount}\nUpdated local cards: ${result.refreshed}\nNew local cards: ${result.added}`,
                [{ text: 'OK' }]
              );
            } catch (error: any) {
              console.error('Cloud refresh error:', error);
              Alert.alert(
                'Refresh Failed',
                error.message || 'Could not refresh from the cloud. Please check your connection and try again.',
                [{ text: 'OK' }]
              );
            } finally {
              setIsSyncing(false);
              setSyncProgress({ current: 0, total: 0, phase: '' });
            }
          }
        }
      ]
    );
  };

  const toggleNotifications = async (value: boolean) => {
    try {
      if (value) {
        const granted = await notificationService.requestPermissions();
        if (!granted) {
          Alert.alert(
            'Notifications Not Available',
            Platform.OS === 'ios'
              ? 'Notifications require rebuilding the app with EAS Build. They will be available after you build and install the app on your device.'
              : 'Please enable notifications in your device settings to receive daily outfit reminders.',
            [{ text: 'OK' }]
          );
          return;
        }

        await notificationService.scheduleDailyReminder(notificationTime.hour, notificationTime.minute);
        await AsyncStorage.setItem('notificationsEnabled', 'true');
        setNotificationsEnabled(true);
      } else {
        await notificationService.cancelDailyReminder();
        await AsyncStorage.setItem('notificationsEnabled', 'false');
        setNotificationsEnabled(false);
      }
    } catch (error) {
      console.error('Error toggling notifications:', error);
      Alert.alert('Error', 'Failed to update notification settings. Please try again.');
    }
  };

  const changeNotificationTime = () => {
    Alert.prompt(
      'Set Reminder Time',
      'Enter time in 24-hour format (e.g., 08:00)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set',
          onPress: async (timeString?: string) => {
            if (!timeString) return;

            const [hourStr, minuteStr] = timeString.split(':');
            const hour = parseInt(hourStr);
            const minute = parseInt(minuteStr);

            if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
              Alert.alert('Invalid Time', 'Please enter a valid time in 24-hour format (e.g., 08:00)');
              return;
            }

            const newTime = { hour, minute };
            setNotificationTime(newTime);
            await AsyncStorage.setItem('notificationTime', JSON.stringify(newTime));

            if (notificationsEnabled) {
              await notificationService.scheduleDailyReminder(hour, minute);
            }
          }
        }
      ],
      'plain-text',
      `${notificationTime.hour.toString().padStart(2, '0')}:${notificationTime.minute.toString().padStart(2, '0')}`
    );
  };

  const PermissionRow = ({
    icon,
    title,
    description,
    permissionType,
    status
  }: {
    icon: IconName;
    title: string;
    description: string;
    permissionType: PermissionType;
    status: PermissionStatus;
  }) => {
    const statusIcon = getPermissionIcon(status.status);
    const isGranted = status.status === 'granted';

    return (
      <TouchableOpacity
        style={styles.permissionRow}
        onPress={() => !isGranted && requestPermission(permissionType)}
        disabled={isGranted}
      >
        <View style={styles.permissionLeft}>
          <View style={styles.permissionIconContainer}>
            <IconSymbol name={icon} size={24} color="#6B7280" />
          </View>
          <View style={styles.permissionContent}>
            <ThemedText style={styles.permissionTitle}>{title}</ThemedText>
            <ThemedText style={styles.permissionDescription}>{description}</ThemedText>
          </View>
        </View>
        <View style={styles.permissionRight}>
          <View style={styles.statusContainer}>
            <IconSymbol name={statusIcon.name} size={20} color={statusIcon.color} />
            <ThemedText style={[styles.statusText, { color: statusIcon.color }]}>
              {getPermissionText(status.status)}
            </ThemedText>
          </View>
          {!isGranted && (
            <IconSymbol name="chevron.right" size={16} color="#9CA3AF" />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.headerTitle}>Settings</ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Permissions</ThemedText>
          <ThemedText style={styles.sectionDescription}>
            Manage app permissions to customize your experience
          </ThemedText>

          <View style={styles.permissionsList}>
            <PermissionRow
              icon="location.fill"
              title="Location"
              description="Get weather updates and location-based outfit suggestions"
              permissionType="location"
              status={permissions.location}
            />

            <PermissionRow
              icon="camera.fill"
              title="Camera"
              description="Take photos of your clothing items directly in the app"
              permissionType="camera"
              status={permissions.camera}
            />

            <PermissionRow
              icon="photo.fill"
              title="Photos"
              description="Access your photo library to add existing clothing photos"
              permissionType="photos"
              status={permissions.photos}
            />

            <PermissionRow
              icon="calendar"
              title="Calendar"
              description="Access your calendar to suggest appropriate outfits for your events"
              permissionType="calendar"
              status={permissions.calendar}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.refreshButton, isRefreshing && styles.refreshButtonDisabled]}
          onPress={refreshAllPermissions}
          disabled={isRefreshing}
        >
          <IconSymbol name="arrow.clockwise" size={18} color={isRefreshing ? "#9CA3AF" : "#6366f1"} />
          <ThemedText style={[styles.refreshButtonText, isRefreshing && styles.refreshButtonTextDisabled]}>
            {isRefreshing ? 'Refreshing...' : 'Refresh Permissions'}
          </ThemedText>
        </TouchableOpacity>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Notifications</ThemedText>
          <ThemedText style={styles.sectionDescription}>
            Get daily reminders to check your outfit picks
          </ThemedText>

          <View style={styles.notificationRow}>
            <View style={styles.notificationLeft}>
              <View style={[styles.settingIconContainer, { backgroundColor: '#DBEAFE' }]}>
                <IconSymbol name="bell.fill" size={20} color="#3B82F6" />
              </View>
              <View style={styles.notificationContent}>
                <ThemedText style={styles.notificationTitle}>Daily Reminders</ThemedText>
                <ThemedText style={styles.notificationDescription}>
                  {notificationsEnabled
                    ? `Enabled at ${notificationTime.hour.toString().padStart(2, '0')}:${notificationTime.minute.toString().padStart(2, '0')}`
                    : 'Get reminded to check your outfit picks'
                  }
                </ThemedText>
              </View>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              trackColor={{ false: '#E5E7EB', true: '#93C5FD' }}
              thumbColor={notificationsEnabled ? '#3B82F6' : '#9CA3AF'}
            />
          </View>

          {notificationsEnabled && (
            <TouchableOpacity
              style={styles.timeButton}
              onPress={changeNotificationTime}
            >
              <IconSymbol name="clock.fill" size={16} color="#6366f1" />
              <ThemedText style={styles.timeButtonText}>Change Reminder Time</ThemedText>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Outfit Preferences</ThemedText>
          <ThemedText style={styles.sectionDescription}>
            Customize how outfit recommendations work for you
          </ThemedText>

          <View style={styles.temperatureSection}>
            <View style={styles.temperatureHeader}>
              <View style={[styles.settingIconContainer, { backgroundColor: '#FEE2E2' }]}>
                <IconSymbol name="thermometer" size={20} color="#EF4444" />
              </View>
              <View style={styles.temperatureContent}>
                <ThemedText style={styles.settingTitle}>Temperature Sensitivity</ThemedText>
                <ThemedText style={styles.settingDescription}>
                  How do you usually feel about the temperature?
                </ThemedText>
              </View>
            </View>

            <View style={styles.temperatureButtons}>
              <TouchableOpacity
                style={[
                  styles.tempButton,
                  temperaturePreference === 'cold' && styles.tempButtonSelected
                ]}
                onPress={() => handleTemperaturePreferenceChange('cold')}
              >
                <IconSymbol
                  name="snowflake"
                  size={18}
                  color={temperaturePreference === 'cold' ? '#fff' : '#3B82F6'}
                />
                <ThemedText style={[
                  styles.tempButtonText,
                  temperaturePreference === 'cold' && styles.tempButtonTextSelected
                ]}>
                  I run cold
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tempButton,
                  temperaturePreference === 'neutral' && styles.tempButtonSelected
                ]}
                onPress={() => handleTemperaturePreferenceChange('neutral')}
              >
                <IconSymbol
                  name="equal.circle"
                  size={18}
                  color={temperaturePreference === 'neutral' ? '#fff' : '#6B7280'}
                />
                <ThemedText style={[
                  styles.tempButtonText,
                  temperaturePreference === 'neutral' && styles.tempButtonTextSelected
                ]}>
                  Neutral
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tempButton,
                  temperaturePreference === 'warm' && styles.tempButtonSelected
                ]}
                onPress={() => handleTemperaturePreferenceChange('warm')}
              >
                <IconSymbol
                  name="sun.max.fill"
                  size={18}
                  color={temperaturePreference === 'warm' ? '#fff' : '#F59E0B'}
                />
                <ThemedText style={[
                  styles.tempButtonText,
                  temperaturePreference === 'warm' && styles.tempButtonTextSelected
                ]}>
                  I run warm
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.makeupSection}>
            <View style={styles.temperatureHeader}>
              <View style={[styles.settingIconContainer, { backgroundColor: '#FCE7F3' }]}>
                <IconSymbol name="sparkles" size={20} color="#EC4899" />
              </View>
              <View style={styles.temperatureContent}>
                <ThemedText style={styles.settingTitle}>Makeup Preference</ThemedText>
                <ThemedText style={styles.settingDescription}>
                  How much makeup do you typically wear?
                </ThemedText>
              </View>
            </View>

            <View style={styles.makeupButtons}>
              <TouchableOpacity
                style={[
                  styles.makeupButton,
                  makeupPreferenceLevel === 'none' && styles.makeupButtonSelected
                ]}
                onPress={() => handleMakeupLevelChange('none')}
              >
                <ThemedText style={[
                  styles.makeupButtonText,
                  makeupPreferenceLevel === 'none' && styles.makeupButtonTextSelected
                ]}>
                  None
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.makeupButton,
                  makeupPreferenceLevel === 'minimal' && styles.makeupButtonSelected
                ]}
                onPress={() => handleMakeupLevelChange('minimal')}
              >
                <ThemedText style={[
                  styles.makeupButtonText,
                  makeupPreferenceLevel === 'minimal' && styles.makeupButtonTextSelected
                ]}>
                  Minimal
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.makeupButton,
                  makeupPreferenceLevel === 'everyday' && styles.makeupButtonSelected
                ]}
                onPress={() => handleMakeupLevelChange('everyday')}
              >
                <ThemedText style={[
                  styles.makeupButtonText,
                  makeupPreferenceLevel === 'everyday' && styles.makeupButtonTextSelected
                ]}>
                  Everyday
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.makeupButton,
                  makeupPreferenceLevel === 'full' && styles.makeupButtonSelected
                ]}
                onPress={() => handleMakeupLevelChange('full')}
              >
                <ThemedText style={[
                  styles.makeupButtonText,
                  makeupPreferenceLevel === 'full' && styles.makeupButtonTextSelected
                ]}>
                  Full
                </ThemedText>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.makeupDetailsButton}
              onPress={() => setShowMakeupDetails(!showMakeupDetails)}
            >
              <IconSymbol
                name={showMakeupDetails ? "chevron.up" : "chevron.down"}
                size={16}
                color={VestiaryColors.gold}
              />
              <ThemedText style={styles.makeupDetailsButtonText}>
                {showMakeupDetails ? 'Hide Details' : 'Add Allergies or Notes'}
              </ThemedText>
            </TouchableOpacity>

            {showMakeupDetails && (
              <View style={styles.makeupDetailsContainer}>
                <View style={styles.makeupInputGroup}>
                  <ThemedText style={styles.makeupInputLabel}>Allergies or Products to Avoid</ThemedText>
                  <TextInput
                    style={styles.makeupTextInput}
                    value={makeupAllergyOrAvoid}
                    onChangeText={setMakeupAllergyOrAvoid}
                    placeholder="e.g., latex, fragrance, certain brands..."
                    placeholderTextColor={VestiaryColors.creamDark}
                    multiline
                  />
                </View>
                <View style={styles.makeupInputGroup}>
                  <ThemedText style={styles.makeupInputLabel}>Makeup Notes</ThemedText>
                  <TextInput
                    style={styles.makeupTextInput}
                    value={makeupNotes}
                    onChangeText={setMakeupNotes}
                    placeholder="e.g., I always do lips + brows, no foundation..."
                    placeholderTextColor={VestiaryColors.creamDark}
                    multiline
                  />
                </View>
                <TouchableOpacity
                  style={styles.makeupSaveButton}
                  onPress={handleMakeupDetailsSave}
                >
                  <ThemedText style={styles.makeupSaveButtonText}>Save Details</ThemedText>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {showBetaFeatures && (
            <View style={styles.algorithmSection}>
              <View style={styles.temperatureHeader}>
                <View style={[styles.settingIconContainer, { backgroundColor: '#E0E7FF' }]}>
                  <IconSymbol name="sparkles" size={20} color="#6366F1" />
                </View>
                <View style={styles.temperatureContent}>
                  <ThemedText style={styles.settingTitle}>Outfit Selection Algorithm</ThemedText>
                  <ThemedText style={styles.settingDescription}>
                    Choose how your outfits are selected
                  </ThemedText>
                </View>
              </View>

              <View style={styles.temperatureButtons}>
                <TouchableOpacity
                  style={[
                    styles.tempButton,
                    outfitAlgorithm === 'basic' && styles.tempButtonSelected
                  ]}
                  onPress={() => handleAlgorithmChange('basic')}
                >
                  <IconSymbol
                    name="list.bullet"
                    size={18}
                    color={outfitAlgorithm === 'basic' ? '#fff' : '#6B7280'}
                  />
                  <ThemedText style={[
                    styles.tempButtonText,
                    outfitAlgorithm === 'basic' && styles.tempButtonTextSelected
                  ]}>
                    Basic
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.tempButton,
                    outfitAlgorithm === 'premium' && styles.tempButtonSelected,
                    { borderColor: VestiaryColors.gold }
                  ]}
                  onPress={() => handleAlgorithmChange('premium')}
                >
                  <IconSymbol
                    name="wand.and.stars"
                    size={18}
                    color={outfitAlgorithm === 'premium' ? '#fff' : VestiaryColors.gold}
                  />
                  <ThemedText style={[
                    styles.tempButtonText,
                    outfitAlgorithm === 'premium' && styles.tempButtonTextSelected
                  ]}>
                    Premium AI
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            App Settings
          </ThemedText>
          <ThemedText style={styles.sectionDescription}>
            Manage your app experience and data
          </ThemedText>

          {showBetaFeatures && (
            <>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={handleRestartOnboarding}
              >
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIconContainer, { backgroundColor: '#FEF3C7' }]}>
                    <IconSymbol name="arrow.counterclockwise" size={20} color="#F59E0B" />
                  </View>
                  <View style={styles.settingContent}>
                    <ThemedText style={styles.settingTitle}>Restart Onboarding</ThemedText>
                    <ThemedText style={styles.settingDescription}>
                      Go through the setup process again
                    </ThemedText>
                  </View>
                </View>
                <IconSymbol name="chevron.right" size={16} color="#94a3b8" />
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.settingRow}
                onPress={handleReprocessPhotos}
                disabled={isReprocessing}
              >
                <View style={styles.settingLeft}>
                  <View style={[styles.settingIconContainer, { backgroundColor: '#E0E7FF' }]}>
                    {isReprocessing ? (
                      <ActivityIndicator size="small" color="#6366F1" />
                    ) : (
                      <IconSymbol name="photo.on.rectangle" size={20} color="#6366F1" />
                    )}
                  </View>
                  <View style={styles.settingContent}>
                    <ThemedText style={styles.settingTitle}>
                      {isReprocessing ? `Reprocessing... ${reprocessProgress.current}/${reprocessProgress.total}` : 'Reprocess Photos'}
                    </ThemedText>
                    <ThemedText style={styles.settingDescription}>
                      Remove backgrounds from recent photos
                    </ThemedText>
                  </View>
                </View>
                <IconSymbol name="chevron.right" size={16} color="#94a3b8" />
              </TouchableOpacity>

              <View style={styles.divider} />
            </>
          )}

          <TouchableOpacity
            style={styles.settingRow}
            onPress={handleSyncData}
            disabled={isSyncing}
          >
            <View style={styles.settingLeft}>
              <View style={[styles.settingIconContainer, { backgroundColor: '#DBEAFE' }]}>
                {isSyncing ? (
                  <ActivityIndicator size="small" color="#3B82F6" />
                ) : (
                  <IconSymbol name="arrow.triangle.2.circlepath" size={20} color="#3B82F6" />
                )}
              </View>
              <View style={styles.settingContent}>
                <ThemedText style={styles.settingTitle}>
                  {isSyncing ? syncProgress.phase : 'Refresh from Cloud'}
                </ThemedText>
                <ThemedText style={styles.settingDescription}>
                  {isSyncing
                    ? 'Updating local closet data'
                    : lastSyncTime
                      ? `Last refreshed: ${formatLastSyncTime(lastSyncTime)}`
                      : 'Update local cards from Firestore'}
                </ThemedText>
              </View>
            </View>
            <IconSymbol name="chevron.right" size={16} color="#94a3b8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={[styles.settingRow, isLoggingOut && { opacity: 0.6 }]}
            onPress={handleLogout}
            disabled={isLoggingOut}
          >
            <View style={styles.settingLeft}>
              <View style={[styles.settingIconContainer, { backgroundColor: '#FEE2E2' }]}>
                {isLoggingOut ? (
                  <ActivityIndicator size="small" color="#EF4444" />
                ) : (
                  <IconSymbol name="arrow.right.square.fill" size={20} color="#EF4444" />
                )}
              </View>
              <View style={styles.settingContent}>
                <ThemedText style={styles.settingTitle}>
                  {isLoggingOut ? 'Logging out...' : 'Logout'}
                </ThemedText>
                <ThemedText style={styles.settingDescription}>
                  {isLoggingOut ? 'Please wait' : 'Sign out of your account'}
                </ThemedText>
              </View>
            </View>
            {!isLoggingOut && <IconSymbol name="chevron.right" size={16} color="#94a3b8" />}
          </TouchableOpacity>
        </View>

        <View style={styles.dangerZoneSection}>
          <ThemedText style={styles.dangerZoneTitle}>Danger Zone</ThemedText>

          <TouchableOpacity
            style={styles.deleteAccountRow}
            onPress={() => setShowDeleteModal(true)}
          >
            <View style={styles.settingLeft}>
              <View style={[styles.settingIconContainer, { backgroundColor: '#7F1D1D' }]}>
                <IconSymbol name="trash.fill" size={20} color="#EF4444" />
              </View>
              <View style={styles.settingContent}>
                <ThemedText style={styles.deleteAccountTitle}>Delete All My Data</ThemedText>
                <ThemedText style={styles.deleteAccountDescription}>
                  Permanently delete all your photos, likes, feedback, and account
                </ThemedText>
              </View>
            </View>
            <IconSymbol name="chevron.right" size={16} color="#EF4444" />
          </TouchableOpacity>
        </View>

      </ScrollView>
      <View style={{ height: 100 }} />

      <Modal
        visible={showDeleteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!isDeleting) {
            setShowDeleteModal(false);
            setDeleteConfirmText('');
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContainer}>
            <View style={styles.deleteModalHeader}>
              <View style={styles.deleteWarningIcon}>
                <IconSymbol name="exclamationmark.triangle.fill" size={32} color="#EF4444" />
              </View>
              <ThemedText style={styles.deleteModalTitle}>Delete Account</ThemedText>
            </View>

            <ThemedText style={styles.deleteModalWarning}>
              This action cannot be undone. This will permanently delete:
            </ThemedText>

            <View style={styles.deleteItemsList}>
              <ThemedText style={styles.deleteListItem}>• All your clothing photos</ThemedText>
              <ThemedText style={styles.deleteListItem}>• All your closet items</ThemedText>
              <ThemedText style={styles.deleteListItem}>• All your likes and feedback</ThemedText>
              <ThemedText style={styles.deleteListItem}>• Your user preferences</ThemedText>
              <ThemedText style={styles.deleteListItem}>• Your account</ThemedText>
            </View>

            <ThemedText style={styles.deleteConfirmLabel}>
              Type {'"Delete my data"'} to confirm:
            </ThemedText>

            <TextInput
              style={styles.deleteConfirmInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="Delete my data"
              placeholderTextColor="#6B7280"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isDeleting}
            />

            <View style={styles.deleteModalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                }}
                disabled={isDeleting}
              >
                <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.deleteButton,
                  deleteConfirmText.toLowerCase() !== 'delete my data' && styles.deleteButtonDisabled
                ]}
                onPress={handleDeleteAccount}
                disabled={deleteConfirmText.toLowerCase() !== 'delete my data' || isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText style={styles.deleteButtonText}>Delete All Data</ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );

  async function handleRestartOnboarding() {
    Alert.alert(
      'Restart Onboarding',
      'This will take you through the initial setup process again. Your closet items will be preserved.',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Restart',
          style: 'default',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem('onboardingCompleted');
              router.replace('/onboarding' as any);
            } catch (error) {
              console.error('Error restarting onboarding:', error);
              Alert.alert('Error', 'Failed to restart onboarding. Please try again.');
            }
          }
        }
      ]
    );
  }

  async function handleReprocessPhotos() {
    Alert.alert(
      'Reprocess Photos',
      'This will attempt to remove backgrounds from all photos added in the last week. This may take a few minutes.',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Reprocess',
          style: 'default',
          onPress: async () => {
            try {
              setIsReprocessing(true);

              // Initialize the background removal service (in case Closet tab hasn't been visited)
              const service = createBackgroundRemovalService('firebase');
              backgroundRemovalQueue.setService(service);
              console.log('🔧 Initialized background removal service for reprocessing');

              const allItems = await cloudSyncService.loadClosetItems();
              if (allItems.length === 0) {
                Alert.alert('No Items', 'No clothing items found to reprocess.');
                setIsReprocessing(false);
                return;
              }

              const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

              const itemsToReprocess = allItems.filter(item => {
                if (!item.photo || item.photo.trim() === '') return false;
                const addedTime = item.dateAdded ? new Date(item.dateAdded).getTime() : 0;
                return addedTime > oneWeekAgo;
              });

              if (itemsToReprocess.length === 0) {
                Alert.alert('No Items', 'No items from the last week found to reprocess.');
                setIsReprocessing(false);
                return;
              }

              setReprocessProgress({ current: 0, total: itemsToReprocess.length });
              console.log(`🔄 Reprocessing ${itemsToReprocess.length} items for background removal`);

              let processed = 0;
              for (const item of itemsToReprocess) {
                if (!item.photo) {
                  continue;
                }
                backgroundRemovalQueue.addToQueue(
                  item.id,
                  item.photo,
                  async (itemId, newPhotoUrl) => {
                    processed++;
                    setReprocessProgress(prev => ({ ...prev, current: processed }));
                    console.log(`✅ Reprocessed ${itemId}: ${newPhotoUrl.substring(0, 50)}...`);

                    const currentItem = await cloudSyncService.getItem(itemId);
                    if (currentItem) {
                      await cloudSyncService.updateItem({
                        ...currentItem,
                        photo: newPhotoUrl,
                        imageUrl: newPhotoUrl,
                        backgroundRemovalFailed: false,
                        backgroundRemovalStatus: 'complete',
                        photoStatus: 'background_removed',
                      });
                    }

                    if (processed >= itemsToReprocess.length) {
                      setIsReprocessing(false);
                      Alert.alert('Complete', `Successfully reprocessed ${processed} photos.`);
                    }
                  },
                  async (itemId, error) => {
                    processed++;
                    setReprocessProgress(prev => ({ ...prev, current: processed }));
                    console.log(`❌ Failed to reprocess ${itemId}: ${error}`);

                    if (processed >= itemsToReprocess.length) {
                      setIsReprocessing(false);
                      Alert.alert('Complete', `Finished reprocessing. Some items may have failed.`);
                    }
                  }
                );
              }

            } catch (error) {
              console.error('Error reprocessing photos:', error);
              setIsReprocessing(false);
              Alert.alert('Error', 'Failed to start reprocessing. Please try again.');
            }
          }
        }
      ]
    );
  }

  async function handleLogout() {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout? Your data will be synced when you sign back in.',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            setIsLoggingOut(true);
            try {
              // Clear all user-scoped local data before leaving the account.
              await clearUserScopedLocalData();

              const { signOut } = await import('@/utils/firebaseAuth');
              await signOut();
              router.replace('/login' as any);
            } catch (error) {
              console.error('Error logging out:', error);
              setIsLoggingOut(false);
              Alert.alert('Error', 'Failed to logout. Please try again.');
            }
          }
        }
      ]
    );
  }

  async function handleDeleteAccount() {
    setIsDeleting(true);

    try {
      const { auth } = await import('@/config/firebase');
      const { collection, query, where, getDocs, deleteDoc, doc, writeBatch } = await import('firebase/firestore');
      const { ref, deleteObject, listAll } = await import('firebase/storage');
      const { db, storage } = await import('@/config/firebase');
      const { deleteUser } = await import('firebase/auth');

      const user = auth.currentUser;
      if (!user) {
        throw new Error('No user logged in');
      }

      const userId = user.uid;
      console.log(`🗑️ Starting account deletion for user: ${userId}`);

      // 1. Delete all photos from Firebase Storage
      console.log('🗑️ Deleting photos from storage...');
      try {
        const userStorageRef = ref(storage, `users/${userId}/clothing`);
        const fileList = await listAll(userStorageRef);

        const deletePromises = fileList.items.map(async (itemRef) => {
          try {
            await deleteObject(itemRef);
            console.log(`  ✓ Deleted: ${itemRef.name}`);
          } catch (err) {
            console.warn(`  ⚠️ Could not delete ${itemRef.name}:`, err);
          }
        });

        await Promise.all(deletePromises);
        console.log(`✅ Deleted ${fileList.items.length} photos`);
      } catch (storageError: any) {
        console.warn('⚠️ Storage deletion error (may be empty):', storageError?.message);
      }

      // 2. Delete all clothing items from Firestore
      console.log('🗑️ Deleting clothing items from Firestore...');
      try {
        const clothingQueries = [
          {
            label: 'active clothing items',
            ref: query(collection(db, 'closetItems'), where('userId', '==', userId)),
          },
          {
            label: 'legacy clothing items',
            ref: query(collection(db, 'users', userId, 'closet')),
          },
        ];

        for (const clothingQuery of clothingQueries) {
          const clothingSnapshot = await getDocs(clothingQuery.ref);

          if (!clothingSnapshot.empty) {
            const batch = writeBatch(db);
            clothingSnapshot.docs.forEach((docSnapshot) => {
              batch.delete(docSnapshot.ref);
            });
            await batch.commit();
            console.log(`✅ Deleted ${clothingSnapshot.size} ${clothingQuery.label}`);
          }
        }
      } catch (firestoreError) {
        console.warn('⚠️ Clothing items deletion error:', firestoreError);
      }

      // 3. Delete outfit feedback
      console.log('🗑️ Deleting outfit feedback...');
      try {
        const outfitsQuery = query(collection(db, 'users', userId, 'outfits'));
        const outfitsSnapshot = await getDocs(outfitsQuery);

        if (!outfitsSnapshot.empty) {
          const batch = writeBatch(db);
          outfitsSnapshot.docs.forEach((docSnapshot) => {
            batch.delete(docSnapshot.ref);
          });
          await batch.commit();
          console.log(`✅ Deleted ${outfitsSnapshot.size} outfit records`);
        }
      } catch (outfitError) {
        console.warn('⚠️ Outfit feedback deletion error:', outfitError);
      }

      // 4. Delete user preferences
      console.log('🗑️ Deleting user preferences...');
      try {
        const prefsDoc = doc(db, 'userPreferences', userId);
        await deleteDoc(prefsDoc);
        console.log('✅ Deleted user preferences');
      } catch (prefsError) {
        console.warn('⚠️ User preferences deletion error:', prefsError);
      }

      // 5. Delete user profile document
      console.log('🗑️ Deleting user profile...');
      try {
        const userDoc = doc(db, 'users', userId);
        await deleteDoc(userDoc);
        console.log('✅ Deleted user profile');
      } catch (profileError) {
        console.warn('⚠️ User profile deletion error:', profileError);
      }

      // 6. Clear local storage
      console.log('🗑️ Clearing local storage...');
      await clearUserScopedLocalData();
      console.log('✅ Cleared local storage');

      // 7. Delete the Firebase Auth user account
      console.log('🗑️ Deleting user account...');
      await deleteUser(user);
      console.log('✅ Deleted user account');

      // Close modal and navigate to login
      setShowDeleteModal(false);
      setDeleteConfirmText('');

      Alert.alert(
        'Account Deleted',
        'Your account and all associated data have been permanently deleted.',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/login' as any)
          }
        ]
      );
    } catch (error: any) {
      console.error('❌ Error deleting account:', error);

      // Handle re-authentication requirement
      if (error?.code === 'auth/requires-recent-login') {
        Alert.alert(
          'Re-authentication Required',
          'For security reasons, please log out and log back in, then try deleting your account again.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Deletion Failed',
          error?.message || 'Could not delete your account. Please try again or contact support.',
          [{ text: 'OK' }]
        );
      }
    } finally {
      setIsDeleting(false);
    }
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 24,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: VestiaryColors.cream,
  },
  section: {
    backgroundColor: VestiaryColors.navyLight,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 6,
  },
  sectionDescription: {
    fontSize: 14,
    color: VestiaryColors.creamDark,
    marginBottom: 20,
    lineHeight: 20,
  },
  permissionsList: {
    gap: 0,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: VestiaryColors.navy,
  },
  permissionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  permissionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: VestiaryColors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  permissionContent: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 4,
  },
  permissionDescription: {
    fontSize: 13,
    color: VestiaryColors.creamDark,
    lineHeight: 18,
  },
  permissionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestiaryColors.navyLight,
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  refreshButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.gold,
  },
  refreshButtonDisabled: {
    opacity: 0.5,
  },
  refreshButtonTextDisabled: {
    color: VestiaryColors.creamDark,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    color: VestiaryColors.creamDark,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: VestiaryColors.navy,
    marginVertical: 12,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  notificationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 4,
  },
  notificationDescription: {
    fontSize: 13,
    color: VestiaryColors.creamDark,
    lineHeight: 18,
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestiaryColors.navy,
    marginTop: 12,
    borderRadius: 8,
    paddingVertical: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  timeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.gold,
  },
  temperatureSection: {
    marginTop: 4,
  },
  algorithmSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: VestiaryColors.navy,
  },
  temperatureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  temperatureContent: {
    flex: 1,
  },
  temperatureButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  tempButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: VestiaryColors.navy,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    gap: 8,
  },
  tempButtonSelected: {
    backgroundColor: VestiaryColors.gold,
    borderColor: VestiaryColors.gold,
  },
  tempButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: VestiaryColors.creamDark,
    textAlign: 'center',
  },
  tempButtonTextSelected: {
    color: VestiaryColors.navyDark,
  },
  makeupSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: VestiaryColors.navyLight,
  },
  makeupButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 8,
  },
  makeupButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: VestiaryColors.navy,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  makeupButtonSelected: {
    backgroundColor: '#EC4899',
    borderColor: '#EC4899',
  },
  makeupButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: VestiaryColors.creamDark,
    textAlign: 'center',
  },
  makeupButtonTextSelected: {
    color: '#fff',
  },
  makeupDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 8,
    gap: 6,
  },
  makeupDetailsButtonText: {
    fontSize: 13,
    color: VestiaryColors.gold,
    fontWeight: '500',
  },
  makeupDetailsContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: VestiaryColors.navyDark,
    borderRadius: 10,
    gap: 12,
  },
  makeupInputGroup: {
    gap: 6,
  },
  makeupInputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: VestiaryColors.cream,
  },
  makeupTextInput: {
    backgroundColor: VestiaryColors.navy,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    borderRadius: 8,
    padding: 10,
    color: VestiaryColors.cream,
    fontSize: 14,
    minHeight: 50,
    textAlignVertical: 'top',
  },
  makeupSaveButton: {
    backgroundColor: VestiaryColors.gold,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  makeupSaveButtonText: {
    color: VestiaryColors.navyDark,
    fontWeight: '600',
    fontSize: 14,
  },
  dangerZoneSection: {
    backgroundColor: '#1a0505',
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#7F1D1D',
  },
  dangerZoneTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#EF4444',
    marginBottom: 16,
  },
  deleteAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  deleteAccountTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
    marginBottom: 4,
  },
  deleteAccountDescription: {
    fontSize: 13,
    color: '#F87171',
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  deleteModalContainer: {
    backgroundColor: VestiaryColors.navyLight,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: '#7F1D1D',
  },
  deleteModalHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  deleteWarningIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#7F1D1D',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  deleteModalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#EF4444',
  },
  deleteModalWarning: {
    fontSize: 14,
    color: VestiaryColors.cream,
    marginBottom: 16,
    lineHeight: 20,
  },
  deleteItemsList: {
    backgroundColor: '#1a0505',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  deleteListItem: {
    fontSize: 14,
    color: '#F87171',
    lineHeight: 22,
  },
  deleteConfirmLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: VestiaryColors.cream,
    marginBottom: 8,
  },
  deleteConfirmInput: {
    backgroundColor: VestiaryColors.navy,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: VestiaryColors.cream,
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
    marginBottom: 20,
  },
  deleteModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: VestiaryColors.navy,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: VestiaryColors.navyLight,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: VestiaryColors.cream,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteButtonDisabled: {
    backgroundColor: '#6B7280',
    opacity: 0.5,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
