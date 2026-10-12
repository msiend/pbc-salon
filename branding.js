import { existsSync } from 'node:fs';
// Serve original attachments as supplied. No logo recreation or image conversion.
export function brandAssets() {
  const find = name => {
    const extension = ['webp', 'png', 'jpg', 'jpeg'].find(ext => existsSync(`public/brand/${name}.${ext}`));
    return extension ? `/brand/${name}.${extension}` : '';
  };
  return { logo: find('logo'), hero: find('exterior-night'), day: find('exterior-day'), interior: find('interior') };
}
