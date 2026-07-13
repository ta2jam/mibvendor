# Demand validation operations

This runbook turns the prepared research material into auditable gate evidence.
It does not replace participants, elapsed use, or external integrations.

## Before recruitment

1. Set an accountable deletion/contact route in `consent-privacy.md` and obtain
   explicit approval of that notice.
2. Approve recruitment channels and incentive terms. Apply the same terms to
   each segment; do not condition payment on favorable feedback.
3. Freeze one prototype release for all initial sessions. Record only opaque
   participant IDs in this repository. Keep identity, contact, recordings, and
   raw notes in access-controlled storage outside Git.

## Evidence workflow

1. Add a qualified, consenting participant to `validation-evidence.json`.
2. Run the fixed tasks in `validation-tasks.md` using the moderation rules in
   `interview-guide.md`.
3. Store a sanitized score artifact outside the public repository and record
   its immutable reference. Do not record a claimed time loss without a
   concrete last-real-case duration.
4. Record a second real-task attempt only when it happens 1–14 calendar days
   after the initial session. Intent to return is not repeat use.
5. Count an API integration only when an external developer exercises H1, H2,
   or H3 and supplies a code or test artifact. Verbal acceptance is not an
   integration.
6. Run `npm run check:demand`. A non-passing gate is a valid result; malformed,
   duplicate, unsupported, or privacy-leaking evidence is an error.

The validator is `O(P + S + R + I)` in records and uses sets/maps with the same
linear memory bound. The expected Phase 0 data is tiny; auditability, not
runtime cost, is the controlling constraint.
