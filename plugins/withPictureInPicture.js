const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Plugin que garante android:supportsPictureInPicture="true" na MainActivity.
 * O plugin do expo-video pode não injetar isso de forma confiável em todas as versões.
 */
module.exports = function withPictureInPicture(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const activities = manifest.application?.[0]?.activity ?? [];

    for (const activity of activities) {
      const name = activity.$?.['android:name'] ?? '';
      if (name === '.MainActivity' || name === 'com.saimo.tv.MainActivity') {
        activity.$['android:supportsPictureInPicture'] = 'true';
        // configChanges necessários para PiP no Android 8+
        activity.$['android:configChanges'] =
          'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|layoutDirection|density';
      }
    }

    return config;
  });
};
