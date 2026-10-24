import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Folder, FileText, ChevronRight } from 'lucide-react';
import Button from '../components/Button';
import Card from '../components/Card';
import { REPORT_FOLDERS, findFolder, findReport } from './reports/catalogue';
import { canAccessPath } from '../utils/pageAccess';

// Reports, filed into folders. Three levels, each its own URL so the back button
// and a shared link both land where they should:
//   /reports                     the folders
//   /reports/<folder>            the reports in one folder
//   /reports/<folder>/<report>   the report itself
const ReportsView = ({ onBack, getHeaders, getUrl, userRoles = [], godMode = false }) => {
    const { folderId, reportId } = useParams();
    const navigate = useNavigate();

    const folder = folderId ? findFolder(folderId) : null;
    const report = reportId ? findReport(folder, reportId) : null;
    const missing = (folderId && !folder) || (reportId && !report);

    const up = () => {
        if (reportId && folder) navigate(`/reports/${folder.id}`);
        else if (folderId) navigate('/reports');
        else onBack();
    };

    const title = report?.title || folder?.title || 'Reports';
    const subtitle = report ? folder.title : folder ? 'Reports' : 'Data dashboards, by folder';
    const Icon = folder?.icon || ClipboardList;
    const Report = report?.component;
    // Each folder has its own roles; the route guard stops a direct link, and
    // this keeps the hub from offering a folder that would only refuse.
    const folders = REPORT_FOLDERS.filter((f) => canAccessPath(`/reports/${f.id}`, userRoles, godMode));

    return (
        <div className="min-h-screen bg-slate-50 print:bg-white">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-3 py-2.5 print:hidden">
                <div className="max-w-4xl mx-auto flex items-center gap-2">
                    <Button variant="ghost" onClick={up} className="!px-2 shrink-0">
                        <ArrowLeft size={20} />
                    </Button>
                    <div className={`w-8 h-8 ${folder?.color || 'bg-sky-600'} rounded-lg flex items-center justify-center text-white shrink-0`}>
                        <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="font-bold text-slate-800 leading-tight truncate">{missing ? 'Reports' : title}</h1>
                        <p className="text-xs text-slate-500 truncate">{missing ? 'Not found' : subtitle}</p>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto p-4 print:p-0">
                {missing && (
                    <Card className="p-6 text-center">
                        <p className="text-slate-600 mb-4">That report does not exist.</p>
                        <Button variant="secondary" onClick={() => navigate('/reports')} className="mx-auto">All reports</Button>
                    </Card>
                )}

                {!missing && !folder && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {folders.map((f) => (
                            <button
                                key={f.id}
                                onClick={() => navigate(`/reports/${f.id}`)}
                                className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-left hover:shadow-md hover:border-slate-300 transition-all flex items-start gap-3"
                            >
                                <div className={`w-11 h-11 ${f.color} rounded-lg flex items-center justify-center text-white shrink-0`}>
                                    <Folder size={22} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold text-slate-800">{f.title}</div>
                                    <div className="text-sm text-slate-500">{f.description}</div>
                                    <div className="text-xs text-slate-400 mt-1">{f.reports.length} report{f.reports.length === 1 ? '' : 's'}</div>
                                </div>
                                <ChevronRight size={18} className="text-slate-400 shrink-0 mt-3" />
                            </button>
                        ))}
                    </div>
                )}

                {!missing && folder && !report && (
                    <Card className="divide-y divide-slate-100">
                        {folder.reports.map((r) => (
                            <button
                                key={r.id}
                                onClick={() => navigate(`/reports/${folder.id}/${r.id}`)}
                                className="w-full p-4 text-left hover:bg-slate-50 transition-colors flex items-start gap-3"
                            >
                                <FileText size={20} className="text-slate-400 shrink-0 mt-0.5" />
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-slate-800">{r.title}</div>
                                    <div className="text-sm text-slate-500">{r.description}</div>
                                </div>
                                <ChevronRight size={18} className="text-slate-400 shrink-0 mt-0.5" />
                            </button>
                        ))}
                    </Card>
                )}

                {!missing && Report && <Report getHeaders={getHeaders} getUrl={getUrl} />}
            </main>
        </div>
    );
};

export default ReportsView;
