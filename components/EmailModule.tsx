import React, { useState, useEffect, useRef } from 'react';
import { ClientInfo, AppConfig, QuoteItem, EmailDraft, InvoiceData } from '../types.ts';
import { generateEmailDraft } from '../services/geminiService.ts';

interface EmailModuleProps {
  isOpen: boolean;
  onClose: () => void;
  client: ClientInfo;
  config?: AppConfig;
  items?: QuoteItem[];
  invoice?: InvoiceData | null;
  generatePdf?: () => Promise<string | null>;
  audioData?: string | null;
}

export const EmailModule: React.FC<EmailModuleProps> = ({ isOpen, onClose, client, config, items, invoice, generatePdf, audioData }) => {
  const [draft, setDraft] = useState<EmailDraft>({ to: '', subject: '', body: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isAttaching, setIsAttaching] = useState<string | null>(null);
  const [stagedAttachments, setStagedAttachments] = useState<{filename: string, path: string, size: string}[]>([]);
  const [sendStatus, setSendStatus] = useState<string[]>([]);
  const [tone, setTone] = useState('professional');
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && client.email) {
      handleGenerate();
    }
    }, [isOpen, client.email, invoice]);

  useEffect(() => {
    if (consoleRef.current) {
        consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [sendStatus]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await generateEmailDraft(client, config, items, tone, invoice, config?.documentLanguage || 'en');
      setDraft(result);
    } catch (err) {
      console.error("Drafting error", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      return false;
    }
  };

  const handleAttachPdf = async () => {
    if (!generatePdf || isAttaching) return;
    setIsAttaching('pdf');
    try {
      const base64 = await generatePdf();
      if (base64) {
        const sizeInMB = (base64.length * 0.75) / (1024 * 1024);
        const filename = invoice?.id ? `${invoice.id}.pdf` : (config?.quoteId ? `${config.quoteId}.pdf` : 'Document.pdf');
        
        // Check if already attached
        if (!stagedAttachments.some(a => a.filename === filename)) {
          setStagedAttachments(prev => [...prev, {
            filename,
            path: base64,
            size: `${sizeInMB.toFixed(2)} MB`
          }]);
        }
      }
    } catch (err) {
      console.error("PDF Attach error", err);
    } finally {
      setIsAttaching(null);
    }
  };

  const removeAttachment = (filename: string) => {
    setStagedAttachments(prev => prev.filter(a => a.filename !== filename));
  };

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success) {
        setTestResult({ success: true, message: data.message });
      } else {
        setTestResult({ success: false, message: data.error || 'Connection failed' });
      }
    } catch (error) {
      setTestResult({ success: false, message: 'Network error during test' });
    } finally {
      setIsTestingConnection(false);
      setTimeout(() => setTestResult(null), 5000);
    }
  };

  const handleSend = async () => {
    setIsSending(true);
    setSendStatus([]);
    
    const addLog = (msg: string) => setSendStatus(prev => [...prev, `[NETWORK] ${msg}`]);

    if (!draft.to) {
      addLog("ERROR: Recipient email address is required.");
      setIsSending(false);
      return;
    }
    
    if (!draft.subject || !draft.body) {
      addLog("ERROR: Subject and Message Payload are required.");
      setIsSending(false);
      return;
    }

    addLog("Initializing Caterpillar Secure SMTP...");
    await new Promise(r => setTimeout(r, 600));
    addLog("Target: " + draft.to);
    
    addLog(`Payload: ${stagedAttachments.length} Staged Attachments`);
    stagedAttachments.forEach(a => addLog(`- ${a.filename} (${a.size})`));
    
    try {
      addLog("Connecting to Mail Server...");
      const payload = {
        ...draft,
        attachments: stagedAttachments.map(a => ({ filename: a.filename, path: a.path }))
      };
      
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (response.ok) {
        addLog("Dispatch sequence confirmed...");
        addLog(`Message ID: ${result.messageId}`);
        if (result.simulated) {
          addLog("WARNING: " + result.note);
          addLog("Emails are currently simulated. Configure SMTP in the AI Studio environment variables to send real emails.");
        }
        if (result.previewUrl) {
          addLog("PREVIEW AVAILABLE: " + result.previewUrl);
          // Do not use window.open in iframe
        }
        await new Promise(r => setTimeout(r, 2500));
        setIsSending(false);
        onClose();
      } else {
        addLog("ERROR: " + (result.error || "Failed to send email"));
        if (result.details) {
          addLog("DETAILS: " + result.details);
        }
        setIsSending(false);
      }
    } catch (error) {
      addLog("CRITICAL ERROR: " + (error instanceof Error ? error.message : String(error)));
      setIsSending(false);
    }
  };

  const isRtl = config?.documentLanguage === 'ar';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-cat-black/90 backdrop-blur-xl z-[200] flex items-center justify-center p-4 animate-in fade-in duration-300" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="bg-white w-full max-w-5xl rounded-[3rem] shadow-3xl overflow-hidden border-[6px] border-cat-yellow flex flex-col max-h-[92vh] relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cat-yellow to-transparent opacity-50"></div>
        
        {/* Header */}
        <div className={`p-10 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <div className={`flex items-center gap-6 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <div className="w-16 h-16 rounded-2xl bg-cat-black flex items-center justify-center text-cat-yellow shadow-2xl shadow-cat-black/40 border border-cat-yellow/20">
              <svg className={`w-8 h-8 ${isRtl ? 'scale-x-[-1]' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
            </div>
            <div className={isRtl ? 'text-right' : 'text-left'}>
              <h3 className="text-3xl font-black uppercase tracking-tighter text-cat-black leading-none">{isRtl ? 'مركز الإرسال' : 'Dispatch Hub'}</h3>
              <p className="text-[11px] text-slate-400 font-black uppercase mt-2.5 tracking-[0.3em] flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                {isRtl ? 'البروتوكول: ترحيل SMTP الهندسي' : 'Protocol: Engineering SMTP Relay'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-14 h-14 rounded-full bg-white shadow-xl border border-slate-200 flex items-center justify-center hover:bg-cat-black hover:text-white transition-all hover:rotate-90 active:scale-90">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-grow p-10 overflow-y-auto space-y-10 relative custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <label className={`text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] ${isRtl ? 'mr-4 text-right' : 'ml-4 text-left'}`}>{isRtl ? 'هوية المستلم' : 'Recipient Identity'}</label>
              <input 
                className={`w-full h-[56px] px-6 bg-slate-50 border border-slate-200 rounded-2xl text-[14px] font-bold text-cat-black outline-none focus:bg-white focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow transition-all font-mono shadow-sm hover:border-slate-300 ${isRtl ? 'text-right' : 'text-left'}`} 
                value={draft.to} 
                onChange={(e) => setDraft({...draft, to: e.target.value})} 
                placeholder="identity@domain.com"
              />
            </div>
            <div className="space-y-3">
              <label className={`text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] ${isRtl ? 'mr-4 text-right' : 'ml-4 text-left'}`}>{isRtl ? 'الوضع اللغوي' : 'Linguistic Mode'}</label>
              <div className="relative">
                <select 
                  className={`w-full h-[56px] px-6 bg-slate-50 border border-slate-200 rounded-2xl text-[14px] font-black uppercase outline-none focus:bg-white focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow cursor-pointer appearance-none shadow-sm hover:border-slate-300 transition-all ${isRtl ? 'pl-12 text-right' : 'pr-12 text-left'}`} 
                  value={tone} 
                  onChange={(e) => {setTone(e.target.value); handleGenerate();}}
                >
                  <option value="professional">{isRtl ? 'الخدمات اللوجستية القياسية' : 'Standard Logistics'}</option>
                  <option value="friendly">{isRtl ? 'شريك مباشر' : 'Direct Partner'}</option>
                  <option value="urgent">{isRtl ? 'إرسال حرج' : 'Critical Dispatch'}</option>
                </select>
                <div className={`absolute top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 ${isRtl ? 'left-6' : 'right-6'}`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className={`text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] ${isRtl ? 'mr-4 text-right' : 'ml-4 text-left'}`}>{isRtl ? 'عنوان الموضوع' : 'Subject Header'}</label>
            <input 
              className={`w-full h-[56px] px-6 bg-slate-50 border border-slate-200 rounded-2xl text-[14px] font-black uppercase text-cat-black focus:bg-white focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow outline-none transition-all shadow-sm hover:border-slate-300 ${isRtl ? 'text-right' : 'text-left'}`} 
              value={draft.subject} 
              onChange={(e) => setDraft({...draft, subject: e.target.value})} 
            />
          </div>

          <div className="space-y-3 relative">
            <label className={`text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] flex justify-between items-center ${isRtl ? 'pr-4 flex-row-reverse' : 'pl-4'}`}>
                <span>{isRtl ? 'حمولة الرسالة' : 'Message Payload'}</span>
                <span className="text-[9px] font-black text-cat-black bg-cat-yellow/20 border border-cat-yellow/30 px-3 py-1.5 rounded-xl shadow-sm">{isRtl ? 'توليف الذكاء الاصطناعي نشط' : 'AI SYNTHESIS ACTIVE'}</span>
            </label>
            
            {isGenerating && (
              <div className="absolute inset-0 bg-white/90 backdrop-blur-md z-10 flex flex-col items-center justify-center rounded-[2rem] border-2 border-cat-yellow/30 mt-8 shadow-2xl">
                 <div className="w-16 h-16 border-4 border-cat-black/5 border-t-cat-black rounded-full animate-spin mb-6 shadow-2xl"></div>
                 <span className="text-[11px] font-black uppercase text-cat-black tracking-[0.3em] animate-pulse">{isRtl ? 'جاري صياغة ملخص النظام...' : 'Drafting System Brief...'}</span>
              </div>
            )}
            
            <textarea 
              className={`w-full h-80 p-8 bg-slate-50 border border-slate-200 rounded-[2rem] text-[14px] font-medium leading-relaxed focus:bg-white focus:ring-4 focus:ring-cat-yellow/20 focus:border-cat-yellow outline-none transition-all resize-none font-mono text-slate-700 shadow-sm hover:border-slate-300 custom-scrollbar ${isRtl ? 'text-right' : 'text-left'}`} 
              value={draft.body} 
              onChange={(e) => setDraft({...draft, body: e.target.value})} 
            />
            
            <button 
                onClick={handleGenerate}
                title={isRtl ? 'إعادة توليد المسودة' : 'Regenerate Draft'}
                className={`absolute bottom-6 w-14 h-14 bg-cat-black text-white rounded-2xl hover:bg-cat-gray transition-all shadow-xl active:scale-90 flex items-center justify-center group ${isRtl ? 'left-6' : 'right-6'}`}
            >
                <svg className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </button>
          </div>

          {/* Attachments Selection */}
          <div className="space-y-6">
            <label className={`text-[11px] font-black uppercase text-slate-400 tracking-[0.2em] ${isRtl ? 'mr-4 text-right' : 'ml-4 text-left'}`}>
              {isRtl ? 'إدارة المرفقات' : 'Attachment Management'}
            </label>
            
            <div className={`flex flex-wrap gap-4 px-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
              {/* Manual PDF Attach Button */}
              <button 
                onClick={handleAttachPdf}
                disabled={isAttaching !== null}
                className={`flex items-center gap-4 px-6 py-4 border-2 rounded-[1.5rem] transition-all group ${isRtl ? 'flex-row-reverse' : ''} ${isAttaching === 'pdf' ? 'bg-slate-100 border-slate-200' : 'bg-white border-slate-100 hover:border-cat-yellow hover:shadow-lg active:scale-95'}`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isAttaching === 'pdf' ? 'bg-slate-200 text-slate-400 animate-pulse' : 'bg-cat-yellow/10 text-cat-black group-hover:bg-cat-yellow'}`}>
                  {isAttaching === 'pdf' ? (
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
                  )}
                </div>
                <div className={isRtl ? 'text-right' : 'text-left'}>
                  <p className="text-[12px] font-black uppercase tracking-widest text-cat-black">{isRtl ? 'توليد PDF' : 'Generate PDF'}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{isRtl ? 'وثيقة هندسية' : 'Engineering Document'}</p>
                </div>
              </button>
            </div>

            {/* Staged Attachments List */}
            {stagedAttachments.length > 0 && (
              <div className="px-4 space-y-3">
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-[1px] flex-grow bg-slate-100"></div>
                  <span className="text-[9px] font-black text-slate-300 uppercase tracking-[0.3em]">{isRtl ? 'المرفقات الحالية' : 'Current Attachments'}</span>
                  <button 
                    onClick={() => setStagedAttachments([])}
                    className="text-[9px] font-black text-red-400 hover:text-red-600 uppercase tracking-[0.2em] transition-colors"
                  >
                    {isRtl ? 'مسح الكل' : 'Clear All'}
                  </button>
                  <div className="h-[1px] flex-grow bg-slate-100"></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {stagedAttachments.map((att, idx) => (
                    <div key={idx} className={`flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl group hover:border-cat-yellow transition-all ${isRtl ? 'flex-row-reverse' : ''}`}>
                      <div className={`flex items-center gap-4 ${isRtl ? 'flex-row-reverse' : ''}`}>
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-cat-black shadow-sm border border-slate-100">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                        </div>
                        <div className={isRtl ? 'text-right' : 'text-left'}>
                          <p className="text-[11px] font-black text-cat-black truncate max-w-[150px]">{att.filename}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{att.size}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => removeAttachment(att.filename)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-10 border-t border-slate-100 bg-slate-50/50">
          {isSending ? (
            <div className="bg-cat-black p-8 rounded-[2rem] font-mono text-[11px] text-cat-yellow shadow-2xl h-40 overflow-hidden flex flex-col border border-cat-yellow/20">
               <div className="flex-grow space-y-2 h-full overflow-y-auto custom-scrollbar" ref={consoleRef}>
                   {sendStatus.map((s, i) => (
                     <div key={i} className={`flex gap-4 items-start ${isRtl ? 'flex-row-reverse text-right' : ''}`}>
                       <span className="opacity-30 font-black shrink-0">[{new Date().toLocaleTimeString()}]</span>
                       <span className="tracking-tight">{s}</span>
                     </div>
                   ))}
               </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {testResult && (
                <div className={`p-4 rounded-2xl text-[11px] font-black uppercase tracking-widest animate-in fade-in slide-in-from-bottom-2 flex items-center gap-3 border ${testResult.success ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${testResult.success ? 'bg-emerald-100' : 'bg-red-100'}`}>
                    {testResult.success ? '✓' : '✕'}
                  </div>
                  {testResult.message}
                </div>
              )}
              
              <div className="flex gap-4">
                <button
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || isSending}
                  className={`h-[72px] px-8 rounded-[2rem] font-black text-[13px] uppercase tracking-[0.2em] flex items-center justify-center gap-4 transition-all duration-300 border-2 ${isTestingConnection ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-white border-slate-200 text-slate-600 hover:border-cat-yellow hover:text-cat-black hover:shadow-lg'}`}
                >
                  {isTestingConnection ? (
                    <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                  )}
                  {isRtl ? 'اختبار الاتصال' : 'Test Connection'}
                </button>

                <button 
                    onClick={handleSend}
                    disabled={isSending || isGenerating || !draft.to || isTestingConnection}
                    className={`flex-grow h-[72px] rounded-[2rem] font-black text-[16px] uppercase tracking-[0.4em] flex items-center justify-center gap-6 transition-all duration-300 shadow-[0_15px_40px_rgba(0,0,0,0.15)] group relative overflow-hidden ${!draft.to ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' : 'bg-cat-black text-white hover:bg-cat-dark active:scale-[0.98]'} ${isRtl ? 'flex-row-reverse' : ''}`}
                >
                    <span className="relative z-10">{isRtl ? 'تنفيذ الإرسال' : 'Execute Dispatch'}</span>
                    <svg className={`w-6 h-6 group-hover:translate-x-2 transition-transform duration-300 relative z-10 ${isRtl ? 'rotate-180 group-hover:-translate-x-2' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};