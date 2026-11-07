# Demo clip (FAKE): Ayaan's mum, Sylheti

Recorded by a friend of Person B (WhatsApp mp3, saved as `ai/samples/demo-visit.mp3`).
This is **Sylheti**, which Whisper does not officially support. It is the honest test of the limit in BRIEF.md.

| English | What was said |
|---|---|
| My son's name is Ayaan. He is nine years old. | Amar futar nam Ayaan. Tar boyosh noy bosor. |
| He loves trains. He watches train videos for hours. | He train khub bala fae. Gonta gonta train er video dekhe. |
| When there are lots of people and noise, he covers his ears and gets upset. | Beshi manush ar awaz oile he kan dhaki laie, mon kharap oi zay. |
| He is allergic to eggs. He gets a rash. | Tar anda khaile allergy oy, gao dana uthe. |
| When he's upset, give him his headphones and his train book and he calms down. | Mon kharap oile tare headphone ar train er boi dile he shanto oi zay. |

## What the AI should produce
| Field | Expected |
|---|---|
| first_name | Ayaan |
| hobbies_interests | Trains, train videos |
| watch_out | Crowds and noise: covers ears, gets upset |
| allergies | Eggs (rash) |
| challenging_behaviours | Upset → headphones + train book |
| dob | **missing** (only "nine years old" is said; age is not stored) |
| medication, diagnosis, gender, ethnicity, photo_consent, surname | **missing** (filled later from the photo of the notes) |
