/**
 * 📸 POST /analyzeShelf -- shelf photo → candidate inventory items.
 *
 * Lives in a Cloud Function because the Anthropic API key is a secret; anything in
 * browser JS is public. The frontend downscales to ~1568px long edge before sending
 * (larger is downscaled server-side anyway; edges under ~200px degrade recognition).
 *
 * Output is a SUGGESTION, not a fact: candidates must go through the review grid and
 * are never written straight to Firestore.
 *
 * Pure request/response logic lives in shelf.ts, where it is unit tested.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import type { AnalyzeShelfResponse } from '@grocery/shared/types';
import { DEMO_CANDIDATES, toShelfCandidates, validateShelfRequest } from './shelf';

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

/**
 * Pinned per repo convention -- pick explicitly from
 * https://docs.claude.com/en/docs/about-claude/models rather than guessing.
 */
const MODEL = 'claude-opus-5';

const CATEGORIES = [
  'produce', 'dairy', 'meat', 'seafood', 'bakery', 'pantry',
  'canned', 'frozen', 'spices', 'beverages', 'other',
] as const;

/**
 * What we ask the model to produce. Enforced by the API via structured outputs
 * (output_config.format), not by hoping the prompt is followed.
 */
const ShelfSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe('Generic item name for matching, e.g. "black beans"'),
      brand: z.string().nullable().describe('Brand if the label is clearly legible, else null'),
      category: z.enum(CATEGORIES),
      confidence: z.number().min(0).max(1),
      note: z.string().nullable().describe('Caveats, e.g. "partially occluded"'),
    }),
  ),
});

const SYSTEM_PROMPT = `You identify grocery items in photos of kitchen shelves, pantries, fridges, and freezers.

Rules:
- Only report food and grocery items. Ignore shelves, containers you cannot identify the contents of, decor, hands, pets, and appliances.
- Use a generic name suited to matching across apps ("black beans", "olive oil"). Put a brand in the brand field only when the label is clearly legible.
- Skip anything too occluded, blurry, or distant to identify confidently rather than guessing.
- Give each item a confidence between 0 and 1 reflecting how sure you are of the identification.
- Report each distinct product once, even if several units are visible.`;

export const analyzeShelf = onRequest(
  { cors: true, secrets: [anthropicApiKey], timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST with a JSON body of { image, mediaType }.' });
      return;
    }

    const validated = validateShelfRequest(req.body);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const { image, mediaType } = validated.value;

    // Demo mode: skip the model call and return a fixture. The photo is still uploaded,
    // downscaled, validated, normalized and written for real -- only identification is
    // faked. Flagged `stubbed` so the UI can label it; never enable this in production.
    if (process.env.SHELF_DEMO_MODE === 'true') {
      const demo: AnalyzeShelfResponse = {
        items: toShelfCandidates([...DEMO_CANDIDATES]),
        model: 'demo-fixture',
        stubbed: true,
      };
      res.json(demo);
      return;
    }

    const client = new Anthropic({ apiKey: anthropicApiKey.value() });

    try {
      // One retry on a malformed parse -- rare with structured outputs, cheap to cover.
      let parsed: z.infer<typeof ShelfSchema> | null = null;
      for (let attempt = 0; attempt < 2 && parsed === null; attempt += 1) {
        const response = await client.messages.parse({
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
                { type: 'text', text: 'List the grocery items you can identify in this photo.' },
              ],
            },
          ],
          output_config: { format: zodOutputFormat(ShelfSchema) },
        });
        parsed = response.parsed_output;
      }

      if (parsed === null) {
        res.status(502).json({ error: 'The vision model returned an unreadable response. Try another photo.' });
        return;
      }

      const body: AnalyzeShelfResponse = { items: toShelfCandidates(parsed.items), model: MODEL };
      res.json(body);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        res.status(429).json({ error: 'The vision service is busy. Wait a moment and try again.' });
      } else if (error instanceof Anthropic.APIConnectionError) {
        res.status(503).json({ error: 'Could not reach the vision service. Check your connection and retry.' });
      } else if (error instanceof Anthropic.AuthenticationError) {
        console.error('ANTHROPIC_API_KEY is missing or invalid');
        res.status(500).json({ error: 'Vision service is not configured.' });
      } else if (error instanceof Anthropic.APIError) {
        console.error('Anthropic API error', error.status, error.message);
        res.status(502).json({ error: 'The vision service returned an error. Try again.' });
      } else {
        console.error('analyzeShelf failed', error);
        res.status(500).json({ error: 'Something went wrong analyzing the photo.' });
      }
    }
  },
);
