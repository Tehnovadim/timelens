# TimeLens — one photo, three eras

Live demo: https://timelens-511210.web.app/

Source code: https://github.com/Tehnovadim/timelens

TimeLens is a camera into the history of a place. Photograph a building or street, choose three years, and explore researched AI reconstructions on a timeline. The original photo anchors the viewpoint, weather and lighting. A comparison slider helps users inspect the changes.

The historical pipeline identifies the place using the photograph and GPS, searches the web, checks that source links were actually retrieved, and performs bounded follow-up research for missing periods. It distinguishes direct documentation, partial evidence and insufficient evidence. Years before photography can use drawings, written history and archaeology. Each era keeps its own sources, dates and uncertainty notes. Unsupported scenes are clearly marked.

After research, the three image edits run in parallel. Sources appear first, then each ready frame becomes available while the others are still processing. Firebase Hosting, Cloud Functions, Cloud Tasks, Firestore and private Storage support queued jobs and a private history. Server-side authentication, ownership checks, independent allowances and duplicate-request reuse control access and costs. The key is held in Secret Manager.

The live app uses OpenAI web research and image editing. A free prepared Paris example contains three AI interpretations and linked evidence, available without signing in. It was created separately with built-in ImageGen from an openly licensed photograph; it is not a production accuracy benchmark. Fine detail and alignment are approximate.

The interface supports English and Russian, light and dark themes, remembered settings, camera capture, GPS metadata, historical sources and an animated timeline. Guest generation does not depend on Google OAuth access.

TimeLens is intended for curious walkers, students and travellers: it connects everyday places to historical evidence without presenting generated imagery as an archival photograph.
