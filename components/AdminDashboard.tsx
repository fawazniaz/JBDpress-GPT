
import React from 'react';
import { TextbookModule } from '../types';
import { TrashIcon } from './Icons';

interface AdminDashboardProps {
    onClose: () => void;
    textbooks: TextbookModule[];
    onDeleteModule: (storeName: string) => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose, textbooks, onDeleteModule }) => {
    return (
        <div className="flex flex-col h-screen p-8 bg-gem-onyx-light dark:bg-gem-onyx-dark overflow-y-auto">
            <div className="max-w-6xl mx-auto w-full">
                <div className="flex justify-between items-center mb-12">
                    <div>
                        <h1 className="text-4xl font-black mb-2">System Admin</h1>
                        <p className="opacity-60">Repository Management & Health Monitor.</p>
                    </div>
                    <button onClick={onClose} className="px-6 py-3 bg-gem-mist-light dark:bg-gem-mist-dark border border-gem-mist-light dark:border-gem-mist-dark rounded-full font-bold hover:bg-gem-blue hover:text-white transition-all shadow-md active:scale-95">
                        Close Dashboard
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Repository Management Section */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white dark:bg-gem-slate-dark p-8 rounded-[32px] shadow-xl border border-gem-mist-light dark:border-gem-mist-dark">
                            <div className="flex justify-between items-center mb-8">
                                <h2 className="text-2xl font-black">Active Course Modules</h2>
                                <span className="bg-gem-blue/10 text-gem-blue px-3 py-1 rounded-full text-xs font-black">
                                    {textbooks.length} TOTAL
                                </span>
                            </div>

                            {textbooks.length === 0 ? (
                                <div className="p-12 text-center opacity-40 border-2 border-dashed rounded-2xl">
                                    No modules currently in storage.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {textbooks.map((lib, idx) => (
                                        <div 
                                            key={idx} 
                                            className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-6 bg-gem-onyx-light dark:bg-gem-onyx-dark/50 rounded-2xl border border-gem-mist-light dark:border-gem-mist-dark hover:border-gem-blue transition-colors group"
                                        >
                                            <div className="mb-4 sm:mb-0">
                                                <h3 className="font-bold text-lg">{lib.name}</h3>
                                                <p className="text-[10px] font-mono opacity-50 mb-1">{lib.storeName}</p>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded font-black">
                                                        {lib.books.length} FILES
                                                    </span>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    if (window.confirm(`Delete "${lib.name}" and free up space?`)) {
                                                        onDeleteModule(lib.storeName);
                                                    }
                                                }}
                                                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 rounded-xl font-black text-xs hover:bg-red-500 hover:text-white transition-all shadow-sm group-hover:scale-105"
                                            >
                                                <TrashIcon />
                                                <span>DELETE</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Stats and Health Section */}
                    <div className="space-y-6">
                        <div className="bg-emerald-500 text-white p-8 rounded-[32px] shadow-xl">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="text-4xl">🛡️</div>
                                <h2 className="text-xl font-black">Integrity Status</h2>
                            </div>
                            <p className="text-sm font-bold leading-relaxed opacity-90">
                                Your repository is clean. Use the management list to manually clear space if you hit the 1GB quota limit.
                            </p>
                            <div className="mt-6 pt-6 border-t border-white/20">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
                                    <span className="text-[10px] font-black uppercase tracking-widest">Global Servers Online</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-gem-slate-dark p-8 rounded-[32px] border border-gem-mist-light dark:border-gem-mist-dark shadow-xl">
                            <h3 className="font-black mb-6 flex items-center gap-2">
                                📊 Regional Distribution
                            </h3>
                            <div className="space-y-4">
                                {[
                                    { name: 'Punjab', val: 55, color: 'bg-gem-blue' },
                                    { name: 'Sindh', val: 25, color: 'bg-gem-teal' },
                                    { name: 'KPK', val: 12, color: 'bg-amber-500' },
                                ].map(region => (
                                    <div key={region.name}>
                                        <div className="flex justify-between text-[10px] font-black mb-1 opacity-70 uppercase">
                                            <span>{region.name}</span>
                                            <span>{region.val}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-gem-mist-light dark:bg-gem-mist-dark rounded-full overflow-hidden">
                                            <div className={`h-full ${region.color}`} style={{ width: `${region.val}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-gem-blue text-white p-8 rounded-[32px] shadow-xl">
                            <h3 className="text-xl font-black mb-2">Capacity Check</h3>
                            <p className="text-xs opacity-80 leading-relaxed mb-6">
                                Free Tier: 1GB per project. Deleting old modules immediately restores your ability to upload.
                            </p>
                            <div className="text-center py-4 bg-white/10 rounded-2xl">
                                <p className="text-3xl font-black">{textbooks.length}</p>
                                <p className="text-[10px] font-black opacity-60 uppercase">Modules Created</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
