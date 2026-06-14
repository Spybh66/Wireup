# FRC 2026 Electrical Rules — reference (R609–§8.8)

Extracted from the 2026 FRC Game Manual §8.6–8.8 (corroborated against the 2026
Inspection Checklist). Confidence high on the numeric constraints. This is a
quick reference for the wiring tool + the DRC rules it enforces.

## Key rules

- **R609** — Main power run (battery → APP SB connector → 120 A main breaker →
  power distribution device) must use **≥ 6 AWG** copper. No other devices or
  splices in this run.
- **R610 / R618** — One overcurrent device per circuit; **one wire per PD output
  terminal**.
- **R612** — Exactly one **120 A** surface-mount main breaker, externally
  accessible.
- **R615** — roboRIO powered from a **non-switched** PD channel with a **10 A**
  fuse/breaker, **dedicated** (no other load). PDH channels 20/21/22; PDP 2.0 any
  channel.
- **R616 / R617** — Radio (VH-109) powered **directly from the PD** (VRM/RPM no
  longer legal in 2026): passive PoE into the RIO port or direct 12 V, protected
  by a **10 A** breaker/fuse.
- **R619** — Branch breakers in the PD must be approved types, **≤ 40 A**.
- **R620** — PD fuses: PDH ATM ≤ 15 A (one 20 A allowed for PCM/PH); ATO/ATC
  slots ≤ 10 A.
- **R621** — One load per breaker (exception: downstream of a Kraken X60
  PowerPole adapter).
- **R622 — wire gauge ↔ breaker table:**

  | Breaker / fuse | Minimum wire |
  |---|---|
  | 40 A | 12 AWG |
  | 30 A | 14 AWG |
  | 20 A | 18 AWG |
  | ≤ 10 A | (appropriate gauge) |
  | Main run | 6 AWG |

- **R624** — Color coding: positive = red/yellow/white/brown/black-stripe;
  negative = black/blue.
- **§8.8** — RSL plugs into the roboRIO RSL port. CAN bus runs at 1 Mbit/s and is
  terminated at both ends by 120 Ω (built into roboRIO and PDH/PDP; PDP 1.0 has a
  jumper for end-of-bus).

## What the Wireup DRC enforces

| DRC rule id | FRC rule | Check |
|---|---|---|
| `undersized-gauge` | R622 | branch wire gauge ≥ table minimum for the feeding port's breaker |
| `main-run-gauge` | R609 | battery↔breaker↔PD power wires are ≥ 6 AWG |
| `breaker-too-large` | R619 | a PD output port's breaker is ≤ 40 A |
| `roborio-power-breaker` | R615 | the channel feeding the roboRIO is rated 10 A |
| `roborio-channel` | R615 | on a PDH, the roboRIO is on a non-switchable channel (CH20–CH22) |
| `channel-oversubscribed` | R610/R618/R621 | a single power port drives only one wire |
| `can-termination` | §8.8 / hardware | bus has a controller (roboRIO/CANivore) and each end is a PDH/CANivore/roboRIO or a 120Ω terminator |

A **CAN Terminator (120Ω)** component (single CAN port) is available to cap the
far end of a bus that doesn't end on a PDH/roboRIO/CANivore.

Breaker ratings are set per-port on the PD (PDH/PDP/MPM) in the component config
modal. Rules that need data the model doesn't carry (frame isolation R611,
voltage limits R614, switched-vs-non-switched channels, wire colors R624) are
left to the user; they're noted here for completeness.
