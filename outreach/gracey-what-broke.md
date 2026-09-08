# Everything that went wrong — Gracey Care lead engine
Source: Slack workspace (#external-dtc, #dev, #frontdesk, #facebook_leads, DMs), May–Sep 2026.
Pulled unfiltered. No judgment on which are "good" ideas.

## Tracking & attribution
1. Meta pixel fired PageView only. No Lead / CompleteRegistration event anywhere on the form page —
   the form was JS/AJAX-handled with no thank-you redirect, so no conversion event fired on submit.
   Meta had nothing to optimize against. (Jun 10)
2. The newer landing page `/echeck/fb` had no pixel at all — Pixel Helper returned "No pixels found
   on this page." Ads were pointing at an untracked page. (Jun 2)
3. No GA or GTM account existed at all until Jun 12. Created reactively, then 48h before any data.
4. HotJar showed zero traffic while ads were spending. Nobody could tell whether the ads were broken
   or the tracking was. Yishai: "the traffic dropped to zero. Are we sure something isn't broken?" (Jun 12–13)
5. Attribution dispute: a 90-day reporting window pulled ~$2K of pre-engagement spend into CAC,
   including a campaign that wasn't ours. (Jun 29 / Jul 14)

## The landing page
6. Sub-2% conversion. 150+ page views, 3 leads. Benchmark for the space is 15–20%. (Jun 14)
7. $187 spent in a day, 5–7% outbound CTR, zero form conversions. Ads worked, page bled. (Jun 10)
8. Page told visitors they'd get a callback in "24–48 hours" — directly contradicting the urgency
   the ad created. Overwhelmed adult children don't wait two days.
9. Form was 3 steps and ~12 fields on mobile, where 90%+ of traffic landed.
10. Landing-page CPL ran consistently above instant forms. LP campaigns were killed twice
    (late June, then again Aug 7) and budget moved back to forms.

## Compliance / legal on the page
11. CMS logo in the partner bar — Section 1140 violation, implies government endorsement (~$13k
    penalty per page view). AHCCCS logo, same problem at state level.
12. "Covered by their insurance" overclaim, needed softening to "covered by Original Medicare
    (cost-sharing may apply)."
13. Testimonials of unverified provenance — flagged as Meta scrutiny risk before ads resumed.
14. Broken partner logos (10.png, 11.png returned 200 but didn't render), a misspelled `/parthners/`
    folder, http:// logo URLs on an https page, WCAG AA contrast failures, © 2025 in the footer.

## The lead pipe itself
15. Slack lead alerts silently stopped. GHL was receiving leads and firing the webhook; n8n execution
    was failing because the channel had never been registered with the new Slack bot. Nothing errored
    visibly — leads just stopped appearing. (Jul 17)
16. Every time the lead source changed, someone rebuilt the workflow from scratch. Raghuveer, verbatim:
    "Things break, Heli misses leads and it takes time to fix." (Jul 9)
17. Phone numbers arriving mangled — a real lead came through as "(148) 086-8904". (Jun 9)
18. Address and DOB were present in the original payload but were never wired into the Slack alert.
    The front desk saw a ZIP and nothing else. (Jun 9)
19. Field-name mismatches between the Lovable page and GHL: `medicare_type` vs `insurance_provider`,
    `relationship_to_patient` vs `relationship_to_policy_holder`. `zip` and `care_need` arrived as
    empty strings. (Jul 17)
20. The landing page wasn't collecting ZIP or care need at all — both mandatory per Yishai.
    "Or else we don't even know why they are reaching us."
21. Facebook form leads missing ZIP because the field wasn't set to required, so state/city couldn't
    be derived, which blocked the SMS automation downstream. (Aug 4 / Aug 10)
22. Meta's pre-fill bug bypassed required custom questions. Kfir logged three "broken" leads in one
    day missing last name, care need, and insurance clarity. (May 9)
23. Meta silently "optimized" which questions users were shown, so a question stopped appearing
    without anyone changing anything. (Aug 5)
24. Repeated `LEAD PAYLOAD ISSUE` alerts firing with every field blank — Lead, Phone, Email, Source
    all "Not provided." (Jun 11, Aug 4)

## Speed to lead
25. Spruce SMS auto-alerts had to be disabled entirely because the payload lacked state, city and
    requested service. Heli sent every text by hand. (Jul 17)
26. Heli got 4 leads overnight and received no email notification at all. (Jul 7)
27. Most leads arrived 12am–11am. No auto-response existed, so a lead could sit 8+ hours before a
    human called — by then they've forgotten they filled anything out. (Jul 14)
28. Weekend pausing meant leads sat until Monday; unpausing resets Meta's learning phase and dips
    performance, so there was no clean way to avoid it. (Aug 17)

## Lead quality & qualification
29. Heli's own numbers: of every 100 leads, 10–20% Original Medicare, 10–20% Medicare Advantage,
    ~60% never connected with at all. (Jul 6)
30. People who did pick up "still sound unsure about what exactly we do and the services we provide" —
    the ad set the wrong expectation. (Jul 6)
31. Form conditional logic sent Medicare Advantage users to a dead end, but an error let MA leads
    through anyway until a qualifying feature was added. (Jul 13 / Jul 18)
32. Meta blocks lead forms from collecting a third party's contact info, so the adult child's name and
    number — the person actually making the decision — couldn't be captured on the form. (Jul 13)

## Handoff to the front desk
33. Heli couldn't find leads in Meta's Leads Center because landing-page leads bypass it entirely.
    Nobody had told her which source was which. (Jul 20)
34. Insurance verification broken: Stedi wasn't integrated with Athena, so eligibility couldn't be run
    on name + DOB alone; member ID was required. The Medicare Part B Arizona payer ID showed
    differently between Athena and Stedi. (Aug 25)
35. A cancelled appointment deleted the prepped chart along with it. (Sep 4)

## The funnel, end to end (May 5 – Jul 28)
36. 367 leads generated (371 with click-to-call).
37. ~335 logged by the front desk. **~32 leads, mostly landing page, never made it into the log at all.**
38. ~317 unique people. 18 repeat submitters, one person submitted four times. No dedupe.
39. 62 disqualified — 55 on insurance (Advantage, Humana, UHC, Aetna, Devoted, Wellcare, HealthSpring,
    BCBS, Molina), 7 out of state.
40. **Only ~62 ever reached a live conversation. 16 converted.**
41. "Qualified on paper" was ~255. "Qualified and actually confirmed by a human" was 62. The gap exists
    because ~80% of leads were never reached, so eligibility was self-reported off a form and never verified.

---

## The three that generalize
Most of the above is Gracey-specific plumbing. Three are structural and worth asking other
operators about:

- **~80% of leads never reached a live conversation.** Everything downstream is guesswork as a result.
- **~32 leads vanished between the ad and the front desk log** because one source routed differently
  than the others, and nobody noticed for weeks.
- **Overnight leads sat 8+ hours** with zero acknowledgement before a human dialed.
