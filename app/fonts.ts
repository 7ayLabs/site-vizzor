import localFont from 'next/font/local';

export const sans = localFont({
  src: '../public/fonts/InterVariable.woff2',
  variable: '--font-sans',
  display: 'swap',
  weight: '100 900',
});

export const mono = localFont({
  src: '../public/fonts/JetBrainsMono-Variable.woff2',
  variable: '--font-mono',
  display: 'swap',
  weight: '100 800',
});
