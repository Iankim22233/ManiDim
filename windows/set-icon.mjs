// Embeds build-icon/icon.ico into a Windows exe (pure JS — no Wine/rcedit needed).
import * as ResEdit from 'resedit';
import { readFileSync, writeFileSync } from 'node:fs';
export function setIcon(exePath) {
  const exe = ResEdit.NtExecutable.from(readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(readFileSync('build-icon/icon.ico'));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const g = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map((i) => i.data));
  res.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
}
