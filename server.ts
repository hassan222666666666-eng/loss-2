import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Accept large image payloads from camera
  app.use(express.json({ limit: '40mb' }));

  // Initialize Gemini Client
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  // ----------------- STAGE 2: GEMINI VISION API ENDPOINT -----------------
  app.post('/api/analyze-shelf', async (req, res) => {
    try {
      const {
        photoDataUrl,
        goldenPhotoDataUrl,
        shelfId,
        shelfContext,
        recentCorrections,
      } = req.body;

      if (!photoDataUrl || typeof photoDataUrl !== 'string') {
        return res.status(400).json({ error: 'Missing photoDataUrl' });
      }

      // Extract base64 and mime type
      const match = photoDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid data URL format' });
      }
      const mimeType = match[1];
      const base64Data = match[2];

      // Prepare context strings
      const aisle = shelfContext?.aisle || 'غير محدد';
      const shelfNum = shelfContext?.shelfNumber || '1';
      const knownCapacity = shelfContext?.knownCapacity || null;
      const knownProducts = Array.isArray(shelfContext?.knownProducts) ? shelfContext.knownProducts : [];
      const corrections = Array.isArray(recentCorrections) ? recentCorrections : [];

      let correctionsPrompt = '';
      if (corrections.length > 0) {
        correctionsPrompt = `
سجل تصحيحات وتدريبات سابقة للمشرف على هذا الرف (Few-Shot Corrections):
${corrections
  .map(
    (c, i) =>
      `${i + 1}. المنتج: "${c.productName}" - كان التقدير السابق ${c.previousMissing} قطعة، وصححه المشرف إلى ${c.correctedMissing} قطعة ناقصة.`
  )
  .join('\n')}
يرجى استخدام هذه التعديلات كمرجع لتعلم النمط وتحسين دقة التقدير.
`;
      }

      let productsContextPrompt = '';
      if (knownProducts.length > 0) {
        productsContextPrompt = `المنتجات المعروفة المسجلة لهذا الرف سابقاً: ${knownProducts.join('، ')}. يرجى استخدام نفس التسميات العربية القياسية (standardized_name) إذا كانت المنتجات مطابقة لتوحيد الإحصائيات.`;
      }

      const systemInstruction = `
أنت خبير فحص وجرد وتوثيق أرفف المتاجر والسوبرماركت (Supermarket Shelf Restock Auditor).
مهمتك فحص صورة الرف الحالية لتحديد:
1. المنتجات الموجودة وأسماؤها العربية القياسية (standardized_name).
2. عدد الوحدات المتوفرة على الرف (units_present).
3. عدد الوحدات الناقصة الواجب إحضارها من المستودع لتعبئة الرف (missing_units).
4. نسبة الثقة في التحليل (confidence بين 0.0 و 1.0).
5. الإحداثيات المستطيلة لموقع الفراغ أو مجموعة المنتجات (bounding_box بصيغة [ymin, xmin, ymax, xmax] أرقام طبيعية مقيسة من 0 إلى 1000).

إذا أُرفقت صورة مرجعية ثانية (Golden Reference للرف الممتلئ)، فقارن بدقة بالغة بين الصورتين لتحديد مقدار الفراغ والقطع الناقصة بالمقارنة مع حالة الرف المكتمل.
      `;

      if (ai) {
        const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        // 1. Current Shelf Photo
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        });

        // 2. Golden Reference Photo (if available)
        if (goldenPhotoDataUrl && typeof goldenPhotoDataUrl === 'string') {
          const goldMatch = goldenPhotoDataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
          if (goldMatch) {
            parts.push({
              inlineData: {
                mimeType: goldMatch[1],
                data: goldMatch[2],
              },
            });
          }
        }

        // 3. Prompt instructions
        let promptText = `
حلل صورة الرف بدقة لتجهيز قائمة تعبئة ونواقص المستودع.
معلومات الرف: الممر "${aisle}" - رقم الرف "${shelfNum}".
${knownCapacity ? `السعة الاستيعابية الإجمالية المعروفة للرف: ${knownCapacity} وحدة.` : ''}
${productsContextPrompt}
${correctionsPrompt}
${
  goldenPhotoDataUrl
    ? 'ملاحظة: الصورة الأولى هي صورة الرف الحالية. الصورة الثانية هي الصورة المرجعية للرف الممتلئ بالكامل (Golden Reference). احسب بدقة الفروقات والوحدات الناقصة (missing_units) مقارنة بالمرجع.'
    : 'قدر الفراغات في صفوف الرف والقطع الناقصة لإعادة ملئه بالكامل.'
}
أرجع النتيجة بصيغة كائن JSON مطابق للمخطط بدقة.
`;
        parts.push({ text: promptText });

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts },
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                shelf_match_id: {
                  type: Type.STRING,
                  description: 'معرف الرف المطابق إن وُجد في السياق',
                },
                products: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      standardized_name: {
                        type: Type.STRING,
                        description: 'الاسم العربي القياسي للمنتج',
                      },
                      units_present: {
                        type: Type.INTEGER,
                        description: 'عدد القطع المرئية على الرف',
                      },
                      missing_units: {
                        type: Type.INTEGER,
                        description: 'عدد القطع الناقصة لإعادة ملء الرف',
                      },
                      confidence: {
                        type: Type.NUMBER,
                        description: 'نسبة الثقة من 0.0 إلى 1.0',
                      },
                      bounding_box: {
                        type: Type.ARRAY,
                        items: { type: Type.INTEGER },
                        description: 'إحداثيات الموضع [ymin, xmin, ymax, xmax] بين 0 و 1000',
                      },
                    },
                    required: [
                      'standardized_name',
                      'units_present',
                      'missing_units',
                      'confidence',
                      'bounding_box',
                    ],
                  },
                },
              },
              required: ['products'],
            },
          },
        });

        const rawText = response.text || '{}';
        const parsed = JSON.parse(rawText);

        return res.json({
          shelf_match_id: parsed.shelf_match_id || shelfId || null,
          products: Array.isArray(parsed.products) ? parsed.products : [],
          rawResponse: rawText,
          analyzedAt: Date.now(),
        });
      } else {
        // Graceful Simulated Analysis when GEMINI_API_KEY is not set yet
        console.warn('[Gemini Vision] GEMINI_API_KEY not found in environment, returning realistic simulated analysis');

        // Create realistic products based on aisle context
        const sampleProductsMap: Record<string, string[]> = {
          'المنظفات والورقيات': ['سائل جلي C4 أخضر 1 لتر', 'مسحوق غسيل تايد 2.5 كغ', 'مناديل كلينكس كلاسيك'],
          'الألبان والأجبان': ['حليب المراعي كامل الدسم 1 لتر', 'لبنة المراعي طازجة 400 غ', 'جبنة فيتا بوك 500 غ'],
          'الزيوت والمؤن': ['زيت عافية ذرة 1.5 لتر', 'سكر الأسرة ناعم 5 كغ', 'أرز الشعلان بسمتي 10 كغ'],
          'المعلبات': ['تونة قودي ماء وملح 160 غ', 'حمص حب حدائق كاليفورنيا', 'فول مدمس لونا 400 غ'],
          'المشروبات والعصائر': ['عصير راني برتقال حبيبات 240 مل', 'مياه نقي كرتون 40 قارورة', 'شاي لبتون أحمر 100 خيط'],
        };

        const defaultList = sampleProductsMap[aisle] || [
          knownProducts[0] || 'سائل جلي C4 أخضر 1 لتر',
          knownProducts[1] || 'مناديل ورقية فاخرة 200 حبة',
        ];

        const simulatedProducts = defaultList.slice(0, 2).map((name, idx) => {
          const cap = knownCapacity ? Math.round(knownCapacity / defaultList.length) : 12;
          const present = Math.max(1, Math.round(cap * 0.35));
          const missing = Math.max(1, cap - present);
          const yOffset = idx * 450 + 80;
          return {
            standardized_name: name,
            units_present: present,
            missing_units: missing,
            confidence: idx === 0 ? 0.88 : 0.65, // idx 1 triggers < 0.7 review test!
            bounding_box: [yOffset, 120, yOffset + 380, 880] as [number, number, number, number],
          };
        });

        return res.json({
          shelf_match_id: shelfId || null,
          products: simulatedProducts,
          rawResponse: 'SIMULATED_GEMINI_ANALYSIS',
          analyzedAt: Date.now(),
        });
      }
    } catch (err: unknown) {
      console.error('Gemini shelf analysis error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        error: 'Failed to analyze shelf photo',
        details: errMsg,
      });
    }
  });

  // ----------------- VITE MIDDLEWARE / STATIC FILES -----------------
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Rofoof Server] Ready at http://0.0.0.0:${PORT}`);
  });
}

startServer();
