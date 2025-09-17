// App.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { NavigationContainer, DefaultTheme, Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';

import CampaignsScreen from './screens/campaigns';
import CreateCampaignsScreen from './screens/createCampaigns';
import ExecutionScreen from './screens/execution';               // ✅ add this
import { Campaign } from './data/campaignsData';                 // ✅ for types

export type CampaignsStackParamList = {
  CampaignsHome: undefined;
  CreateCampaigns: undefined;
  Execution: { campaign: Campaign };                             // ✅ add route + param type
};

export type RootTabParamList = {
  CampaignsTab: undefined;
  QueryTab: undefined;
};

const CampaignsStack = createNativeStackNavigator<CampaignsStackParamList>();
const Tabs = createBottomTabNavigator<RootTabParamList>();

const appTheme: Theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#0b0d12', card: '#111521', text: '#e9eefb', border: '#22325a', primary: '#36c48f' },
};

function CampaignsStackScreen() {
  return (
    <CampaignsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#111521' },
        headerTintColor: '#e9eefb',
        contentStyle: { backgroundColor: '#0b0d12' },
      }}
    >
      <CampaignsStack.Screen
        name="CampaignsHome"
        options={{ title: 'Campaigns' }}
      >
        {(props: NativeStackScreenProps<CampaignsStackParamList, 'CampaignsHome'>) => (
          <CampaignsScreen
            onCreatePress={() => props.navigation.navigate('CreateCampaigns')}
            onOpenCampaign={(c) => props.navigation.navigate('Execution', { campaign: c })} // ✅ navigate to Execution
          />
        )}
      </CampaignsStack.Screen>

      <CampaignsStack.Screen
        name="CreateCampaigns"
        options={{ title: 'Create Campaign' }}
      >
        {(props: NativeStackScreenProps<CampaignsStackParamList, 'CreateCampaigns'>) => (
          <CreateCampaignsScreen
            onSaved={(c) => {
              // Option A: go straight into execution after save:
              props.navigation.replace('Execution', { campaign: c });      // ✅ jump into calling flow
              // Option B (alternative): props.navigation.replace('CampaignsHome');
            }}
          />
        )}
      </CampaignsStack.Screen>

      {/* ✅ NEW: Execution screen */}
      <CampaignsStack.Screen
        name="Execution"
        options={{ title: 'Execute Campaign' }}
      >
        {(props: NativeStackScreenProps<CampaignsStackParamList, 'Execution'>) => (
          <ExecutionScreen
            campaign={props.route.params.campaign}
            onDone={() => props.navigation.popToTop()}
          />
        )}
      </CampaignsStack.Screen>
    </CampaignsStack.Navigator>
  );
}

function QueryPlaceholder() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0d12', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#96a0b3' }}>Query tool coming next…</Text>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer theme={appTheme}>
      <Tabs.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: '#111521', borderTopColor: '#22325a' },
          tabBarActiveTintColor: '#36c48f',
          tabBarInactiveTintColor: '#96a0b3',
        }}
      >
        <Tabs.Screen name="CampaignsTab" component={CampaignsStackScreen} options={{ title: 'Campaigns', tabBarIcon: ({ color }) => <Dot color={color} /> }} />
        <Tabs.Screen name="QueryTab" component={QueryPlaceholder} options={{ title: 'Query', tabBarIcon: ({ color }) => <Dot color={color} /> }} />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}

function Dot({ color }: { color: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: color }} />;
}
