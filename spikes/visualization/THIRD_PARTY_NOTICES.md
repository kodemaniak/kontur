# Third-party notices

Kontur-authored spike code is MIT-licensed; see the repository `LICENSE`. The packaged artifact also contains third-party code and is **not** MIT-only. The notices and full license texts below apply to the bundled viewer and layout worker. Exact dependency resolution is pinned by `package-lock.json`.

## Bundled runtime dependencies

| Package | Version | License | Included license text |
| --- | ---: | --- | --- |
| `@xyflow/react` | 12.12.0 | MIT | `LICENSES/xyflow__react12.12.0_MIT.txt` |
| `@xyflow/system` | 0.0.83 | MIT | `LICENSES/xyflow__system0.0.83_MIT.txt` |
| `classcat` | 5.0.5 | MIT | `LICENSES/classcat5.0.5_MIT.txt` |
| `d3-color` | 3.1.0 | ISC | `LICENSES/d3-color3.1.0_ISC.txt` |
| `d3-dispatch` | 3.0.1 | ISC | `LICENSES/d3-dispatch3.0.1_ISC.txt` |
| `d3-drag` | 3.0.0 | ISC | `LICENSES/d3-drag3.0.0_ISC.txt` |
| `d3-ease` | 3.0.1 | BSD-3-Clause | `LICENSES/d3-ease3.0.1_BSD-3-Clause.txt` |
| `d3-interpolate` | 3.0.1 | ISC | `LICENSES/d3-interpolate3.0.1_ISC.txt` |
| `d3-selection` | 3.0.0 | ISC | `LICENSES/d3-selection3.0.0_ISC.txt` |
| `d3-timer` | 3.0.1 | ISC | `LICENSES/d3-timer3.0.1_ISC.txt` |
| `d3-transition` | 3.0.1 | ISC | `LICENSES/d3-transition3.0.1_ISC.txt` |
| `d3-zoom` | 3.0.0 | ISC | `LICENSES/d3-zoom3.0.0_ISC.txt` |
| `elkjs` | 0.12.1 | EPL-2.0 (selected from `EPL-2.0 OR GPL-3.0-or-later`) | `LICENSES/elkjs0.12.1_EPL-2.0_OR_GPL-3.0-or-later.txt` |
| `react` | 19.3.1 | MIT | `LICENSES/react19.3.1_MIT.txt` |
| `react-dom` | 19.3.1 | MIT | `LICENSES/react-dom19.3.1_MIT.txt` |
| `scheduler` | 0.28.0 | MIT | `LICENSES/scheduler0.28.0_MIT.txt` |
| `use-sync-external-store` | 1.7.0 | MIT | `LICENSES/use-sync-external-store1.7.0_MIT.txt` |
| `zustand` | 4.5.7 | MIT | `LICENSES/zustand4.5.7_MIT.txt` |

These versions and license expressions were checked from the pinned npm dependency tree using `license-checker-rseidelsohn`; development-only tools and declaration packages are not shipped in the VSIX.

## ELK.js corresponding source

ELK.js `0.12.1` is distributed under EPL-2.0 or GPL-3.0-or-later; this artifact elects EPL-2.0. Its source at the exact npm `gitHead` is available at <https://github.com/kieler/elkjs/tree/624ae90aa37110033a8af59c5ccbb292708b4317>, and the versioned npm source package is <https://registry.npmjs.org/elkjs/-/elkjs-0.12.1.tgz>. ELK.js is bundled in `dist/webview/layout-worker.js`; it has not been modified for this spike. If a distributed build modifies ELK.js, distribute the corresponding modified source under EPL-2.0 with that build and identify the changes here.
