import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import Button from './Button';
import {
    RUNNING_BUILD, fetchDeployedBuild, isDifferentBuild, applyUpdate,
    updateAttempts, noteUpdateAttempt, MAX_FORCED_ATTEMPTS
} from '../utils/appUpdate';

// How often an open app looks for a newer deploy. Long enough that it is not a
// background chatter problem, short enough that a mid-shift fix reaches the floor
// the same shift.
const POLL_MS = 15 * 60 * 1000;

// Customers open /track embedded in the website. A staff update notice has no
// business interrupting them, and they have no PWA to update.
const isPublicPath = (pathname) => /^\/track(\/|$)/.test(pathname || '');

// Blocks the app when the server has moved to a different build. Deliberately not
// dismissable: a stale bundle talking to a changed schema is how bad rows get
// written, so the choice is to update, not to keep going.
const UpdateGate = ({ children }) => {
    const { pathname } = useLocation();
    const [deployed, setDeployed] = useState(null);
    const [updating, setUpdating] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const skip = isPublicPath(pathname);
    // A check in flight must not be started twice by the visibility and focus
    // handlers firing together when a phone is unlocked.
    const inFlight = useRef(false);

    const check = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        try {
            setDeployed(await fetchDeployedBuild());
        } catch {
            // Offline, or the file is not there yet. Leave the last answer alone —
            // a failed check is not evidence of a new build.
        } finally {
            inFlight.current = false;
        }
    }, []);

    useEffect(() => {
        if (skip) return undefined;
        check();
        const id = setInterval(check, POLL_MS);
        // Coming back to a backgrounded PWA is the moment a stale build is most
        // likely and the interval least likely to have run.
        const onWake = () => { if (document.visibilityState === 'visible') check(); };
        document.addEventListener('visibilitychange', onWake);
        window.addEventListener('focus', onWake);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', onWake);
            window.removeEventListener('focus', onWake);
        };
    }, [check, skip]);

    const stale = !skip && isDifferentBuild(deployed);
    // Only offer a way past once reloading has visibly failed to help.
    const canContinue = stale && updateAttempts(deployed.version) >= MAX_FORCED_ATTEMPTS;

    const onUpdate = async () => {
        setUpdating(true);
        noteUpdateAttempt(deployed.version);
        await applyUpdate();
    };

    return (
        <>
            {children}
            {stale && !dismissed && (
                <div className="fixed inset-0 z-[100] bg-slate-900/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
                    <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl shadow-2xl overflow-hidden">
                        <div className="px-5 pt-5 pb-4">
                            <div className="flex items-center gap-3 mb-3">
                                <span className="w-10 h-10 rounded-xl bg-green-100 text-green-700 flex items-center justify-center shrink-0">
                                    <Sparkles size={20} />
                                </span>
                                <div className="min-w-0">
                                    <h2 className="font-bold text-slate-800 leading-tight">A new version is ready</h2>
                                    <p className="text-xs text-slate-500">Reload to carry on</p>
                                </div>
                            </div>
                            <p className="text-sm text-slate-600 mb-4">
                                This app is running an older build than the one on the server. Update now so
                                what you save matches what the rest of the team sees.
                            </p>
                            <dl className="text-[11px] rounded-lg bg-slate-50 border border-slate-100 divide-y divide-slate-100">
                                <div className="flex justify-between gap-3 px-3 py-2">
                                    <dt className="text-slate-500 shrink-0">This app</dt>
                                    <dd className="font-mono text-slate-700 text-right break-all">{RUNNING_BUILD.buildTimestampIstReadable}</dd>
                                </div>
                                <div className="flex justify-between gap-3 px-3 py-2">
                                    <dt className="text-slate-500 shrink-0">On the server</dt>
                                    <dd className="font-mono text-slate-800 font-semibold text-right break-all">
                                        {deployed.buildTimestampIstReadable || deployed.version.slice(0, 12)}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                        <div className="px-5 pb-5 space-y-2">
                            <Button
                                variant="primary"
                                className="w-full"
                                disabled={updating}
                                icon={updating ? undefined : RefreshCw}
                                onClick={onUpdate}
                            >
                                {updating ? <><Loader2 size={18} className="animate-spin" /> Updating…</> : 'Update now'}
                            </Button>
                            {canContinue && (
                                <button
                                    onClick={() => setDismissed(true)}
                                    className="w-full text-xs text-slate-400 hover:text-slate-600 py-1"
                                >
                                    Updating did not help — carry on for now
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default UpdateGate;
