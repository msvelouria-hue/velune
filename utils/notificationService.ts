import { Platform } from 'react-native';
import type {
  Notification,
  NotificationResponse,
} from 'expo-notifications';

let Notifications: any = null;
let Device: any = null;

// Lazy load expo-notifications to avoid errors in dev environment
// These native modules require EAS Build to be available
try {
  Notifications = require('expo-notifications');
  Device = require('expo-device');

  // Configure how notifications should behave when app is in foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (error) {
  console.log('ℹ️ Notifications not available in dev mode - rebuild with EAS Build to enable');
}

export interface NotificationPreferences {
  enabled: boolean;
  morningReminderTime?: { hour: number; minute: number };
}

class NotificationService {
  private notificationIdentifier: string | null = null;

  async requestPermissions(): Promise<boolean> {
    if (!Notifications || !Device) {
      console.log('ℹ️ Notifications not available - rebuild app with EAS Build to enable');
      return false;
    }

    if (!Device.isDevice) {
      console.log('ℹ️ Push notifications only work on physical devices');
      return false;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('ℹ️ Notification permission not granted');
        return false;
      }

      // Configure notification channel for Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('daily-reminders', {
          name: 'Daily Outfit Reminders',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF6B9D',
        });
      }

      return true;
    } catch (error) {
      console.warn('⚠️ Error requesting notification permissions:', error);
      return false;
    }
  }

  async scheduleDailyReminder(hour: number = 8, minute: number = 0): Promise<boolean> {
    if (!Notifications) {
      console.log('ℹ️ Notifications not available - rebuild app with EAS Build to enable');
      return false;
    }

    try {
      // Always cancel ALL scheduled notifications to prevent duplicates
      // This is important because the notificationIdentifier gets lost on app restart
      await Notifications.cancelAllScheduledNotificationsAsync();
      this.notificationIdentifier = null;
      console.log('🗑️ Cleared all existing scheduled notifications');

      // Schedule a daily notification
      // This does NOT pre-generate outfits - it just sends a reminder to open the app
      this.notificationIdentifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: '✨ Time to Style!',
          body: 'Check out your personalized outfit picks for today',
          data: { type: 'daily_reminder' },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
        },
      });

      console.log(`✅ Daily reminder scheduled for ${hour}:${minute < 10 ? '0' : ''}${minute}`);
      return true;
    } catch (error) {
      console.error('❌ Error scheduling daily reminder:', error);
      return false;
    }
  }

  async cancelDailyReminder(): Promise<void> {
    if (!Notifications) {
      return;
    }

    try {
      if (this.notificationIdentifier) {
        await Notifications.cancelScheduledNotificationAsync(this.notificationIdentifier);
        this.notificationIdentifier = null;
        console.log('✅ Daily reminder cancelled');
      } else {
        // Cancel all scheduled notifications as fallback
        await Notifications.cancelAllScheduledNotificationsAsync();
      }
    } catch (error) {
      console.error('❌ Error cancelling notification:', error);
    }
  }

  async getAllScheduledNotifications(): Promise<any[]> {
    if (!Notifications) {
      return [];
    }

    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('❌ Error getting scheduled notifications:', error);
      return [];
    }
  }

  async sendImmediateNotification(title: string, body: string): Promise<void> {
    if (!Notifications) {
      console.log('ℹ️ Notifications not available - rebuild app with EAS Build to enable');
      return;
    }

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
        },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('❌ Error sending immediate notification:', error);
    }
  }

  // Set up notification listeners for when user taps on notification
  setupNotificationListeners(
    onNotificationReceived?: (notification: Notification) => void,
    onNotificationTapped?: (response: NotificationResponse) => void
  ): () => void {
    if (!Notifications) {
      return () => {}; // Return no-op cleanup function
    }

    const receivedSubscription = Notifications.addNotificationReceivedListener((notification: Notification) => {
      if (onNotificationReceived) {
        onNotificationReceived(notification);
      }
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response: NotificationResponse) => {
      if (onNotificationTapped) {
        onNotificationTapped(response);
      }
    });

    // Return cleanup function
    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }
}

export default new NotificationService();
