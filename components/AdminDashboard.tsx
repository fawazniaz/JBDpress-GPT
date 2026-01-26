
import React, { useState } from 'react';
import { TextbookModule, CloudFile } from '../types';
import { TrashIcon, RefreshIcon } from './Icons';
import Spinner from './Spinner';

interface AdminDashboardProps {
    onClose: () => void;
    textbooks: TextbookModule[];
    cloudFiles: CloudFile[];
    onDeleteModule: (storeName: string) => void;
    onDeleteRawFile: (fileName: string) => void;
    onPurgeAll: () => void;
    onDeepSync: () => void;
    isSyncing: boolean;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
    onClose, textbooks, cloudFiles, onDeleteModule, onDeleteRawFile, onPurgeAll, onDeepSync, isSyncing 
}) => {
    const [view, setView] = useState<'modules' | 'raw'>('modules');

    const formatSize = (bytes: string) => {
        const b = parseInt(bytes);
        if (isNaN(b)) return "N/A";
        return (b / (1024 * 1024)).toFixed(2) + " MB";
    };

    return (
        <div className="flex flex-col h-screen p-8 bg-gem-onyx-light dark:bg-gem-onyx-dark overflow-y-auto">
            <div className="max-w-6xl mx-auto w-full">
                <div className="flex justify-between items-center mb-12">
                    <div>
                        <h1 className="text-4xl font-black mb-2 uppercase tracking-tighter">Repository Admin</h1>
                        <p className="opacity-60 text-sm font-bold">Manage your 1GB Cloud Storage quota directly.</p>
                    </div>
                    <div className="flex gap-4">
                        <button onClick={onDeepSync} disabled={isSyncing} className="p-4 bg-white dark:bg-gem-slate-dark border border-gem-mist-light dark:border-gem-mist-dark rounded-full shadow-lg flex items-center gap-2 font-black text-xs">
                            {isSyncing ? <Spinner /> : <RefreshIcon />} DEEP SYNC
                        </button>
                        <button onClick={onClose} className="px-8 py-4 bg-gem-blue text-white rounded-full font-black shadow-xl">EXIT</button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="flex gap-2 mb-4 bg-gem-mist-light dark:bg-gem-mist-dark p-1 rounded-2xl w-fit">
                            <button onClick={() => setView('modules')} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${view === 'modules' ? 'bg-white dark:bg-gem-slate-dark shadow-md' : 'opacity-50'}`}>COURSE MODULES</button>
                            <button onClick={() => setView('raw')} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${view === 'raw' ? 'bg-white dark:bg-gem-slate-dark shadow-md' : 'opacity-50'}`}>DIRECT STORAGE (QUOTA)</button>
                        </div>

                        <div className="bg-white dark:bg-gem-slate-dark p-8 rounded-[40px] shadow-2xl border border-gem-mist-light dark:border-gem-mist-dark min-h-[400px]">
                            {view === 'modules' ? (
                                <div className="space-y-4">
                                    <h2 className="text-xl font-black mb-6">Instructional Units</h2>
                                    {textbooks.length === 0 ? <p className="opacity-30 text-center py-20 font-bold">No active modules.</p> : textbooks.map((lib, idx) => (
                                        <div key={idx} className="p-6 bg-gem-onyx-light dark:bg-black/10 rounded-3xl flex justify-between items-center border border-gem-mist-light dark:border-gem-mist-dark">
                                            <div>
                                                <h3 className="font-black">{lib.name}</h3>
                                                <p className="text-[10px] opacity-40 font-mono uppercase">{lib.books.length} Books Attached</p>
                                            </div>
                                            <button onClick={() => { if(confirm("Delete module?")) onDeleteModule(lib.storeName); }} className="p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all">
                                                <TrashIcon />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center mb-6">
                                        <h2 className="text-xl font-black">All Cloud Files</h2>
                                        <button onClick={onPurgeAll} className="px-4 py-2 bg-red-500 text-white text-[10px] font-black rounded-lg hover:brightness-110">PURGE ALL STORAGE</button>
                                    </div>
                                    <p className="text-[10px] opacity-50 mb-4 uppercase font-black">These files are the actual consumers of your 1GB quota.</p>
                                    {cloudFiles.length === 0 ? <p className="opacity-30 text-center py-20 font-bold">Cloud storage is empty.</p> : cloudFiles.map((file, idx) => {
                                        const isOrphaned = !textbooks.some(t => t.books.includes(file.displayName) || t.books.includes(file.name));
                                        return (
                                            <div key={idx} className={`p-4 rounded-2xl flex justify-between items-center border ${isOrphaned ? 'border-amber-500/30 bg-amber-500/5' : 'border-gem-mist-light dark:border-gem-mist-dark bg-gem-onyx-light dark:bg-black/10'}`}>
                                                <div className="truncate pr-4">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="font-bold text-xs truncate max-w-[200px]">{file.displayName || file.name.split('/').pop()}</h3>
                                                        {isOrphaned && <span className="text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-black">ORPHANED</span>}
                                                    </div>
                                                    <p className="text-[10px] opacity-40 uppercase font-black">{formatSize(file.sizeBytes)} • {new Date(file.createTime).toLocaleDateString()}</p>
                                                </div>
                                                <button onClick={() => { if(confirm("Permanently delete this cloud file?")) onDeleteRawFile(file.name); }} className="text-red-500 hover:scale-110 transition-transform">
                                                    <TrashIcon />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-8">
                        <div className="bg-gem-blue text-white p-10 rounded-[40px] shadow-2xl">
                            <h3 className="text-3xl font-black mb-4">Quota Usage</h3>
                            <div className="space-y-6">
                                <div className="p-6 bg-white/10 rounded-2xl border border-white/20">
                                    <p className="text-[10px] font-black uppercase opacity-60">Total Files</p>
                                    <p className="text-4xl font-black">{cloudFiles.length}</p>
                                </div>
                                <div className="p-6 bg-white/10 rounded-2xl border border-white/20">
                                    <p className="text-[10px] font-black uppercase opacity-60">Est. Usage</p>
                                    <p className="text-4xl font-black">
                                        {(cloudFiles.reduce((acc, f) => acc + (parseInt(f.sizeBytes) || 0), 0) / (1024 * 1024)).toFixed(1)} <span className="text-sm">MB</span>
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-emerald-500 text-white p-10 rounded-[40px] shadow-2xl">
                            <h3 className="text-2xl font-black mb-4">Reset Help</h3>
                            <p className="text-xs font-bold leading-relaxed opacity-90 mb-6">
                                If you see "Storage Limit Reached" but have 0 modules, switch to "DIRECT STORAGE" and click "PURGE ALL STORAGE" to force a hard reset of your 1GB cloud quota.
                            </p>
                            <div className="flex items-center gap-3">
                                <div className="w-2 h-2 bg-white rounded-full animate-ping"></div>
                                <span className="text-[10px] font-black uppercase">Direct API Connection: Active</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
