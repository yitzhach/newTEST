# Shoot card — six-exposure photometric capture

Everything needed on the day. Numbers are measured, not estimated; sources are
`HANDOFF.md` §5 and `README.md` "Capture protocol".

Diagram of the six positions:
**https://claude.ai/code/artifact/3a63bda9-0db9-4730-81f7-6e629fb30a5b**

---

## 1. Lay the piece FLAT ON THE FLOOR

Not on a wall. Shot 5 puts the lamp 108″ *below* the centre of the frame, which on a
wall would mean centring the piece 9 ft off the ground. On the floor that same
position is just a lamp standing 72″ away at 72″ high.

- Piece flat, face up, on the floor.
- Camera on a tripod directly overhead, sensor parallel to the piece.
- "Out from wall" in the diagram becomes **height above the floor**.
- "Left/right" and "up/down" become horizontal distances across the floor.

---

## 2. Size the framed area to your ceiling

The tallest lamp position is `D × sin(60°)`, so the ceiling caps the lamp distance
`D`, and `D` caps how much of the piece you can frame. Error ≈ `36 × framed width ÷ D`.

| ceiling | usable height | max D | frame this wide (≈3°) | (≈4°) |
|---|---|---|---|---|
| 7 ft | 78″ | 90″ (7.5 ft) | 7.5″ | 10″ |
| 8 ft | 90″ | 104″ (8.7 ft) | 8.7″ | 11.5″ |
| 9 ft | 102″ | 118″ (9.8 ft) | 9.8″ | 13″ |
| 10 ft | 114″ | 132″ (11 ft) | 11″ | 14.5″ |
| 12 ft | 138″ | 159″ (13.3 ft) | 13.3″ | 17.7″ |

Under 5° is the target. **Do not try to frame the whole 24×30″ piece** — it would need
the lamp 25 ft out. Shoot a representative patch of surface; texture recovery does not
need the composition.

Measure your ceiling, pick the row, and use that `D` for every shot.

---

## 3. The six positions

All distances from the **centre of the framed area**, lamp at distance `D` in a
straight line. Figures below are for `D = 144″` (12 ft) — **scale them by `D ÷ 144`**.

| shot | direction | height | lamp height | horizontal from centre |
|---|---|---|---|---|
| 1 | 3 o'clock | low 30° | 72″ | 125″ |
| 2 | 1 o'clock | high 60° | 125″ | 72″ |
| 3 | 11 o'clock | low 30° | 72″ | 125″ |
| 4 | 9 o'clock | high 60° | 125″ | 72″ |
| 5 | 7 o'clock | low 30° | 72″ | 125″ |
| 6 | 5 o'clock | high 60° | 125″ | 72″ |

Clock positions are as the camera sees the frame, going anticlockwise from 3 o'clock,
60° apart. **Alternate low/high as you go round** — raising the lamp steadily was
measured at 0.55° error against 0.28°, twice as bad for nothing.

Low shots sit **wide and low**. High shots sit **close and high**. Same `D` for all six.

---

## 4. The lamp

**Beam angle: 20–30° ("narrow flood" / "medium spot").** The framed area must sit
inside the flat centre of the beam, occupying no more than the middle third of the
beam's spread — a brightness gradient across the frame is the single largest error in
this capture. At 12 ft a 25° beam covers about 64″, so a 12″ frame sits in the central
fifth. Good.

- **Too narrow** (8–10° spot): the frame fills the beam's hot centre and picks up its
  falloff.
- **Too wide** (60°+ flood): spills onto walls, ceiling and floor, and the bounce comes
  back as ambient light from the wrong direction.
- Aim at the **centre of the framed area** every time. Same aim, same output, every shot.

Other lamp requirements:

- **One lamp only.** Room lights off, blinds shut, monitors off.
- LED preferred over incandescent — no warm-up drift, no heat on the piece. Use
  high-CRI, and keep the shutter at 1/60 s or slower to avoid PWM banding.
- **Never change the dimmer, zoom, or diffusion** between shots.
- Flag spill with black cloth on nearby surfaces if the room is light-coloured.

---

## 5. Camera

- Manual everything: focus, aperture, shutter, ISO, white balance. Nothing on auto.
- Shoot raw, or JPEG at **Settings → Camera → Formats → Most Compatible**.
  HEIC cannot be decoded by the tools.
- Tripod locked. **Nothing moves between shots except the lamp** — not the camera, the
  piece, the tripod, or anything resting on it. A tripod that *rotated* is a re-shoot;
  alignment corrects sideways drift only.
- Same exposure for all six frames.

---

## 6. Measure and write it down

For each of the six positions, record with a tape measure (±1″ is plenty):

- height of the lamp above the floor
- horizontal distance from the frame centre
- which clock direction

Tape-measured positions beat any chrome ball on hand (0.7° against 1.3°), and they are
the **only** way to correct for lamp distance afterwards — a mirror ball gives a
direction and can never give a position.

A chrome ball is optional. If you use one it must be a **true sphere** — a ball bearing,
not a sculpture or a bowl. A chrome object 10% off spherical reads 4.75° wrong and
nothing in the tool detects it.

---

## 7. Before you tear down the rig

```bash
node relight/tools/plan.mjs --check <dir>
node relight/tools/score-real.mjs <dir> --preflight
```

Preflight reads the actual frames and catches reframing, a clipped or undersized
sphere, and a circle that is not on the sphere. None of that is fixable once the rig
is down. Shoot a seventh frame at any position as a spare while you are there.

---

## Quick checklist

- [ ] Piece flat on the floor, camera overhead and square
- [ ] Framed area sized to the ceiling (table in §2)
- [ ] Room dark, one lamp, 20–30° beam, aimed at frame centre
- [ ] Camera fully manual, raw or Most Compatible JPEG
- [ ] Six shots, alternating low 30° / high 60°, 60° apart
- [ ] Every lamp position tape-measured and written down
- [ ] Preflight run before anything moves
