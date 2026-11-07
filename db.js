# Handwritten notes for the OCR demo (FAKE)

Write this on paper in clear BLOCK CAPITALS, take a straight-on photo in good light, and save it as `demo-notes.jpg`.
It adds facts that are NOT in the recording, so the AI has to merge both sources.

```
VISIT 07/11 - AYAAN MALIK
DX: AUTISM (DIAGNOSED AGE 4)
BOY. PAKISTANI.
PHOTO CONSENT - YES
MUM: AISHA 07700 900106
NO MEDS - MUM CONFIRMED BY PHONE
```

Once the notes are added, the plan should show: diagnosis = Autism, gender = Male, ethnicity = Pakistani, photo_consent = Yes, emergency_contact = Mum (Aisha), medication = "None (Mum confirmed by phone)".

**Demo flow:** run with the recording only (medication shows as missing in amber) → add the photo of the notes → the gaps fill in. That shows exactly why the worker stays in charge.

The same text is in `demo-notes-typed.txt` for the typed-notes feature, and as a fallback if OCR struggles with handwriting.
