# Demo visit recording script (FAKE): new child "Ayaan Malik"

Record this as `demo-visit.wav` (16 kHz mono if possible, about 1.5 minutes). Two people:
- **FW** = family worker
- **P** = parent (Ayaan's mum)

Lines marked **[Urdu]** or **[Bengali]**: say the English meaning naturally in that language, as a parent really would. Switch language at sentence boundaries; that's what Whisper handles best.

The script deliberately **never mentions medication**. The AI must flag it as *missing* rather than guess. That's your demo moment.

---

**FW:** Before we start, are you happy for me to record this meeting so I can write Ayaan's care plan? The recording is deleted once the plan is done.
**P:** Yes, that's fine.

**FW:** Great. So Ayaan's date of birth?
**P:** Fourteenth of March, 2017. He's nine.

**FW:** And what does he love doing?
**P:** **[Urdu]** He loves trains, he can watch train videos for hours. And swimming, he's very calm in water.

**FW:** Anything we should watch out for?
**P:** Crowds. **[Urdu]** When there are lots of people and noise, he covers his ears and starts rocking. Then he needs a quiet corner.

**FW:** How does he communicate?
**P:** He has a few words. "Choo-choo" means he wants the train. If he says "finish", he wants to stop whatever he is doing. **[Bengali]** At home with his grandmother he understands Bengali too.

**FW:** And mobility?
**P:** He walks fine, but he runs off if he sees a train. You have to hold his hand near roads.

**FW:** Toileting?
**P:** He's toilet trained but needs reminding, and help with wiping.

**FW:** Food and allergies?
**P:** **[Urdu]** He's allergic to eggs, he gets a rash. And he only eats halal.

**FW:** Any behaviours that can be challenging?
**P:** If he's upset he sometimes hits his head on the wall. We give him his headphones and his train book and he calms down.

**FW:** Thank you, that's really helpful.

---

## What the AI should produce (use this to check the output)
| Field | Expected |
|---|---|
| dob | 2017-03-14 |
| hobbies_interests | Trains (videos), swimming |
| watch_out | Crowds and noise: covers ears, rocks, needs a quiet corner |
| communication | A few words; understands Bengali at home |
| words_phrases | "choo-choo" = wants the train, "finish" = wants to stop |
| physical_mobility | Walks independently, runs off near trains: hold hand near roads |
| toileting | Toilet trained, needs reminders and help wiping |
| allergies | **Eggs (rash)** |
| dietary | Halal |
| challenging_behaviours | Head-banging when upset → headphones + train book |
| medication | **status: missing** (never mentioned) |
| diagnosis, gender, ethnicity, photo_consent, surname | **status: missing** (not said) |
