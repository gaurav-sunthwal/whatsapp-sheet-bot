/**
 * AutoBot Pro Design System Theme Configuration
 * Built from DESIGN.md
 */

const theme = {
  colors: {
    surface: '#0b1326',
    surfaceDim: '#0b1326',
    surfaceBright: '#31394d',
    surfaceContainerLowest: '#060e20',
    surfaceContainerLow: '#131b2e',
    surfaceContainer: '#171f33',
    surfaceContainerHigh: '#222a3d',
    surfaceContainerHighest: '#2d3449',
    onSurface: '#dae2fd',
    onSurfaceVariant: '#c0c7d5',
    inverseSurface: '#dae2fd',
    inverseOnSurface: '#283044',
    outline: '#8a919e',
    outlineVariant: '#404753',
    surfaceTint: '#a6c8ff',
    primary: '#a6c8ff',
    onPrimary: '#00315f',
    primaryContainer: '#3192fc',
    onPrimaryContainer: '#002a53',
    inversePrimary: '#005fb0',
    secondary: '#41e575',
    onSecondary: '#003915',
    secondaryContainer: '#06c85d',
    onSecondaryContainer: '#004d1f',
    tertiary: '#ffb782',
    onTertiary: '#4f2500',
    tertiaryContainer: '#de7403',
    onTertiaryContainer: '#452000',
    error: '#ffb4ab',
    onError: '#690005',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    primaryFixed: '#d5e3ff',
    primaryFixedDim: '#a6c8ff',
    onPrimaryFixed: '#001c3b',
    onPrimaryFixedVariant: '#004786',
    secondaryFixed: '#66ff8e',
    secondaryFixedDim: '#3de273',
    onSecondaryFixed: '#002109',
    onSecondaryFixedVariant: '#005322',
    tertiaryFixed: '#ffdcc5',
    tertiaryFixedDim: '#ffb782',
    onTertiaryFixed: '#301400',
    onTertiaryFixedVariant: '#703800',
    background: '#0b1326',
    onBackground: '#dae2fd',
    surfaceVariant: '#2d3449',
  },
  typography: {
    displaySm: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '30px',
      fontWeight: '600',
      lineHeight: '38px',
      letterSpacing: '-0.02em',
    },
    headlineLg: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '24px',
      fontWeight: '600',
      lineHeight: '32px',
      letterSpacing: '-0.01em',
    },
    headlineMd: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '20px',
      fontWeight: '600',
      lineHeight: '28px',
    },
    bodyLg: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '16px',
      fontWeight: '400',
      lineHeight: '24px',
    },
    bodyMd: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '14px',
      fontWeight: '400',
      lineHeight: '20px',
    },
    bodySm: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '12px',
      fontWeight: '400',
      lineHeight: '18px',
    },
    monoCode: {
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      fontSize: '13px',
      fontWeight: '400',
      lineHeight: '20px',
    },
    labelCaps: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '11px',
      fontWeight: '700',
      lineHeight: '16px',
      letterSpacing: '0.05em',
    },
  },
  rounded: {
    sm: '0.125rem',
    default: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    full: '9999px',
  },
  spacing: {
    sidebarWidth: '240px',
    toolbarHeight: '56px',
    gutter: '1rem',
    containerPadding: '1.5rem',
    stackGap: '0.75rem',
  }
};

// Inject theme properties as CSS variables on document load
function injectTheme() {
  const root = document.documentElement;
  
  // Inject colors
  Object.entries(theme.colors).forEach(([key, val]) => {
    // Convert camelCase to kebab-case
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    root.style.setProperty(`--color-${cssKey}`, val);
  });
  
  // Inject rounded
  Object.entries(theme.rounded).forEach(([key, val]) => {
    root.style.setProperty(`--rounded-${key}`, val);
  });
  
  // Inject spacing
  Object.entries(theme.spacing).forEach(([key, val]) => {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    root.style.setProperty(`--spacing-${cssKey}`, val);
  });
  
  // Inject typography as utility variable packs if helpful
  Object.entries(theme.typography).forEach(([key, styleObj]) => {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    Object.entries(styleObj).forEach(([prop, val]) => {
      const propKey = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      root.style.setProperty(`--font-${cssKey}-${propKey}`, val);
    });
  });
  
  console.log('✅ AutoBot Pro theme injected successfully!');
}

// Run injection when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectTheme);
} else {
  injectTheme();
}

// Export for commonJS or browser globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = theme;
} else {
  window.theme = theme;
}
