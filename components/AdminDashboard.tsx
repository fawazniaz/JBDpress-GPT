
import React, { useState } from 'react';
import { TextbookModule } from '../types';
import { TrashIcon, RefreshIcon } from './Icons';
import Spinner from './Spinner';

interface AdminDashboardProps {
    onClose: () => void;
    textbooks: TextbookModule[];
    onDeleteModule: (storeName: string) => void;
    onDeleteFile: (storeName: string, fileName: string) => void;
    onDeepSync: () => void;
    isSyncing: boolean;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose, textbooks, onDeleteModule, onDeleteFile, onDeepSync, isSyncing }) => {
    const [expandedModule, setExpandedModule] = useState<string | null>(null);

    return (
        <div className="flex flex-col h-screen p-8 bg-gem-onyx-light dark:bg-gem-onyx-dark overflow-y-auto">
            <div className="max-w-6xl mx-auto w-full">
                <div className="flex justify-between items-center mb-12">
                    <div>
                        <h1 className="text-4xl font-black mb-2 uppercase tracking-tighter">Repository Admin</h1>
                        <p className="opacity-60 text-sm font-bold">Monitor and manage your 1GB Cloud Storage quota.</p>
                    </div>
                    <div className="flex gap-4">
                        <button onClick={onDeepSync} disabled={isSyncing} className={`p-4 bg-white dark:bg-gem-slate-dark border border-gem-mist-light dark:border-gem-mist-dark rounded-full shadow-lg flex items-center gap-2 font-black text-xs hover:border-gem-blue transition-all ${isSyncing ? 'animate-pulse' : ''}`}>
                            {isSyncing ? <Spinner /> : <RefreshIcon />} DEEP SYNC
                        </button>
                        <button onClick={onClose} className="px-8 py-4 bg-gem-blue text-white rounded-full font-black shadow-xl hover:scale-105 active:scale-95 transition-all">
                            EXIT DASHBOARD
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white dark:bg-gem-slate-dark p-8 rounded-[40px] shadow-2xl border border-gem-mist-light dark:border-gem-mist-dark">
                            <h2 className="text-2xl font-black mb-8 flex items-center justify-between">
                                Course Storage Modules
                                <span className="text-xs bg-gem-blue text-white px-3 py-1 rounded-full">{textbooks.length} ACTIVE</span>
                            </h2>

                            {textbooks.length === 0 ? (
                                <div className="p-20 text-center opacity-30 border-2 border-dashed rounded-3xl">
                                    No cloud modules detected.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {textbooks.map((lib, idx) => (
                                        <div key={idx} className="border border-gem-mist-light dark:border-gem-mist-dark rounded-3xl overflow-hidden bg-gem-onyx-light dark:bg-black/10">
                                            <div 
                                                className="p-6 flex justify-between items-center cursor-pointer hover:bg-gem-blue/5"
                                                onClick={() => setExpandedModule(expandedModule === lib.storeName ? null : lib.storeName)}
                                            >
                                                <div>
                                                    <h3 className="font-black text-lg">{lib.name}</h3>
                                                    <p className="text-[10px] font-mono opacity-50">{lib.storeName}</p>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <span className="text-[10px] font-black bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full uppercase">
                                                        {lib.books.length} Files
                                                    </span>
                                                    <button onClick={(e) => { e.stopPropagation(); if(confirm("Delete entire module and all its files?")) onDeleteModule(lib.storeName); }} className="text-red-500 p-2 hover:bg-red-500 hover:text-white rounded-xl transition-all">
                                                        <TrashIcon />
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            {expandedModule === lib.storeName && (
                                                <div className="p-6 bg-white dark:bg-gem-slate-dark border-t border-gem-mist-light dark:border-gem-mist-dark space-y-3">
                                                    <p className="text-[10px] font-black opacity-30 uppercase mb-4">Individual File Management:</p>
                                                    {lib.books.map((book, bIdx) => (
                                                        <div key={bIdx} className="flex justify-between items-center p-3 bg-gem-onyx-light dark:bg-black/20 rounded-xl text-xs font-bold">
                                                            <span className="truncate max-w-[70%]">{book}</span>
                                                            <button 
                                                                onClick={() => { if(confirm(`Delete file "${book}"?`)) onDeleteFile(lib.storeName, book); }}
                                                                className="text-[10px] bg-red-500/10 text-red-500 px-3 py-1 rounded-lg hover:bg-red-500 hover:text-white transition-all"
                                                            >
                                                                REMOVE FILE
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-8">
                        <div className="bg-gem-blue text-white p-10 rounded-[40px] shadow-2xl">
                            <h3 className="text-3xl font-black mb-4">Capacity Check</h3>
                            <p className="text-sm opacity-80 mb-8 leading-relaxed font-bold">
                                Your free tier allows 1GB. If you hit the limit, delete old files or entire modules above.
                            </p>
                            <div className="bg-white/10 p-8 rounded-3xl text-center border border-white/20">
                                <div className="text-5xl font-black mb-1">{textbooks.length}</div>
                                <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Modules Provisioned</div>
                            </div>
                        </div>

                        <div className="bg-emerald-500 text-white p-10 rounded-[40px] shadow-2xl">
                            <h3 className="text-2xl font-black mb-4">System Health</h3>
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
                                    <span className="text-xs font-black uppercase">Gemini RAG Engine Online</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-3 h-3 bg-white rounded-full"></div>
                                    <span className="text-xs font-black uppercase">Sync Integrity: High</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
