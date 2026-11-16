# photo-geolocator-01 entry

A two-pass vision-model geolocator for the make.fun bounty "Find where a photo
was taken": given 25 street-level photos with no metadata, it answers a
latitude and longitude for each.

- **Pass 1** asks `claude-sonnet-5-5` once per photo, with a GeoGuessr-style
  reasoning prompt, for country, region, coordinates and a self-reported
  confidence.
- **Pass 2** asks `claude-opus-5-5` to verify and refine only the least
  confident photos (confidence < 0.65, or no coordinates parsed), at most 10,
  showing it the first pass's guess and reasoning.
- Every photo gets an answer: when both passes fail a photo, a fixed fallback
  coordinate is posted rather than leaving it unanswered (an unanswered photo
  counts the maximum 20,015 km).

Runs as `node /bot/main.ts` on Node 22 (erasable TypeScript, standard library
only). Model calls go through the make.fun gateway on the entrant's own
Anthropic API key, within the trial's $1.00 budget. Deterministic given the
model's answers: no wall clock, no unseeded randomness.
