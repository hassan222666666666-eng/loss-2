import React, { useEffect, useState } from 'react';
import {
  ClipboardList,
  Calendar,
  Layers,
  Clock,
  Sparkles,
  ChevronLeft,
  ChevronDown,
  Trash2,
  AlertTriangle,
  Award,
  Edit3,
  CheckCircle2,
  Package,
  Share2,
  RefreshCw,
  Barcode,
  Mic,
  Tag,
} from 'lucide-react';
import { PhotoRecord, RestockSession, DailyPickItem, LogEntry } from '../types';
import {
  getAllSessions,
  getPhotosBySession,
  deletePhoto,
  updatePhoto,
  deleteSession,
  getDailyMergedPickList,
  getPendingPhotos,
} from '../services/db';
import { analysisQueue, QueueProgressState } from '../services/analysisQueue';
import { formatArabicDate, formatPhotoCountLabel } from '../utils/imageUtils';
import { PhotoDetailEditorModal } from './PhotoDetailEditorModal';
import { QuickEditAnalysisModal } from './QuickEditAnalysisModal';

interface LogScreenProps {
  onSelectPhotoPreview?: (photo: PhotoRecord) => void;
}

export const LogScreen: React.FC<LogScreenProps> = () => {
  // Tab: 'pick_list' (Daily Pick List) vs 'sessions' (Session History)
  const [activeSubTab, setActiveSubTab] = useState<'pick_list' | 'sessions'>('pick_list');

  // Daily pick list state
  const [pickList, setPickList] = useState<DailyPickItem[]>([]);
  const [pickListLoading, setPickListLoading] = useState(true);
  const [pendingPhotosCount, setPendingPhotosCount] = useState<number>(0);
  const [queueState, setQueueState] = useState<QueueProgressState>(analysisQueue.getState());
  const [editingLogEntry, setEditingLogEntry] = useState<LogEntry | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Sessions state
  const [sessions, setSessions] = useState<RestockSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [sessionPhotos, setSessionPhotos] = useState<Record<string, PhotoRecord[]>>({});
  const [editingPhoto, setEditingPhoto] = useState<PhotoRecord | null>(null);

  // Session deletion confirmation
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  // Subscribe to analysis queue updates
  useEffect(() => {
    const unsubscribe = analysisQueue.subscribe((state) => {
      setQueueState(state);
      if (!state.isProcessing) {
        // Refresh pick list and pending count when analysis finishes
        loadPickList();
      }
    });
    return unsubscribe;
  }, []);

  // Load Daily Pick List & Pending Count
  const loadPickList = async () => {
    setPickListLoading(true);
    try {
      const items = await getDailyMergedPickList();
      setPickList(items);

      const pending = await getPendingPhotos();
      setPendingPhotosCount(pending.length);
    } catch (err) {
      console.error('Failed to load pick list:', err);
    } finally {
      setPickListLoading(false);
    }
  };

  // Load all sessions
  const loadSessions = async () => {
    try {
      const list = await getAllSessions();
      setSessions(list);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    loadPickList();
    loadSessions();
  }, []);

  // Trigger Queue Processing
  const handleRunQueue = () => {
    analysisQueue.processQueue();
  };

  // Expand / collapse a session and load its photos
  const toggleExpand = async (sessionId: string) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }

    setExpandedSessionId(sessionId);
    try {
      const photos = await getPhotosBySession(sessionId);
      setSessionPhotos((prev) => ({ ...prev, [sessionId]: photos }));
    } catch (err) {
      console.error('Failed to load photos for session:', err);
    }
  };

  // Refresh photos for a specific session after update or delete
  const refreshSessionPhotos = async (sessionId: string) => {
    try {
      const photos = await getPhotosBySession(sessionId);
      setSessionPhotos((prev) => ({ ...prev, [sessionId]: photos }));
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, photoCount: photos.length } : s))
      );
    } catch (err) {
      console.error('Failed to refresh session photos:', err);
    }
  };

  // Delete single photo handler
  const handleDeletePhoto = async (photoId: string) => {
    if (!editingPhoto) return;
    const targetSessionId = editingPhoto.sessionId;
    await deletePhoto(photoId, targetSessionId);
    setEditingPhoto(null);
    await refreshSessionPhotos(targetSessionId);
    await loadPickList();
  };

  // Update photo handler
  const handleUpdatePhoto = async (updated: PhotoRecord) => {
    await updatePhoto(updated);
    setEditingPhoto(null);
    await refreshSessionPhotos(updated.sessionId);
    await loadPickList();
  };

  // Delete entire session
  const handleDeleteEntireSession = async (sessionId: string) => {
    setIsDeletingSession(true);
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setConfirmDeleteSessionId(null);
      if (expandedSessionId === sessionId) {
        setExpandedSessionId(null);
      }
      await loadPickList();
    } catch (err) {
      console.error('Failed to delete session:', err);
    } finally {
      setIsDeletingSession(false);
    }
  };

  // Copy pick list as formatted text to clipboard
  const handleCopyPickList = () => {
    if (pickList.length === 0) return;
    const text = [
      `📋 قائمة نواقص تعبئة الأرفف - ${new Date().toLocaleDateString('ar-SA')}`,
      '----------------------------------------',
      ...pickList.map(
        (item, i) =>
          `${i + 1}. ${item.productName}: ${item.totalMissingUnits} قطعة [المواقع: ${item.shelfNames.join(', ')}]`
      ),
      '----------------------------------------',
      `إجمالي الأصناف: ${pickList.length} صنف · تطبيق رفوف`,
    ].join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    });
  };

  // Total missing units across all products today
  const totalMissingSum = pickList.reduce((acc, p) => acc + p.totalMissingUnits, 0);

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6 pb-28 space-y-5" dir="rtl">
      {/* Top Banner & Header */}
      <div className="px-1 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">
            سجل وتدقيق الأرفف
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            تحليل ذكاء اصطناعي Gemini Vision · تجميع النواقص والتدريب المستمر
          </p>
        </div>

        {/* Share / Copy Pick List Button */}
        {activeSubTab === 'pick_list' && pickList.length > 0 && (
          <button
            type="button"
            onClick={handleCopyPickList}
            className="min-h-[44px] px-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition"
          >
            {copySuccess ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Share2 className="w-4 h-4" />}
            <span>{copySuccess ? 'تم النسخ!' : 'مشاركة القائمة'}</span>
          </button>
        )}
      </div>

      {/* Sub-Tabs: Daily Pick List vs Sessions */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-200/70 dark:bg-slate-800/80">
        <button
          type="button"
          onClick={() => setActiveSubTab('pick_list')}
          className={`flex-1 min-h-[46px] rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
            activeSubTab === 'pick_list'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Package className="w-4 h-4 text-emerald-500" />
          <span>قائمة النواقص لليوم</span>
          {pickList.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-black rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
              {pickList.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('sessions')}
          className={`flex-1 min-h-[46px] rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
            activeSubTab === 'sessions'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4 text-emerald-500" />
          <span>جولات وصور الأرفف</span>
          {sessions.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-black rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              {sessions.length}
            </span>
          )}
        </button>
      </div>

      {/* Queue Progress or Pending Alert Banner */}
      {queueState.isProcessing ? (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2 text-xs font-bold">
            <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
            <span>{queueState.message}</span>
          </div>
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            فترة تهدئة 4.5 ثوانٍ لحماية الحصة
          </span>
        </div>
      ) : pendingPhotosCount > 0 ? (
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>يوجد {pendingPhotosCount} صورة بانتظار تحليل Gemini Vision</span>
          </div>
          <button
            type="button"
            onClick={handleRunQueue}
            className="min-h-[40px] px-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>تحليل الآن</span>
          </button>
        </div>
      ) : null}

      {/* ==================== TAB 1: DAILY PICK LIST ==================== */}
      {activeSubTab === 'pick_list' && (
        <div className="space-y-4">
          {/* Summary Stat Card */}
          <div className="bg-white dark:bg-slate-900 rounded-[24px] p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold text-slate-400 block">إجمالي القطع المطلوبة لليوم:</span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {totalMissingSum}
                </span>
                <span className="text-xs font-semibold text-slate-500">قطعة عبر {pickList.length} صنف</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadPickList}
                title="تحديث القائمة"
                className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center hover:bg-slate-200 transition"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Product Items List */}
          {pickListLoading ? (
            <div className="py-12 text-center text-slate-400 text-sm font-semibold">
              جاري تجهيز قائمة النواقص المجمعة...
            </div>
          ) : pickList.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[24px] p-8 text-center border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
              <div className="w-16 h-16 rounded-[22px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                جميع الأرفف مكتملة التعبئة!
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                لا توجد نواقص مسجلة اليوم. عند تصوير أرفف تحتوي فراغات، ستظهر الأصناف المجمعة هنا تلقائياً.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {pickList.map((item, idx) => (
                <div
                  key={item.productName + idx}
                  className={`bg-white dark:bg-slate-900 rounded-[20px] p-4 border transition shadow-sm flex items-center justify-between gap-3 ${
                    item.needsReview
                      ? 'border-amber-300 dark:border-amber-800/80 bg-amber-50/20'
                      : 'border-slate-200/80 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-[16px] flex items-center justify-center shrink-0 font-black text-sm ${
                        item.needsReview
                          ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                          : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {item.needsReview ? (
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                      ) : (
                        <Package className="w-5 h-5" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {item.productName}
                        </span>

                        {item.needsReview && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300/40">
                            مراجعة الدقة ({Math.round(item.minConfidence * 100)}%)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                        <span>المواقع: {item.shelfNames.join('، ') || 'رفوف متعددة'}</span>
                        {item.barcode && (
                          <>
                            <span>·</span>
                            <span className="font-mono text-[11px] text-slate-500 flex items-center gap-1">
                              <Barcode className="w-3 h-3" />
                              {item.barcode}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quantity and Quick Edit Trigger */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-left px-2">
                      <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 block tabular-nums">
                        {item.totalMissingUnits}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">قطعة</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        // Open first entry of this product for editing & few-shot correction
                        if (item.entries[0]) {
                          setEditingLogEntry(item.entries[0]);
                        }
                      }}
                      title="تعديل وتدقيق المنتج"
                      aria-label="تعديل وتدقيق المنتج"
                      className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center active:scale-95 transition"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: SESSIONS & PHOTOS ==================== */}
      {activeSubTab === 'sessions' && (
        <div className="space-y-3">
          {sessionsLoading ? (
            <div className="py-12 text-center text-slate-400 text-sm font-semibold">
              جاري تحميل الجولات...
            </div>
          ) : sessions.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[20px] p-8 text-center border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
              <div className="w-16 h-16 rounded-[20px] bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <ClipboardList className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                لا توجد جولات مسجلة بعد
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                ابدأ جولة تفقد جديدة عبر شاشة التصوير والتقط صور الأرفف لتظهر سجلاتك هنا تلقائياً.
              </p>
            </div>
          ) : (
            sessions.map((session) => {
              const isExpanded = expandedSessionId === session.id;
              const photos = sessionPhotos[session.id] || [];

              return (
                <div
                  key={session.id}
                  className="bg-white dark:bg-slate-900 rounded-[24px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden transition"
                >
                  {/* Session Card Header */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(session.id)}
                    className="w-full min-h-[64px] p-4 flex items-center justify-between text-right hover:bg-slate-50 dark:hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-[18px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Calendar className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          {session.name}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatArabicDate(session.startTime)}</span>
                          <span>·</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatPhotoCountLabel(session.photoCount)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                          session.status === 'active'
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {session.status === 'active' ? 'نشطة حالياً' : 'مكتملة'}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronLeft className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Photos Grid */}
                  {isExpanded && (
                    <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800 bg-[#F7F8FA] dark:bg-slate-950/40 space-y-3">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 px-1">
                        <span>صور الجولة ({photos.length}) · اضغط لتعديل الصورة أو حذفها</span>

                        {confirmDeleteSessionId !== session.id ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteSessionId(session.id)}
                            className="text-[11px] font-semibold text-red-500 hover:text-red-700 flex items-center gap-1 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>حذف الجولة</span>
                          </button>
                        ) : null}
                      </div>

                      {/* Delete Confirmation */}
                      {confirmDeleteSessionId === session.id && (
                        <div className="p-3 bg-red-50 dark:bg-red-950/50 rounded-2xl border border-red-200 dark:border-red-900/50 space-y-2 animate-in fade-in">
                          <div className="flex items-center gap-1.5 text-red-700 dark:text-red-300 text-xs font-bold">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>تأكيد حذف الجولة وجميع صورها؟ لا يمكن التراجع.</span>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteEntireSession(session.id)}
                              disabled={isDeletingSession}
                              className="min-h-[44px] px-4 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{isDeletingSession ? 'جاري الحذف...' : 'نعم، احذف'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteSessionId(null)}
                              disabled={isDeletingSession}
                              className="min-h-[44px] px-4 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl border border-slate-300 dark:border-slate-700"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      )}

                      {photos.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-400">
                          لم يتم التقاط صور في هذه الجولة بعد
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                          {photos.map((p) => {
                            const isAnalyzed = p.analysisStatus === 'completed';
                            const isPending = p.analysisStatus === 'pending' || !p.analysisStatus;
                            const productCount = p.analysisResult?.products?.length || 0;

                            return (
                              <div
                                key={p.id}
                                onClick={() => setEditingPhoto(p)}
                                className="group relative rounded-[18px] overflow-hidden bg-slate-200 dark:bg-slate-800 aspect-[4/3] cursor-pointer border border-slate-200 dark:border-slate-700 hover:border-emerald-500 transition shadow-sm"
                              >
                                <img
                                  src={p.dataUrl}
                                  alt="معاينة الرف"
                                  className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                                />

                                {/* Golden Ref Badge */}
                                {p.isGoldenReference && (
                                  <span className="absolute top-1.5 right-1.5 bg-amber-500 text-white p-1 rounded-full shadow-md">
                                    <Award className="w-3.5 h-3.5" />
                                  </span>
                                )}

                                {/* Analysis Status Badge */}
                                <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                                  {isAnalyzed ? (
                                    <span className="bg-emerald-600/90 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                                      {productCount} منتج
                                    </span>
                                  ) : isPending ? (
                                    <span className="bg-amber-500/90 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                                      معلق
                                    </span>
                                  ) : null}
                                </div>

                                {/* Capacity Pill */}
                                {p.shelfCapacity && (
                                  <span className="absolute bottom-1.5 right-1.5 bg-black/75 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
                                    {p.shelfCapacity} قطعة
                                  </span>
                                )}

                                {/* Aisle Pill */}
                                {p.aisle && (
                                  <span className="absolute bottom-1.5 left-1.5 bg-emerald-600/90 backdrop-blur-sm text-white text-[9px] font-semibold px-1.5 py-0.5 rounded truncate max-w-[70px]">
                                    {p.aisle}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* FULL PHOTO EDITOR & DELETER MODAL */}
      {editingPhoto && (
        <PhotoDetailEditorModal
          isOpen={true}
          photo={editingPhoto}
          onClose={() => setEditingPhoto(null)}
          onSavePhoto={handleUpdatePhoto}
          onDeletePhoto={handleDeletePhoto}
        />
      )}

      {/* QUICK VOICE / TOUCH CORRECTION MODAL */}
      {editingLogEntry && (
        <QuickEditAnalysisModal
          isOpen={true}
          entry={editingLogEntry}
          onClose={() => setEditingLogEntry(null)}
          onSaved={() => {
            loadPickList();
          }}
        />
      )}
    </div>
  );
};
