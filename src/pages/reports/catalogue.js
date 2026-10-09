// Every report the Reports page offers, filed by folder. Adding a report is one
// entry here: the page builds its folders, lists and URLs from this list
// (/reports/<folder>/<report>).
import { Boxes } from 'lucide-react';
import ProductionBatchReport from './ProductionBatchReport';

export const REPORT_FOLDERS = [
    {
        id: 'production',
        title: 'Production',
        description: 'What each production batch drew, made, returned and wasted',
        icon: Boxes,
        color: 'bg-amber-600',
        reports: [
            {
                id: 'batch',
                title: 'Production Batch Report',
                description: 'Rolls godown before and after a batch, with its roll kg, made kg, return and waste',
                component: ProductionBatchReport
            }
        ]
    }
];

export const findFolder = (folderId) => REPORT_FOLDERS.find((f) => f.id === folderId) || null;
export const findReport = (folder, reportId) => folder?.reports.find((r) => r.id === reportId) || null;
