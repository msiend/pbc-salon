import { existsSync, readFileSync } from 'node:fs';
export function logoSource(db) {
  const stored=db.prepare("SELECT display FROM assets WHERE name='logo'").get();
  if(stored) return Buffer.from(stored.display);
  for(const ext of ['png','webp','jpg','jpeg']) if(existsSync(`public/brand/logo.${ext}`)) return readFileSync(`public/brand/logo.${ext}`);
  return null;
}
export function brandAssets(db) {
  const find=name=>{const ext=['webp','png','jpg','jpeg'].find(ext=>existsSync(`public/brand/${name}.${ext}`));return ext?`/brand/${name}.${ext}`:'';};
  const stored=db.prepare("SELECT updated_at FROM assets WHERE name='logo'").get();
  return {logo:stored?`/assets/logo?v=${stored.updated_at}`:find('logo'),hero:find('exterior-night'),day:find('exterior-day'),interior:find('interior')};
}
