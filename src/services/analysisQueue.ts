import {
  PhotoRecord,
  ShelfAnalysisResult,
  LogEntry,
  ProductRecord,
} from '../types';
import {
  getPendingPhotos,
  updatePhotoAnalysis,
  findOrCreateShelf,
  getGoldenReferenceForShelf,
  saveLogEntries,
  saveProduct,
  findProductByName,
  saveShelf,
} from './db';

export interface QueueProgressState {
  isProcessing: boolean;
  total: number;
  current: number;
  currentPhotoId: string | null;
  message: string;
}

type QueueListener = (state: QueueProgressState) => void;

class AnalysisQueueService {
  private isRunning = false;
  private listeners: Set<QueueListener> = new Set();
  private state: QueueProgressState = {
    isProcessing: false,
    total: 0,
    current: 0,
    currentPhotoId: null,
    message: '',
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[Queue] Device is online! Auto-checking pending photos...');
        this.processQueue();
      });
    }
  }

  public subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(updates: Partial<QueueProgressState>) {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach((l) => l(this.state));
  }

  public getState(): QueueProgressState {
    return this.state;
  }

  /**
   * Process single shelf photo via /api/analyze-shelf
   */
  public async analyzeSinglePhoto(photo: PhotoRecord): Promise<ShelfAnalysisResult | null> {
    try {
      await updatePhotoAnalysis(photo.id, 'analyzing');

      // 1. Get or create shelf record for context & learning
      const shelf = await findOrCreateShelf(photo.aisle, photo.shelfNumber);

      // 2. Look for Golden Reference Photo for this shelf (if not current photo)
      let goldenPhotoDataUrl: string | undefined = undefined;
      if (!photo.isGoldenReference && shelf.goldenPhotoDataUrl) {
        goldenPhotoDataUrl = shelf.goldenPhotoDataUrl;
      }

      // 3. Prepare payload with few-shot corrections and known products
      const payload = {
        photoDataUrl: photo.dataUrl,
        goldenPhotoDataUrl,
        shelfId: shelf.id,
        shelfContext: {
          aisle: shelf.aisle || photo.aisle,
          shelfNumber: shelf.shelfNumber || photo.shelfNumber,
          knownCapacity: shelf.fullCapacity || photo.shelfCapacity || null,
          knownProducts: shelf.productNames || [],
        },
        recentCorrections: shelf.recentCorrections || [],
      };

      const res = await fetch('/api/analyze-shelf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.details || errJson.error || `HTTP ${res.status}`);
      }

      const result: ShelfAnalysisResult = await res.json();

      // 4. Update photo in IndexedDB
      await updatePhotoAnalysis(photo.id, 'completed', result);

      // 5. Generate Log Entries and register products
      const todayStr = new Date().toISOString().slice(0, 10);
      const newEntries: LogEntry[] = [];

      for (const item of result.products || []) {
        const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const entry: LogEntry = {
          id: logId,
          date: todayStr,
          timestamp: Date.now(),
          photoId: photo.id,
          sessionId: photo.sessionId,
          shelfId: shelf.id,
          shelfName: shelf.name,
          productName: item.standardized_name,
          unitsPresent: item.units_present,
          missingUnits: item.missing_units,
          confidence: item.confidence,
          boundingBox: item.bounding_box,
          isReviewed: false,
          barcode: item.barcode,
        };
        newEntries.push(entry);

        // Register product if not existing
        const existingProd = await findProductByName(item.standardized_name);
        if (!existingProd) {
          const newProd: ProductRecord = {
            id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            standardizedName: item.standardized_name,
            shelfId: shelf.id,
            defaultCapacity: photo.shelfCapacity || item.units_present + item.missing_units,
            lastSeen: Date.now(),
          };
          await saveProduct(newProd);
        }

        // Add to shelf known products list
        if (!shelf.productNames.includes(item.standardized_name)) {
          shelf.productNames.push(item.standardized_name);
        }
      }

      await saveLogEntries(newEntries);

      // Auto-update shelf capacity if known
      if (photo.shelfCapacity && !shelf.fullCapacity) {
        shelf.fullCapacity = photo.shelfCapacity;
      }
      shelf.updatedAt = Date.now();
      await saveShelf(shelf);

      return result;
    } catch (err: unknown) {
      console.error(`Failed to analyze photo ${photo.id}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      await updatePhotoAnalysis(photo.id, 'error', undefined, msg);
      return null;
    }
  }

  /**
   * Sequentially process pending photos with 4.5-second rate limiting
   */
  public async processQueue(): Promise<void> {
    if (this.isRunning) return;

    // Check online status
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.notify({
        isProcessing: false,
        message: 'الجهاز غير متصل بالإنترنت. سيتم التحليل تلقائياً عند الاتصال.',
      });
      return;
    }

    const pending = await getPendingPhotos();
    if (pending.length === 0) {
      this.notify({
        isProcessing: false,
        total: 0,
        current: 0,
        currentPhotoId: null,
        message: '',
      });
      return;
    }

    this.isRunning = true;
    const total = pending.length;
    this.notify({
      isProcessing: true,
      total,
      current: 0,
      message: `بدء تحليل الصور المعلقة (${total})...`,
    });

    for (let i = 0; i < pending.length; i++) {
      const photo = pending[i];
      const currentIdx = i + 1;

      this.notify({
        isProcessing: true,
        total,
        current: currentIdx,
        currentPhotoId: photo.id,
        message: `جاري تحليل ${currentIdx} من ${total}...`,
      });

      await this.analyzeSinglePhoto(photo);

      // Rate limiting: wait 4.5 seconds between photos to respect Gemini free-tier limits
      if (i < pending.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 4500));
      }
    }

    this.isRunning = false;
    this.notify({
      isProcessing: false,
      total: 0,
      current: 0,
      currentPhotoId: null,
      message: 'تم إكمال تحليل جميع الصور بنجاح!',
    });

    setTimeout(() => {
      if (!this.isRunning) {
        this.notify({ message: '' });
      }
    }, 4000);
  }
}

export const analysisQueue = new AnalysisQueueService();
