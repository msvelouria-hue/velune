import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { VestiaryColors } from '@/constants/Colors';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: VestiaryColors.gold,
        tabBarInactiveTintColor: VestiaryColors.creamDark,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
            backgroundColor: 'rgba(26, 31, 60, 0.95)',
            borderTopColor: VestiaryColors.navyLight,
            borderTopWidth: 1,
          },
          default: {
            backgroundColor: VestiaryColors.navy,
            borderTopColor: VestiaryColors.navyLight,
            borderTopWidth: 1,
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
          },
        }),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Closet',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="tshirt.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="dailypicks"
        options={{
          title: 'Daily Picks',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="sun.max.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gear" color={color} />,
        }}
      />
    </Tabs>
  );
}
