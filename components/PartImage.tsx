






import React, { useState, useEffect } from 'react';
import { editPartImage } from '../services/claudeService.ts';
import { PhotoMode } from '../types.ts';

interface PartImageProps {
  partNo: string;
  photoMode: PhotoMode;
  originalImages?: string[];
  aiImageUrl?: string;
  isGenerating: boolean;
}

export const PartImage: React.FC<PartImageProps> = ({ partNo, photoMode, originalImages, aiImageUrl, isGenerating }) => {
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditLoading, setIsEditLoading] = useState(false);

  useEffect(() => {
    const source = photoMode === PhotoMode.AI ? (aiImageUrl || null) : (originalImages?.[0] || null);
    setCurrentImageUrl(source);
  }, [aiImageUrl, originalImages, photoMode]);

  useEffect(() => {
    if (!currentImageUrl || !currentImageUrl.startsWith('data:')) {
      setObjectUrl(currentImageUrl); // It's not a base64 string, use as is (or it's null)
      return;
    }

    // Convert base64 to blob URL for performance
    let newObjectUrl: string | null = null;
    try {
      const byteString = atob(currentImageUrl.split(',')[1]);
      const mimeString = currentImageUrl.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mimeString });
      newObjectUrl = URL.createObjectURL(blob);
      setObjectUrl(newObjectUrl);
    } catch {
      setObjectUrl(currentImageUrl); // Fallback to base64 on error
    }
    
    return () => {
      if (newObjectUrl) {
        URL.revokeObjectURL(newObjectUrl);
      }
    };
  }, [currentImageUrl]);

  const handleEdit = async () => {
    if (!currentImageUrl || !editPrompt) return;
    setIsEditLoading(true);
    const edited = await editPartImage(currentImageUrl, editPrompt);
    if (edited) setCurrentImageUrl(edited);
    setIsEditLoading(false);
    setIsEditing(false);
    setEditPrompt('');
  };

  const showLoading = photoMode === PhotoMode.AI && isGenerating && !currentImageUrl;

  if (showLoading) {
    return (
      <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center p-1 border border-slate-200 rounded">
        <div className="w-4 h-4 border-2 border-slate-200 border-t-cat-yellow rounded-full animate-spin mb-1"></div>
        <span className="text-[7px] font-black text-slate-400 uppercase text-center leading-none px-1">
          Generating...
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full group">
      {objectUrl ? (
        <div className="w-full h-full bg-white flex items-center justify-center overflow-hidden">
          <img 
            src={objectUrl} 
            alt={`Part ${partNo}`} 
            className="max-w-full max-h-full object-contain" 
          />
          <button 
            onClick={() => setIsEditing(true)}
            className="absolute bottom-1 right-1 p-1 bg-slate-900/80 text-white rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-cat-yellow hover:text-cat-black no-print"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
          </button>
        </div>
      ) : (
        <div className="w-full h-full bg-slate-50 flex items-center justify-center text-center p-1 border border-slate-100 rounded">
          <span className="text-[7px] font-black text-slate-300 uppercase leading-tight">
            IRON<br/>{partNo.substring(0, 5)}
          </span>
        </div>
      )}

      {isEditing && (
        <div className="fixed inset-0 z-[300] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4 no-print">
          <div className="bg-white p-8 rounded-[2rem] w-full max-w-md shadow-3xl">
            <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-900 mb-6 flex items-center gap-3">
              <svg className="w-4 h-4 text-cat-yellow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
              Nano Banana Image Editor
            </h4>
            <textarea 
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-xl text-xs font-medium outline-none focus:border-cat-yellow transition-all mb-6 h-32"
              placeholder='e.g., "Make it brighter" or "Change to a side profile view"'
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
            />
            <div className="flex gap-4">
              <button onClick={() => setIsEditing(false)} className="flex-1 py-3 bg-slate-100 text-[10px] font-black uppercase rounded-xl hover:bg-slate-200 transition-all">Cancel</button>
              <button onClick={handleEdit} disabled={isEditLoading} className="flex-1 py-3 bg-cat-black text-cat-yellow text-[10px] font-black uppercase rounded-xl hover:bg-cat-gray transition-all shadow-xl flex items-center justify-center">
                {isEditLoading ? <div className="w-4 h-4 border-2 border-cat-yellow/20 border-t-cat-yellow rounded-full animate-spin"></div> : "Apply AI Edit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
