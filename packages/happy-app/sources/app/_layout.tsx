import 'react-native-quick-base64';
import '@/encryption/ed25519.setup';
import '../theme.css';
import * as React from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Fonts from 'expo-font';
import * as Notifications from 'expo-notifications';
import { FontAwesome, FontAwesome6, Ionicons, Octicons, MaterialCommunityIcons, AntDesign } from '@expo/vector-icons';
import { AuthCredentials, TokenStorage } from '@/auth/tokenStorage';
import { AuthProvider } from '@/auth/AuthContext';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SidebarNavigator } from '@/components/SidebarNavigator';
import sodium from '@/encryption/libsodium.lib';
import { AppState, View, Platform } from 'react-native';
import { ModalProvider } from '@/modal';
import { PostHogProvider } from 'posthog-react-native';
import { tracking } from '@/track/tracking';
import { sync, syncRestore } from '@/sync/sync';
import { resetBadgeCount } from '@/sync/apiPush';
import { useTrackScreens } from '@/track/useTrackScreens';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { FaviconPermissionIndicator } from '@/components/web/FaviconPermissionIndicator';
import { CommandPaletteProvider } from '@/components/CommandPalette/CommandPaletteProvider';
import { StatusBarProvider } from '@/components/StatusBarProvider';
import { ToastHost } from '@/components/Toast';
// import * as SystemUI from 'expo-system-ui';
import { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } from '@/utils/remoteLogger';
import { useUnistyles } from 'react-native-unistyles';
import { AsyncLock } from '@/utils/lock';
import { storage } from '@/sync/storage';
import { usePathname, useRouter } from 'expo-router';
import { useDootaskGlobalWebSocket } from '@/hooks/useDootaskGlobalWebSocket';
import { registerBackgroundFetch, checkPendingSessionsOnForeground } from '@/utils/backgroundTask';

let currentAppState: string = AppState.currentState;
let currentSessionId: string | null = null;

function getNotificationSessionId(notification: Notifications.Notification): string | null {
  const data = notification.request?.content?.data;
  if (!data || typeof data !== 'object') {
    return null;
  }
  const sessionId = (data as Record<string, unknown>).sessionId;
  return typeof sessionId === 'string' ? sessionId : null;
}

function shouldHideForegroundNotification(notification: Notifications.Notification): boolean {
  if (currentAppState !== 'active') {
    return false;
  }

  const { localSettings } = storage.getState();

  if (localSettings.hideNotificationsWhenActive) {
    return true;
  }

  if (!localSettings.hideSessionNotificationsWhenActive) {
    return false;
  }

  const notificationSessionId = getNotificationSessionId(notification);
  return !!notificationSessionId && notificationSessionId === currentSessionId;
}

// Mute all notification sounds while a voice conversation is active
// to avoid audio interference. Notifications still display normally.
function shouldMuteNotificationSound(): boolean {
  return currentAppState === 'active' && storage.getState().realtimeStatus === 'connected';
}

function getSessionIdFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) {
    return null;
  }
  const match = pathname.match(/\/session\/([^/]+)/);
  if (!match) {
    return null;
  }
  const candidate = decodeURIComponent(match[1]);
  // Static routes under /session are not actual conversation pages.
  if (candidate === 'recent' || candidate === 'claude') {
    return null;
  }
  return candidate;
}

// Configure notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const shouldHide = shouldHideForegroundNotification(notification);
    const shouldMute = shouldMuteNotificationSound();
    return {
      shouldShowAlert: !shouldHide,
      shouldPlaySound: !shouldHide && !shouldMute,
      shouldSetBadge: !shouldHide,
      shouldShowBanner: !shouldHide,
      shouldShowList: !shouldHide,
    };
  },
});

// Setup Android notification channel (required for Android 8.0+)
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
  });
}

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

// Configure splash screen
SplashScreen.setOptions({
  fade: true,
  duration: 300,
})
SplashScreen.preventAutoHideAsync();

// Set window background color - now handled by Unistyles
// SystemUI.setBackgroundColorAsync('white');

// NEVER ENABLE REMOTE LOGGING IN PRODUCTION
// This is for local debugging with AI only
// So AI will have all the logs easily accessible in one file for analysis
if (!!process.env.PUBLIC_EXPO_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
  monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds()
}

// Component to apply horizontal safe area padding
function HorizontalSafeAreaWrapper({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, paddingLeft: insets.left, paddingRight: insets.right }}>
      {children}
    </View>
  );
}

// Font loading with retry
const allFonts = {
  'FontAwesome6FreeSolid': require('@expo/vector-icons/fonts/FontAwesome6_Solid.ttf'),
  'FontAwesome6FreeRegular': require('@expo/vector-icons/fonts/FontAwesome6_Regular.ttf'),
  'FontAwesome5FreeSolid': require('@expo/vector-icons/fonts/FontAwesome5_Solid.ttf'),
  'FontAwesome5FreeRegular': require('@expo/vector-icons/fonts/FontAwesome5_Regular.ttf'),
  'FontAwesome5ProSolid': require('@expo/vector-icons/fonts/FontAwesome5_Solid.ttf'),
  'FontAwesome5ProRegular': require('@expo/vector-icons/fonts/FontAwesome5_Regular.ttf'),
  'FontAwesome5ProLight': require('@expo/vector-icons/fonts/FontAwesome5_Regular.ttf'),
  'FontAwesome': require('@expo/vector-icons/fonts/FontAwesome.ttf'),
  'FontAwesomeBrands': require('@expo/vector-icons/fonts/FontAwesome5_Brands.ttf'),
  'Ionicons': require('@expo/vector-icons/fonts/Ionicons.ttf'),
  'Octicons': require('@expo/vector-icons/fonts/Octicons.ttf'),
  'MaterialCommunityIcons': require('@expo/vector-icons/fonts/MaterialCommunityIcons.ttf'),
  'AntDesign': require('@expo/vector-icons/fonts/AntDesign.ttf'),
};

async function loadFontsWithRetry(retries = 3, delay = 1000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await Fonts.loadAsync(allFonts);
      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

let loaded = false;
async function loadFonts() {
  if (loaded) return;
  loaded = true;

  // Check if running in Tauri
  const isTauri = Platform.OS === 'web' && typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
  if (!isTauri) {
    // Handle slow networks where FontFaceObserver's 6s timeout may fire
    await loadFontsWithRetry();
  } else {
    // For Tauri, skip Font Face Observer as fonts are loaded via CSS
    console.log('Do not wait for fonts to load');
    (async () => {
      try {
        await Fonts.loadAsync(allFonts);
      } catch (e) {
        // Ignore
      }
    })();
  }
}

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      currentAppState = nextState;
      // Clear badge when app comes to foreground or goes to background
      if (nextState === 'active' || nextState === 'background') {
        Notifications.setBadgeCountAsync(0);
        const credentials = sync.getCredentials();
        if (credentials) {
          resetBadgeCount(credentials);
        }
      }
      // Check for pending sessions when app comes to foreground
      if (nextState === 'active') {
        checkPendingSessionsOnForeground().catch(() => {});
      }
    });

    // Register background fetch task
    registerBackgroundFetch().catch(() => {});

    return () => {
      subscription.remove();
    };
  }, []);

  React.useEffect(() => {
    const newSessionId = getSessionIdFromPath(pathname);
    if (currentSessionId && !newSessionId) {
      sync.onSessionHidden();
    }
    currentSessionId = newSessionId;
  }, [pathname]);

  // Handle notification tap: navigate to the relevant session.
  // Covers both foreground taps and cold-start (app launched via notification).
  React.useEffect(() => {
    if (!initState) return;

    function handleNotificationResponse(response: Notifications.NotificationResponse | null) {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown>;
      const sessionId = typeof data?.sessionId === 'string' ? data.sessionId : null;
      if (!sessionId) return;
      router.push(\`/session/\${encodeURIComponent(sessionId)}\`);
    }

    // Foreground / background tap
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);

    // Cold-start: app was launched by tapping the notification
    Notifications.getLastNotificationResponseAsync()
      .then(handleNotificationResponse)
      .catch(() => {});

    return () => subscription.remove();
  }, [initState, router]);

  const { theme } = useUnistyles();
  const navigationTheme = React.useMemo(() => {
    if (theme.dark) {
      return {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: theme.colors.groupped.background,
        }
      }
    }
    return {
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: theme.colors.groupped.background,
      }
    };
  }, [theme.dark]);

  //
  // Init sequence
  //
  const [initState, setInitState] = React.useState<{ credentials: AuthCredentials | null } | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        await loadFonts();
        await sodium.ready;
        const credentials = await TokenStorage.getCredentials();
        console.log('credentials', credentials);
        if (credentials) {
          await syncRestore(credentials);
        }
        setInitState({ credentials });
      } catch (error) {
        console.error('Error initializing:', error);
      }
    })();
  }, []);

  React.useEffect(() => {
    if (initState) {
      setTimeout(() => {
        SplashScreen.hideAsync();
      }, 100);
    }
  }, [initState]);

  // Track the screens
  useTrackScreens()

  // Global DooTask WebSocket connection
  useDootaskGlobalWebSocket();

  //
  // Not inited
  //
  if (!initState) {
    return null;
  }

  //
  // Boot
  //
  let providers = (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <BottomSheetModalProvider>
            <AuthProvider initialCredentials={initState.credentials}>
              <ThemeProvider value={navigationTheme}>
                <StatusBarProvider />
                <ModalProvider>
                  <CommandPaletteProvider>
                    <RealtimeProvider>
                      <HorizontalSafeAreaWrapper>
                        <SidebarNavigator />
                      </HorizontalSafeAreaWrapper>
                    </RealtimeProvider>
                  </CommandPaletteProvider>
                </ModalProvider>
                <ToastHost />
              </ThemeProvider>
            </AuthProvider>
          </BottomSheetModalProvider>
        </GestureHandlerRootView>
      </KeyboardProvider>
    </SafeAreaProvider>
  );

  if (tracking) {
    providers = (
      <PostHogProvider client={tracking}>
        {providers}
      </PostHogProvider>
    );
  }

  return (
    <>
      <FaviconPermissionIndicator />
      {providers}
    </>
  );
}
