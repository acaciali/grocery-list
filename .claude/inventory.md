# 🥫 Inventory — Todo

**MVP:** manually log what you have
**Bonus:** 📸 photograph a shelf → AI guesses the items → confirm → bulk add
**Extra:** barcode scanning
**Owns:** `/inventory/`, `/functions/vision.js`, `/functions/barcode.js`, `inventory` collection

> ⭐ **Inventory is presence-based.** We track *whether* you have something, not how much.
> `quantity` and `unit` stay as optional fields for manual entry, but nothing in the app
> depends on them. This is a deliberate simplification and it makes the photo flow far
> more achievable — recognizing "there is peanut butter on this shelf" is reliable;
> counting jars behind other jars is not.

---

## Backend

### Data layer
- [ ] Firestore `inventory` collection per the CLAUDE.md shape
- [ ] Index on `key` — every other team queries by it
- [ ] Upsert-by-key helper: adding something you already have updates the existing row,
      never creates a duplicate. Write once, use everywhere — the photo flow leans on this hard.
- [ ] Batch upsert (`writeBatch`) — one photo can produce 15 items, don't fire 15 writes
- [ ] Security rules scoping inventory to the user
- [ ] **Export the shared read API: `has(key)` → boolean.** Grocery depends on this for I2.
      *(Changed from the earlier `hasEnough(key, qty, unit)` — tell the Grocery team.)*
- [ ] `getAllKeys()` → `string[]` for Recipe's AI generation (I5)

### 📸 Shelf photo analysis *(the bonus)*
- [ ] `POST /analyzeShelf` Cloud Function, accepts `{ image: base64, mediaType }`
- [ ] Anthropic API key in function config — **this is exactly why it's a function**
- [ ] Send as an `image` content block, base64 source
- [ ] Prompt returns **strict JSON array only** — no prose, no markdown fences:
      ```json
      [{ "name": "black beans", "brand": "Bush's", "category": "canned",
         "confidence": 0.9, "note": "partially occluded" }]
      ```
  - [ ] Instruct: only food/grocery items, ignore shelves, décor, hands, pets
  - [ ] Instruct: generic `name` for matching, `brand` separately if the label is legible
  - [ ] Instruct: skip anything too occluded or blurry to identify rather than guessing
  - [ ] Require `confidence` 0–1 per item — this drives the review UI
- [ ] Server-side: run each `name` through `normalizeKey()` before returning, so the photo
      path produces the exact same `key` as every other path ⭐
- [ ] Validate the JSON; retry once on parse failure; return a clean error shape
- [ ] Pin a specific model string from https://docs.claude.com/en/docs/about-claude/models
- [ ] Handle rate limit / timeout with a friendly message
- [ ] *(stretch)* Accept 2–4 images in one call for a multi-shelf pantry, merged and de-duped

### Barcode lookup *(extra)*
- [ ] `GET /lookupBarcode?upc=` Cloud Function
- [ ] Query Open Food Facts (free, no API key, strong on packaged goods)
- [ ] Map response → our Item shape; `categories_tags` → our `category`
- [ ] Cache hits in a `barcodes` collection — the same milk gets scanned every week
- [ ] Graceful "not found" → manual form prefilled with the UPC

---

## Frontend

### Manual logging — this is the MVP, make it fast
- [ ] `routes/inventory/` + real-time `onSnapshot` list, typed as `InventoryItem[]`
- [ ] Add form: name, category, location (pantry/fridge/freezer); quantity optional
- [ ] Autocomplete on name from previously-used items
- [ ] One-tap add for common items
- [ ] Edit and delete, delete with confirm
- [ ] Group by location, then by category
- [ ] Search and filter
- [ ] Empty state pointing at both the add form and the camera
- [ ] Show `addedVia` subtly, so a user can tell an AI guess from something they typed

### 📸 Shelf capture flow — the bonus, and the demo moment
- [ ] Big obvious "Scan a shelf" entry point
- [ ] **Two inputs: live camera *and* pick-from-library.** People photograph the pantry
      first and sort it out later on the couch. Library upload is also the only way to
      demo reliably if the venue wifi or camera permissions misbehave. Build it first.
- [ ] `getUserMedia` preview with a capture button, `facingMode: "environment"`
- [ ] **Downscale in a canvas to ~1568px long edge, JPEG quality ~0.8, before upload.**
      Raw phone photos are 4–12MB; anything over the model's native resolution gets
      downscaled server-side anyway, costing latency for no accuracy gain.
- [ ] Loading state with real feel — vision calls take a few seconds
- [ ] ⭐ **Review grid — the most important screen you will build.**
  - [ ] One card per detected item: name, category, confidence
  - [ ] Pre-check high-confidence items; leave low-confidence unchecked but visible
  - [ ] Editable name on every card (fixing a typo beats deleting and retyping)
  - [ ] Category dropdown per card
  - [ ] "Add checked to pantry" → single batch write
  - [ ] Flag items already in inventory as "already have" instead of re-adding
- [ ] Photo tips shown inline before first capture: one shelf at a time, straight on,
      labels facing out, good light. Framing guidance changes results more than prompting does.
- [ ] "Scan another shelf" that keeps the running batch, so a whole pantry is one session
- [ ] Handle zero detections and permission-denied with a path to the manual form
- [ ] `track.stop()` on unmount

### Barcode UI *(extra)*
- [ ] `BarcodeDetector` where supported (Chrome/Android), ZXing-js fallback for Safari
- [ ] On detect: beep/vibrate, lookup, prefilled confirm
- [ ] Rapid-scan mode that stays on camera and queues results
- [ ] Manual UPC entry for damaged barcodes

---

## Integration duties 🔗

- [ ] **I2 (with Grocery):** expose `has(key)` so the list can skip what you already own
- [ ] **I4 (with Grocery):** checked-off grocery items upsert into inventory with
      `addedVia: "grocery"`
  - [ ] Decide together: automatic on check-off, or a "put away groceries" confirm screen?
        (Confirm is safer — checking something off doesn't always mean you bought it.)
- [ ] **I5 (with Recipe):** `getAllKeys()` feeds AI recipe generation. Because the photo
      path already ran `normalizeKey()`, a photographed pantry works here for free. ✨

---

## Gotchas

- **`getUserMedia` requires HTTPS or `localhost`.** It fails silently on a LAN IP like
  `192.168.1.5:5173`. Use localhost or a tunnel. This costs someone an hour every time.
- **Never auto-save a vision guess.** Anthropic's docs explicitly warn against using Claude
  for tasks requiring perfect precision without human oversight. A wrong pantry entry
  silently corrupts I2 and I5 — bad data is worse than no data. The review screen is not polish.
- **Expect uneven accuracy.** Packaged goods with legible labels: strong. Loose produce,
  opaque containers, deep shelves, glare, steep angles: weak. Set expectations in the UI
  rather than promising magic, and lean on the photo tips.
- Very small images (under ~200px on an edge) degrade recognition — don't over-compress.
- Supported formats are JPEG, PNG, GIF, and WebP. HEIC from iPhones is **not** supported —
  convert during the canvas downscale step, which handles it for free.
- Cloud Functions have request-size limits. A downscaled JPEG is ~200–500KB and fine; if
  you ever want to keep originals, upload to Firebase Storage and pass a reference instead.
- Cache results per photo so re-opening a review screen doesn't re-bill an API call.
- `BarcodeDetector` is not in Safari. Feature-detect and fall back.
