import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

/**
 * HD Photorealistic Image Renderer for Stones.
 */
export const StoneIcon = ({ imageSource, size = 64, isLocked = false }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image 
        source={imageSource}
        style={[
          styles.image,
          { 
            width: size, 
            height: size,
            // Increased opacity so they don't vanish into the black background
            opacity: isLocked ? 0.5 : 1 
          }
        ]}
        resizeMode="contain"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  image: {
    borderRadius: 8,
  }
});
