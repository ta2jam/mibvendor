# 30-minute interview guide

Goal: recover the participant’s last real workflow, cost, failure modes, and decision criteria before showing a concept. Do not sell the product or ask whether the idea “sounds useful.”

## 0:00–2:00 — consent and setup

- Confirm participant ID, segment, note/recording consent, and right to stop.
- Confirm that no credentials, live customer identifiers, proprietary MIBs, or unsanitized walks will be shown.
- Say: “We are testing the problem and prototype, not you. I may remain silent while you work.”

## 2:00–10:00 — last real case

Ask in this order:

1. “Tell me about the last time you needed to find or understand an OID/MIB. Start before you opened the first tool.”
2. “What concrete output did you need?”
3. “What did you try, in order? Show history/artifacts if safe.”
4. “Where did you hesitate, backtrack, ask for help, or switch tools?”
5. “What was the result, and how did you verify it against the device?”
6. “How much active time and elapsed time did it consume? What else was delayed?”
7. “What would a wrong answer have caused?”
8. “How often has a materially similar task occurred in the last 90 days?”

Do not convert vague pain into a number. Record `unknown` when the participant cannot support an estimate.

## 10:00–14:00 — alternatives and boundaries

1. “Which sites, CLIs, desktop/mobile tools, vendor portals, support channels, or code did you use?”
2. “What did each tool do well enough that you would keep using it?”
3. “Why did you switch or stop?”
4. “Which data are you forbidden or unwilling to upload?”
5. “For this task, what must come from an official/traceable source?”
6. API/tool developers: “What contract, versioning, caching, and error behavior does your integration require?”

## 14:00–25:00 — moderated task test

- Assign the persona-appropriate tasks from `validation-tasks.md`.
- Read the scenario only. Do not name UI controls or explain SNMP.
- Record time, completion, wrong turns, assistance, confidence, evidence used, and whether the result would be shipped/used.
- If stuck for 90 seconds, ask: “What are you looking for?” This is neutral probing, not help.
- Stop a task at its time limit and mark it incomplete; do not let one task consume the session.

## 25:00–28:00 — repeat-use test

This is not satisfied by verbal intent.

1. “Do you have another real task in the next 14 days for which you would choose to use this prototype?”
2. If yes, schedule an opt-in follow-up and issue a participant-specific, privacy-preserving usage code.
3. Ask what result must be delivered and how success will be verified.

A participant counts toward repeat use only after a later, unprompted or scheduled real-task return is observed and the task is completed/attempted—not because they say they would return.

## 28:00–30:00 — close

- “What is the most dangerous way this could give you a convincing but wrong answer?”
- “What would prevent you from using it in real work?”
- Confirm deletion/retention request and incentive process.
- Do not solicit feature wishlists until the core task and failure evidence are recorded.

## Interviewer anti-bias rules

- Do not reveal the founder’s dissatisfaction claim before task testing.
- Do not compare against a deliberately crippled competitor flow.
- Rotate task order within each segment where dependency permits.
- Use the same prototype build/data release for comparable sessions.
- Record observation separately from interpretation.
- A participant’s seniority does not convert an opinion into measured demand.
