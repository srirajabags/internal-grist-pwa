import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, AlertCircle, Camera, Keyboard, ScanLine } from 'lucide-react';
import Button from './Button';
import { readRollCode } from '../utils/rollCode';

// Camera QR scanning. Chrome on Android has BarcodeDetector natively, which is
// faster and needs no download; everywhere else (notably iOS Safari) falls back
// to jsQR over a canvas frame. Manual entry is always offered, because a torn or
// greasy label is a normal thing in a godown.
const QrScanModal = ({ onClose, onScan }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const rafRef = useRef(null);
    const doneRef = useRef(false);

    const [status, setStatus] = useState('starting');   // starting | scanning | error
    const [error, setError] = useState(null);
    const [manual, setManual] = useState('');
    const [engine, setEngine] = useState(null);         // native | jsqr
    const [slow, setSlow] = useState(false);

    const stop = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
    }, []);

    const finish = useCallback((text) => {
        if (doneRef.current) return;
        doneRef.current = true;
        stop();
        // The raw payload travels with the parsed id: when a label does not
        // resolve, the operator has to be able to see what was actually read.
        onScan({ raw: String(text || ''), id: readRollCode(text) });
    }, [onScan, stop]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error('This browser cannot open the camera. Type the roll id instead.');
                }
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' } },
                    audio: false
                });
                if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
                streamRef.current = stream;
                const video = videoRef.current;
                if (!video) return;
                video.srcObject = stream;
                video.setAttribute('playsinline', 'true');   // iOS refuses fullscreen-less video without it
                await video.play();
                setStatus('scanning');

                // jsQR is only fetched when it is actually needed, and only once
                // the scanner is open: bundling it up front pushed the main chunk
                // over the service worker's precache limit and would cost every
                // user ~130KB for a feature most never open.
                let decode = null;
                const loadJsQr = async () => {
                    if (!decode) decode = (await import('jsqr')).default;
                    return decode;
                };

                // BarcodeDetector exists in several browsers that cannot actually
                // decode a QR -- the constructor succeeds and detect() then throws
                // or never matches. Ask what it supports first, and abandon it for
                // jsQR at the first sign of trouble rather than looping in silence.
                let detector = null;
                if ('BarcodeDetector' in window) {
                    try {
                        const formats = await window.BarcodeDetector.getSupportedFormats();
                        if (formats?.includes('qr_code')) {
                            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                        }
                    } catch {
                        detector = null;
                    }
                }
                if (!detector) await loadJsQr();
                if (cancelled) return;
                setEngine(detector ? 'native' : 'jsqr');

                let last = 0;
                const tick = async (now) => {
                    rafRef.current = requestAnimationFrame(tick);
                    // ~8 reads a second is plenty and keeps the phone cool.
                    if (now - last < 120) return;
                    last = now;
                    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

                    try {
                        if (detector) {
                            try {
                                const hits = await detector.detect(video);
                                if (hits.length > 0) finish(hits[0].rawValue);
                                return;
                            } catch {
                                // The native path is broken here; switch for good.
                                detector = null;
                                await loadJsQr();
                                setEngine('jsqr');
                                return;
                            }
                        }
                        const canvas = canvasRef.current;
                        if (!canvas) return;
                        const w = video.videoWidth, h = video.videoHeight;
                        if (!w || !h) return;
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d', { willReadFrequently: true });
                        ctx.drawImage(video, 0, 0, w, h);
                        const hit = decode?.(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
                        if (hit?.data) finish(hit.data);
                    } catch {
                        // A single bad frame is not worth stopping the loop over.
                    }
                };
                rafRef.current = requestAnimationFrame(tick);
            } catch (err) {
                if (cancelled) return;
                setStatus('error');
                setError(
                    err?.name === 'NotAllowedError'
                        ? 'Camera access was blocked. Allow it in your browser, or type the roll id below.'
                        : err?.message || 'Could not start the camera.'
                );
            }
        })();

        // If nothing has decoded after a few seconds, say so rather than leaving
        // the operator staring at a live camera wondering whether it is working.
        const slowTimer = setTimeout(() => setSlow(true), 6000);

        return () => { cancelled = true; clearTimeout(slowTimer); stop(); };
    }, [finish, stop]);

    return (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
                            <ScanLine size={18} />
                        </span>
                        <div>
                            <h2 className="font-bold text-slate-800 leading-tight">Scan roll label</h2>
                            <p className="text-xs text-slate-500">Point the camera at the roll&apos;s QR code</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
                </div>

                <div className="relative bg-slate-900 aspect-[4/3]">
                    <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
                    <canvas ref={canvasRef} className="hidden" />

                    {status !== 'error' && (
                        <>
                            {/* Aiming frame */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-2/3 aspect-square rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                            </div>
                            {status === 'scanning' && slow && (
                                <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white/90 text-[11px] px-3 py-2 text-center">
                                    Still looking… hold steady, fill the frame with the code, and check the light.
                                    {engine ? ` (${engine === 'native' ? 'device scanner' : 'jsQR'})` : ''}
                                </div>
                            )}
                            {status === 'starting' && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 gap-2">
                                    <Loader2 size={28} className="animate-spin" />
                                    <p className="text-sm">Opening the camera…</p>
                                </div>
                            )}
                        </>
                    )}

                    {status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 gap-2 text-white/85">
                            <Camera size={28} />
                            <p className="text-sm">{error}</p>
                        </div>
                    )}
                </div>

                <div className="p-4">
                    {status === 'error' && error && (
                        <div className="mb-3 p-2.5 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                            <p className="text-xs break-words">{error}</p>
                        </div>
                    )}
                    <label className="block">
                        <span className="text-[11px] text-slate-500 mb-1 flex items-center gap-1.5">
                            <Keyboard size={13} /> Or type the roll id
                        </span>
                        <div className="flex gap-2">
                            <input
                                value={manual}
                                onChange={(e) => setManual(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) finish(manual); }}
                                placeholder="ROLL_30-06-2026_0182"
                                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 font-mono text-sm"
                            />
                            <Button
                                variant="primary"
                                className="bg-teal-600 hover:bg-teal-700"
                                disabled={!manual.trim()}
                                onClick={() => finish(manual)}
                            >
                                Find
                            </Button>
                        </div>
                    </label>
                </div>
            </div>
        </div>
    );
};

export default QrScanModal;
