# Credits & Lizenzen / Credits & licences

## Code, Karte, Waffen, Arme, prozeduraler Operator, HUD-Icons
Eigenentwicklung für dieses Projekt (Three.js r187, MIT – © three.js authors).
Alle Waffen-, Arm- und Kartenmodelle sowie Texturen werden zur Laufzeit prozedural erzeugt.

## Sounds
**Schüsse (MP5 / Sniper)** – aufgenommene Schüsse aus
*The Free Firearm Sound Library* (Kickstarter-Projekt 2013, „Prepared SFX Library“),
Lizenz **CC0 1.0** (Public Domain) – https://opengameart.org/content/the-free-firearm-sound-library

| Datei | Quelle (Datei / Waffe) | Bearbeitung |
|---|---|---|
| `Assets/Sounds/mp5_shot_1..3.wav` | `G_31P.wav` – Carl Gustav M45 („Swedish K“), 9×19 mm, near | geschnitten, Fade-out, Kompression, Peak-Normalisierung, mono 44.1 kHz |
| `Assets/Sounds/sn_shot_1..2.wav` | `W_29P.wav` – Tikka T3, .30-06, Repetierer, near | geschnitten, Fade-out, Kompression, Peak-Normalisierung, mono 44.1 kHz |

Die Aufnahmen werden im Spiel mit dem prozedural synthetisierten Körper-Layer gemischt.
Alle übrigen Sounds (Nachladen, Verschluss, Schritte, Rutschen, Einschläge, UI, Platten, Umgebung) werden mit
WebAudio prozedural synthetisiert. **Keine** Original-Sounds aus Call of Duty / Warzone (urheberrechtlich geschützt).

## Operator-Modell (`Assets/Characters/operator.glb`)
„S.W.A.T. Operator – Remastered“ von **SpatialNeglect**
https://www.fab.com/listings/18137ff5-0cb6-49da-a7ae-21b21562ce0a – Lizenz **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/)

Enthaltene Komponenten laut Original-Credits: **bobeer**, **VassKacsoHunor**, **Simon Coenen**, **Bzovius**, **Albin**, **Shedmon**, **h1ggs**.

Änderungen (mit `tools/optimize-operator.mjs`): mitgelieferte Waffe (KSVR) entfernt, Ruhepose der Knochen aus den
Inverse-Bind-Matrizen rekonstruiert (der Export hatte alle Knochen im Ursprung), Polygonreduktion 50.9k → 40k Dreiecke,
Texturen 4K → 2K KTX2 (ETC1S; Normal-Maps 1K UASTC), Meshopt-Kompression: 96.5 MB → 4.85 MB.
Animation per Laufzeit-Retargeting auf das prozedurale Bewegungs-Rig. Fallback ohne Datei / mit `?nooperator`: prozeduraler v3-Operator.

## Decoder-Bibliotheken (nur geladen, wenn ein GLB sie benötigt)
`Assets/libs/draco/` – Draco (Apache-2.0, Google) · `Assets/libs/basis/` – Basis Universal Transcoder (Apache-2.0, Binomial)
· Meshopt-Decoder (MIT, Arseny Kapoulkine) – alle über three.js ausgeliefert.
