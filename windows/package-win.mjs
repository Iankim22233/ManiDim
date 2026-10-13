import { packager } from '@electron/packager';
import { writeFileSync, cpSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { setIcon } from './set-icon.mjs';

rmSync('release', { recursive: true, force: true });
const keep = (f) => f === '' || f === '/package.json' || f === '/electron' || f.startsWith('/electron/') || f === '/dist' || f.startsWith('/dist/');
const paths = await packager({
  dir: '.', name: 'ManiDim', platform: 'win32', arch: ['x64', 'arm64'], out: 'release', overwrite: true, asar: true, prune: false,
  appVersion: '1.0.0', ignore: (f) => !keep(f), quiet: false,
});
const readme = `ManiDim for Windows
====================

Run ManiDim.exe (no install needed).

* Windows may show a "Windows protected your PC" box because the app isn't code-signed:
  click "More info" -> "Run anyway".
* Default keys: D F J K for a 4-lane song (every lane count has its own layout), and the
  LEFT / RIGHT CTRL keys for slide notes. Everything can be changed in Settings -> Controls.
* F11 toggles full screen. Esc pauses.
* Songs, scores and settings are stored in your user profile (AppData\\Roaming\\ManiDim).
* If the game feels late or early, use Settings -> Gameplay -> Calibrate.
* In a VM: give it 2+ CPU cores and enable 3D acceleration if you can; sound needs the
  virtual sound card enabled.

Custom songs: Create -> import an audio file (or a blank metronome), then chart it in the editor.
.madim packages (a renamed zip) can be exported/imported.
osu!mania beatmaps import too: Songs > Import, then pick an .osz (whole set), or the .osu file(s) plus the beatmap's audio file
together (open the beatmap folder in the picker and press Ctrl+A). Every difficulty becomes a chart, each with its own key count.
See CHART_FORMAT.md for the text chart format.
`;
for (const p of paths) {
  setIcon(`${p}/ManiDim.exe`);
  writeFileSync(`${p}/README-Windows.txt`, readme);
  cpSync('CHART_FORMAT.md', `${p}/CHART_FORMAT.md`);
  const name = p.split('/').pop();
  execSync(`cd release && ditto -c -k --keepParent "${name}" "${name}.zip"`);
}
for (const f of readdirSync('release')) console.log(f, f.endsWith('.zip') ? `${Math.round(statSync('release/' + f).size / 1048576)} MB` : '');
