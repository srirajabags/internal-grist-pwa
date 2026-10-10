import React from 'react';
import { ArrowLeft, Phone, Handshake, ChevronRight } from 'lucide-react';
import Button from '../components/Button';
import { visibleSubpages } from '../utils/pageAccess';

// What each telecaller subpage is, for the hub. Who may open it lives in
// SUBPAGE_ROLE_REQUIREMENTS, not here.
const SUBPAGES = {
    'telecaller/calls': {
        title: 'Customer calls', description: 'Your call list, conversations and earnings',
        icon: Phone, color: 'bg-blue-600', path: '/telecaller/calls',
    },
    'telecaller/referrals': {
        title: 'Referral enquiries', description: 'Enquiries from the partner portal, best leads first',
        icon: Handshake, color: 'bg-emerald-600', path: '/telecaller/referrals',
    },
};

// /telecaller: the subpages this person may open, one tile each.
const TelecallerHome = ({ onBack, onNavigate, userRoles = [], godMode = false }) => {
    const pages = visibleSubpages('telecaller', userRoles, godMode).map((key) => SUBPAGES[key]).filter(Boolean);
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-3">
                <div className="max-w-3xl mx-auto flex items-center gap-3">
                    <Button variant="ghost" onClick={onBack} className="!px-2"><ArrowLeft size={20} /></Button>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><Phone size={18} /></div>
                        <h1 className="font-bold text-slate-800">Telecaller</h1>
                    </div>
                </div>
            </header>
            <main className="flex-1 w-full max-w-3xl mx-auto p-4 space-y-3">
                {pages.map((p) => (
                    <button key={p.path} onClick={() => onNavigate(p.path)}
                        className="flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:shadow-md transition-shadow">
                        <div className={`w-12 h-12 shrink-0 rounded-xl ${p.color} flex items-center justify-center text-white`}><p.icon size={24} /></div>
                        <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-800">{p.title}</p>
                            <p className="text-sm text-slate-500">{p.description}</p>
                        </div>
                        <ChevronRight size={20} className="text-slate-400" />
                    </button>
                ))}
            </main>
        </div>
    );
};

export default TelecallerHome;
