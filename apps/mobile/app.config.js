module.exports = {
  expo: {
    name: "StrideClash",
    slug: "runwars-v2",
    version: "2.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0D0D1A"
    },
    plugins: [
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: "StrideClash needs your location to track your runs and claim territory.",
          locationAlwaysPermission: "StrideClash needs background location to track runs while the app is minimized.",
          locationWhenInUsePermission: "StrideClash needs your location to show you on the map."
        }
      ],
      "expo-splash-screen",
      "expo-sharing"
    ],
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.runwars.v2",
      config: {
        googleMapsApiKey: "YOUR_IOS_GOOGLE_MAPS_API_KEY"
      },
      infoPlist: {
        NSLocationAlwaysAndWhenInUseUsageDescription: "StrideClash needs your location to track your runs and claim territory.",
        NSLocationWhenInUseUsageDescription: "StrideClash needs your location to show you on the map.",
        NSLocationAlwaysUsageDescription: "StrideClash needs background location to track runs while the app is minimized."
      }
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#0D0D1A",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png"
      },
      package: "com.runwars.v2",
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || "./google-services.json",
      config: {
        googleMaps: {
          apiKey: "AIzaSyBKnrhiRW5WggGI32BrOntEaxXp4nB39S4"
        }
      },
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION"
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    extra: {
      eas: {
        projectId: "d957dd92-6e79-494f-9173-b05d21ebe446"
      }
    },
    owner: "yash0909090"
  }
};
