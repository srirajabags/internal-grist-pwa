import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { pushSupport, readEnvironment, currentSubscription, turnOn, turnOff } from '../services/push';

// The "Notifications on this phone" box in Settings. Each phone is set on its
// own: turning it on here does not turn it on for the same person elsewhere.
const NotificationsSetting = ({ getHeaders, getUrl, impersonating }) => {
  const [support] = useState(() => pushSupport(readEnvironment()));
  const [state, setState] = useState('checking'); // checking | on | off | blocked
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (support !== 'supported') return;
    let alive = true;
    (async () => {
      try {
        if (Notification.permission === 'denied') { if (alive) setState('blocked'); return; }
        const sub = await currentSubscription();
        if (alive) setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
      } catch (e) {
        if (alive) { setState('off'); setError(e.message); }
      }
    })();
    return () => { alive = false; };
  }, [support]);

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      if (state === 'on') {
        await turnOff(getHeaders, getUrl);
        setState('off');
      } else {
        await turnOn(getHeaders, getUrl);
        setState('on');
      }
    } catch (e) {
      setError(e.message);
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') setState('blocked');
    } finally {
      setBusy(false);
    }
  };

  let status;
  if (support === 'ios-install') {
    status = 'On iPhone, notifications work only in the installed app: tap Share, then "Add to Home Screen", and open the app from there.';
  } else if (support === 'unsupported') {
    status = 'This browser cannot receive notifications. Use Chrome on Android, or the app added to the Home Screen on iPhone.';
  } else if (state === 'blocked') {
    status = 'Notifications are blocked for this app. Allow them in the phone settings for this site, then come back here.';
  } else if (state === 'on') {
    status = 'On. This phone will get notifications from the team app.';
  } else if (state === 'off') {
    status = 'Off on this phone.';
  } else {
    status = 'Checking…';
  }

  const canToggle = support === 'supported' && (state === 'on' || state === 'off') && !impersonating;

  return (
    <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
      <div className="flex items-start gap-3">
        {state === 'on' ? <Bell size={18} className="text-green-600 mt-0.5 shrink-0" /> : <BellOff size={18} className="text-slate-400 mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700">Notifications on this phone</p>
          <p className="text-xs text-slate-500 mt-1">{status}</p>
          {impersonating && support === 'supported' && (
            <p className="text-xs text-amber-700 mt-1">Clear impersonation to change this phone's setting.</p>
          )}
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </div>
      </div>
      {canToggle && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`mt-3 w-full px-3 py-2 text-sm rounded-lg transition-colors flex items-center justify-center gap-2 ${state === 'on' ? 'bg-slate-200 hover:bg-slate-300 text-slate-700' : 'bg-green-600 hover:bg-green-700 text-white'} disabled:opacity-60`}
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {state === 'on' ? 'Turn off' : 'Turn on notifications'}
        </button>
      )}
    </div>
  );
};

export default NotificationsSetting;
