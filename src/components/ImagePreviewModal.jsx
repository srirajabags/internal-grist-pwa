import React from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';

// Full-screen look at one attachment — the order form, mostly. Tap anywhere to
// dismiss, since on the floor the whole screen is the closest thing to a target.
const ImagePreviewModal = ({ src, loading, onClose, title = 'Order form' }) => (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4" onClick={onClose}>
        <button onClick={onClose} className="absolute top-4 right-4 text-white hover:text-slate-300 p-2">
            <X size={32} />
        </button>
        <div className="max-w-4xl max-h-[90vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {loading ? (
                <div className="text-white flex flex-col items-center">
                    <Loader2 size={48} className="animate-spin mb-4" />
                    <p>Loading {title.toLowerCase()}…</p>
                </div>
            ) : src ? (
                <img src={src} alt={title} className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
            ) : (
                <div className="text-white text-center">
                    <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
                    <p>{title} not available</p>
                </div>
            )}
        </div>
    </div>
);

export default ImagePreviewModal;
