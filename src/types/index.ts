export interface ProductAnalysisItem {
  standardized_name: string;
  units_present: number;
  missing_units: number;
  confidence: number;
  bounding_box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  barcode?: string;
  isReviewed?: boolean;
}

export interface ShelfAnalysisResult {
  shelf_match_id: string | null;
  products: ProductAnalysisItem[];
  rawResponse?: string;
  analyzedAt: number;
}

export interface PhotoRecord {
  id: string;
  sessionId: string;
  timestamp: number;
  dataUrl: string;
  width: number;
  height: number;
  shelfCapacity: number | null;
  isGoldenReference: boolean;
  notes?: string;
  aisle?: string;
  shelfNumber?: string;
  // Stage 2: Gemini Vision & Queue additions
  analysisStatus?: 'pending' | 'analyzing' | 'completed' | 'error';
  analysisResult?: ShelfAnalysisResult | null;
  analysisError?: string;
  shelfMatchId?: string | null;
}

export interface RestockSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  photoCount: number;
  status: 'active' | 'completed';
}

export interface ShelfCorrection {
  productName: string;
  previousMissing: number;
  correctedMissing: number;
  timestamp: number;
}

export interface ShelfRecord {
  id: string;
  name: string;
  aisle?: string;
  shelfNumber?: string;
  goldenPhotoId?: string | null;
  goldenPhotoDataUrl?: string | null;
  fullCapacity?: number | null;
  productNames: string[];
  recentCorrections: ShelfCorrection[];
  createdAt: number;
  updatedAt: number;
}

export interface ProductRecord {
  id: string;
  standardizedName: string;
  barcode?: string;
  shelfId?: string;
  defaultCapacity?: number;
  lastSeen: number;
}

export interface LogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  photoId: string;
  sessionId: string;
  shelfId?: string;
  shelfName?: string;
  productName: string;
  unitsPresent: number;
  missingUnits: number;
  confidence: number;
  boundingBox: [number, number, number, number];
  isReviewed: boolean;
  barcode?: string;
}

export interface DailyPickItem {
  productName: string;
  totalMissingUnits: number;
  sourcePhotoIds: string[];
  shelfNames: string[];
  barcode?: string;
  minConfidence: number;
  needsReview: boolean;
  entries: LogEntry[];
}

export interface AppSettings {
  continuousCapture: boolean;
  askShelfCapacity: boolean;
  useGoldenReference: boolean;
  shutterSound: boolean;
  theme: 'system' | 'light' | 'dark';
  compressionMaxWidth: number;
  compressionQuality: number;
  smartTorch: boolean;
  smartZoom: boolean;
  autoAnalyzeQueue: boolean; // Auto process queue in background
}

export const DEFAULT_SETTINGS: AppSettings = {
  continuousCapture: true,
  askShelfCapacity: false,
  useGoldenReference: true,
  shutterSound: true,
  theme: 'system',
  compressionMaxWidth: 1280,
  compressionQuality: 0.8,
  smartTorch: true,
  smartZoom: true,
  autoAnalyzeQueue: true,
};


