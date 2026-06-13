import * as functions from "firebase-functions";
import fetch from "node-fetch";

interface BaseImageTaskRequest {
  task: "photo_validation" | "clothing_detection";
  base64Image: string;
}

interface PremiumOutfitsTaskRequest {
  task: "premium_outfits";
  systemPrompt: string;
  prompt: string;
}

interface StylistCommentTaskRequest {
  task: "stylist_comment";
  systemPrompt: string;
  prompt: string;
}

interface HairSuggestionTaskRequest {
  task: "hair_suggestion";
  prompt: string;
}

type SecureAiTaskRequest =
  | BaseImageTaskRequest
  | PremiumOutfitsTaskRequest
  | StylistCommentTaskRequest
  | HairSuggestionTaskRequest;

export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface SecureAiTaskResponse {
  content: string;
  model: string;
  usage?: OpenAiUsage;
}

export interface ClothingDetectionSchemaItem {
  detectedType: string;
  name: string;
  color: string;
  pattern: string;
  material: string;
  style: string;
  fit: string;
  silhouette: string;
  neckline: string;
  sleeveLength: string;
  length: string;
  closure: string;
  rise: string;
  wash: string;
  heelHeight: string;
  toeShape: string;
  hardware: string;
  brandOrLogo: string;
  formality: string;
  warmth: string;
  layeringRole: string;
  season: string[];
  event: string[];
  stylingNotes: string;
  details: string;
  confidence: number;
}

const MAX_IMAGE_BASE64_LENGTH = 7_500_000;
const MAX_SYSTEM_PROMPT_LENGTH = 30_000;
const MAX_PROMPT_LENGTH = 100_000;

const PHOTO_VALIDATION_PROMPT =
  'A user gave me this photo to identify clothing in their wardrobe. It should show one or more articles of clothing or a person wearing clothes. Is this a valid photo? If so, list each article of clothing in it. Respond in JSON format with: {"isValid": boolean, "clothingItems": ["item1", "item2"], "message": "explanation"}';

const CLOTHING_DETECTION_PROMPT = `Analyze this image and identify each clothing item OR makeup product visible.

CRITICAL: Respond with ONLY valid JSON matching the schema, no other text. If nothing relevant is visible, return {"items":[]}.

For each item found, create an object with these exact fields:
{
  "detectedType": "specific_item_type",
  "name": "concise_item_name",
  "color": "detailed_color_description",
  "pattern": "pattern_type",
  "material": "inferred_material",
  "style": "style_description",
  "fit": "fit_type_or_finish_for_makeup",
  "silhouette": "shape_or_cut",
  "neckline": "neckline_if_visible_or_empty",
  "sleeveLength": "sleeve_or_strap_description_or_empty",
  "length": "item_length_or_empty",
  "closure": "closure_or_fastening_or_empty",
  "rise": "bottom_rise_or_empty",
  "wash": "denim_or_fabric_wash_or_empty",
  "heelHeight": "shoe_heel_height_or_empty",
  "toeShape": "shoe_toe_shape_or_empty",
  "hardware": "visible_hardware_or_empty",
  "brandOrLogo": "visible_brand_or_logo_or_empty",
  "formality": "casual|smart casual|business|formal|athletic|loungewear|party|unknown",
  "warmth": "lightweight|medium|warm|very warm|unknown",
  "layeringRole": "base|mid|outer|standalone|accessory|makeup|unknown",
  "season": ["Spring", "Summer", "Fall", "Winter"],
  "event": ["Casual", "Formal", "Athletic", "Party"],
  "stylingNotes": "specific outfit-pairing guidance for this item",
  "details": "exhaustive visual details useful for outfit matching",
  "confidence": 0.85
}

STRICT VISIBILITY RULES:
1. ONLY include items where at least 70% of the item is clearly visible in the photo
2. Do NOT include items that are partially cropped, in the background, or obscured
3. Do NOT include clothing parts - only complete items (no "sole", "strap", "collar", "sleeve" etc.)
4. If you're not sure the item is the main subject of the photo, don't include it
5. Common CLOTHING types: "shirt", "t-shirt", "tank top", "dress", "pants", "jeans", "shorts", "skirt", "jacket", "sweater", "shoes", "sneakers", "boots", "sandals", "hat"
6. Common MAKEUP types: "lipstick", "lip gloss", "eyeshadow", "mascara", "foundation", "concealer", "blush", "bronzer", "highlighter", "eyeliner", "palette", "powder", "primer", "nail polish", "makeup brush"
7. Common ACCESSORY types: "belt", "bag", "purse", "backpack", "scarf", "gloves", "tie", "watch", "sunglasses", "wallet"
8. Hair accessories include: "claw clip", "barrette", "headband", "hair clip", "scrunchie"
9. Jewelry includes: "necklace", "bracelet", "earrings", "ring"
10. Set confidence to 0.85 for clearly visible items, 0.65 for items that meet the 70% threshold but aren't perfect
11. If you see multiple similar items (like two shoes), list as one item

DETAIL RULES:
1. Be extremely specific. Prefer "ribbed ivory cropped cardigan with pearl buttons" over "white sweater".
2. Mention visible construction: collar, neckline, sleeves, hem, rise, length, cut, closure, texture, hardware, transparency, shine, distressing, trim, embellishments, and logo/label text.
3. Infer season/event from actual visual properties. Use only the allowed season/event labels listed in the schema.
4. Put outfit-useful details in stylingNotes: what colors, layers, formality, weather, and silhouettes it pairs with.
5. For makeup, use finish, shade family, intensity, undertone, product format, and best outfit vibe.
6. Do not collapse details into only color/material/style. Fill every applicable construction field.
7. Leave a field empty only when it truly does not apply or is not visible.
8. details should not repeat color, pattern, material, style, or fit. Put construction and distinctive visual traits there.

Example valid response for an accessory (belt):
{
  "items": [
    {
      "detectedType": "belt",
      "name": "Brown leather belt with silver buckle",
      "color": "brown",
      "pattern": "solid",
      "material": "leather",
      "style": "casual",
      "fit": "standard width",
      "silhouette": "straight belt",
      "neckline": "",
      "sleeveLength": "",
      "length": "",
      "closure": "single-prong buckle",
      "rise": "",
      "wash": "",
      "heelHeight": "",
      "toeShape": "",
      "hardware": "silver buckle",
      "brandOrLogo": "",
      "formality": "casual",
      "warmth": "unknown",
      "layeringRole": "accessory",
      "season": ["Spring", "Summer", "Fall", "Winter"],
      "event": ["Casual"],
      "stylingNotes": "Works with denim, trousers, tucked tops, and casual dresses; silver hardware pairs best with cool-toned jewelry.",
      "details": "stitched edges and smooth finish",
      "confidence": 0.85
    }
  ]
}

Example valid response for makeup:
{
  "items": [
    {
      "detectedType": "lipstick",
      "name": "Deep red matte bullet lipstick",
      "color": "deep red",
      "pattern": "solid",
      "material": "cream",
      "style": "matte",
      "fit": "long-wearing",
      "silhouette": "",
      "neckline": "",
      "sleeveLength": "",
      "length": "",
      "closure": "",
      "rise": "",
      "wash": "",
      "heelHeight": "",
      "toeShape": "",
      "hardware": "",
      "brandOrLogo": "",
      "formality": "formal",
      "warmth": "unknown",
      "layeringRole": "makeup",
      "season": ["Fall", "Winter"],
      "event": ["Formal", "Party"],
      "stylingNotes": "Strong lip color works well with black, cream, metallics, evening outfits, and simple eye makeup.",
      "details": "bullet format and luxe packaging",
      "confidence": 0.85
    }
  ]
}

IMPORTANT: If the photo clearly shows ONE item as the main subject (like a belt, bag, or single clothing piece), ALWAYS detect it. Only return {"items":[]} if there are truly NO clothing, accessories, or makeup items visible.

Remember: ONLY return valid JSON.`;

const CLOTHING_DETECTION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "clothing_detection_result",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              detectedType: {type: "string"},
              name: {type: "string"},
              color: {type: "string"},
              pattern: {type: "string"},
              material: {type: "string"},
              style: {type: "string"},
              fit: {type: "string"},
              silhouette: {type: "string"},
              neckline: {type: "string"},
              sleeveLength: {type: "string"},
              length: {type: "string"},
              closure: {type: "string"},
              rise: {type: "string"},
              wash: {type: "string"},
              heelHeight: {type: "string"},
              toeShape: {type: "string"},
              hardware: {type: "string"},
              brandOrLogo: {type: "string"},
              formality: {
                type: "string",
                enum: ["casual", "smart casual", "business", "formal", "athletic", "loungewear", "party", "unknown", ""],
              },
              warmth: {
                type: "string",
                enum: ["lightweight", "medium", "warm", "very warm", "unknown", ""],
              },
              layeringRole: {
                type: "string",
                enum: ["base", "mid", "outer", "standalone", "accessory", "makeup", "unknown", ""],
              },
              season: {
                type: "array",
                items: {type: "string", enum: ["Spring", "Summer", "Fall", "Winter"]},
              },
              event: {
                type: "array",
                items: {type: "string", enum: ["Casual", "Formal", "Athletic", "Party"]},
              },
              stylingNotes: {type: "string"},
              details: {type: "string"},
              confidence: {type: "number"},
            } satisfies Record<keyof ClothingDetectionSchemaItem, unknown>,
            required: [
              "detectedType",
              "name",
              "color",
              "pattern",
              "material",
              "style",
              "fit",
              "silhouette",
              "neckline",
              "sleeveLength",
              "length",
              "closure",
              "rise",
              "wash",
              "heelHeight",
              "toeShape",
              "hardware",
              "brandOrLogo",
              "formality",
              "warmth",
              "layeringRole",
              "season",
              "event",
              "stylingNotes",
              "details",
              "confidence",
            ] satisfies Array<keyof ClothingDetectionSchemaItem>,
          },
        },
      },
      required: ["items"],
    },
  },
};

const getOpenAiApiKey = (): string => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "OpenAI API key not configured"
    );
  }

  return apiKey;
};

const requireAuth = (
  context: functions.https.CallableContext
): string => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }

  return context.auth.uid;
};

const assertString = (
  value: unknown,
  fieldName: string,
  maxLength: number
): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `${fieldName} is required`
    );
  }

  if (value.length > maxLength) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `${fieldName} exceeds the maximum allowed length`
    );
  }

  return value;
};

const assertImagePayload = (value: unknown): string => {
  const base64Image = assertString(value, "base64Image", MAX_IMAGE_BASE64_LENGTH);

  if (base64Image.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Image payload is too large"
    );
  }

  return base64Image;
};

const mapOpenAiErrorCode = (
  status: number
): functions.https.FunctionsErrorCode => {
  if (status === 400) return "invalid-argument";
  if (status === 401 || status === 403) return "permission-denied";
  if (status === 408) return "deadline-exceeded";
  if (status === 429) return "resource-exhausted";
  if (status >= 500) return "unavailable";
  return "internal";
};

const callOpenAiChatCompletion = async ({
  model,
  messages,
  maxTokens,
  temperature,
  responseFormat,
}: {
  model: string;
  messages: unknown[];
  maxTokens: number;
  temperature?: number;
  responseFormat?: unknown;
}): Promise<SecureAiTaskResponse> => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getOpenAiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? {temperature} : {}),
      ...(responseFormat ? {response_format: responseFormat} : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new functions.https.HttpsError(
      mapOpenAiErrorCode(response.status),
      `OpenAI API error: ${response.status}`,
      {status: response.status, error: errorText.slice(0, 1_000)}
    );
  }

  const data = await response.json() as {
    choices?: Array<{message?: {content?: string}}>;
    usage?: OpenAiUsage;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new functions.https.HttpsError(
      "internal",
      "OpenAI returned an empty response"
    );
  }

  return {
    content,
    model,
    usage: data.usage,
  };
};

export const parseClothingDetectionContent = (
  content: string
): ClothingDetectionSchemaItem[] => {
  const parsed = JSON.parse(content);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && Array.isArray(parsed.items)) {
    return parsed.items;
  }

  throw new Error("Clothing detection response did not include an items array");
};

export const runClothingDetectionTask = async (
  base64Image: string,
  mimeType: string = "image/jpeg"
): Promise<SecureAiTaskResponse> => {
  return callOpenAiChatCompletion({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: CLOTHING_DETECTION_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Return JSON matching the schema. Use empty strings or empty arrays for fields that truly do not apply. Do not omit keys.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    maxTokens: 2_500,
    temperature: 0,
    responseFormat: CLOTHING_DETECTION_RESPONSE_FORMAT,
  });
};

const buildTaskRequest = (
  rawData: unknown
): SecureAiTaskRequest => {
  if (!rawData || typeof rawData !== "object") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Request payload is required"
    );
  }

  const data = rawData as Partial<SecureAiTaskRequest>;
  const task = data?.task;

  if (task === "photo_validation") {
    return {
      task,
      base64Image: assertImagePayload(data.base64Image),
    };
  }

  if (task === "clothing_detection") {
    return {
      task,
      base64Image: assertImagePayload(data.base64Image),
    };
  }

  if (task === "premium_outfits") {
    return {
      task,
      systemPrompt: assertString(
        data.systemPrompt,
        "systemPrompt",
        MAX_SYSTEM_PROMPT_LENGTH
      ),
      prompt: assertString(data.prompt, "prompt", MAX_PROMPT_LENGTH),
    };
  }

  if (task === "stylist_comment") {
    return {
      task,
      systemPrompt: assertString(
        data.systemPrompt,
        "systemPrompt",
        MAX_SYSTEM_PROMPT_LENGTH
      ),
      prompt: assertString(data.prompt, "prompt", MAX_PROMPT_LENGTH),
    };
  }

  if (task === "hair_suggestion") {
    return {
      task,
      prompt: assertString(data.prompt, "prompt", MAX_PROMPT_LENGTH),
    };
  }

  throw new functions.https.HttpsError(
    "invalid-argument",
    "Unsupported AI task"
  );
};

const runTask = async (
  request: SecureAiTaskRequest
): Promise<SecureAiTaskResponse> => {
  if (request.task === "photo_validation") {
    return callOpenAiChatCompletion({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {type: "text", text: PHOTO_VALIDATION_PROMPT},
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${request.base64Image}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      maxTokens: 300,
    });
  }

  if (request.task === "clothing_detection") {
    return runClothingDetectionTask(request.base64Image);
  }

  if (request.task === "premium_outfits") {
    return callOpenAiChatCompletion({
      model: "gpt-4o",
      messages: [
        {role: "system", content: request.systemPrompt},
        {role: "user", content: request.prompt},
      ],
      maxTokens: 2_000,
      temperature: 0.7,
    });
  }

  if (request.task === "stylist_comment") {
    return callOpenAiChatCompletion({
      model: "gpt-4o-mini",
      messages: [
        {role: "system", content: request.systemPrompt},
        {role: "user", content: request.prompt},
      ],
      maxTokens: 100,
      temperature: 0.9,
    });
  }

  if (request.task === "hair_suggestion") {
    return callOpenAiChatCompletion({
      model: "gpt-4o-mini",
      messages: [{role: "user", content: request.prompt}],
      maxTokens: 200,
      temperature: 0.7,
    });
  }

  throw new functions.https.HttpsError(
    "invalid-argument",
    "Unsupported AI task"
  );
};

export const runSecureAiTask = functions
  .runWith({
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 300,
    memory: "512MB",
  })
  .https.onCall(async (data: unknown, context) => {
    const userId = requireAuth(context);
    const request = buildTaskRequest(data);

    console.log(`🤖 Running secure AI task "${request.task}" for user ${userId}`);

    return runTask(request);
  });
