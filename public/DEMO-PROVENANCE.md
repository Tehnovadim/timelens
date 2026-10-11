# Prepared Paris example provenance

Mode: **built-in ImageGen editing**, using the local licensed sample.jpg as a reference. No OpenAI API generation was run against the owner's balance for these public assets. The preparation is separate from the deployed research/edit pipeline and does not establish its accuracy or performance.

Shared prompt constraints: one photorealistic colour interpretation; preserve the Trocadéro viewpoint, framing, horizon, tower centre, Seine bridge, Invalides dome, blue sky, sunlight and shadows; remove anachronistic vehicles, crowds, installations and distant modern buildings. The old Trocadéro palace is behind the camera and must not appear. Uncertain detail should be restrained. No sepia, borders, text or watermarks.

- **1888:** mid-July construction; first floor complete, assembly approaching the second floor, no summit or upper shaft; red Venetian iron; pre-1937 garden/cascade; restrained period pedestrians and horse cart. Revision explicitly constrained first-floor/second-floor/base locations to reduce the composition drift in the first output.
- **1900:** completed tower without a modern broadcast mast; graduated yellow-ochre colour of 1899; modest World Fair context; older Trocadéro gardens rather than the Warsaw fountain built in 1937.
- **1960:** reddish-brown paint used in 1954/1961; broadcast mast added in 1957; 1937 fountain retained; suggestions of 1950s vehicles and clothing, without future skyline blocks.

Sources: Eiffel Tower official construction/history, paint-colour chronology and height history; City of Paris account of the Trocadéro fountain. Links are included per frame in sample-result.json. These sources support dated facts, not every garden, vehicle or building detail in the generated output. All frames are labelled **limited evidence**, with visible uncertainty notes.

Output assets: paris-1888.webp, paris-1900.webp, paris-1960.webp, each 1564 × 1006, encoded from the generated PNG with WebP quality 80. paris-original.webp uses the original viewpoint; sample.webp is a 1024-pixel-wide hero copy. Compression does not add historical details.

Manual review: photographic appearance and plausible historical differences are visible. Exact garden layouts, individual people, vehicles and pixel alignment are approximate. In particular, the construction frame is a visual interpretation rather than a dated survey drawing. Use the comparison control to inspect composition. Licence and attribution: SAMPLE-LICENSE.md.
