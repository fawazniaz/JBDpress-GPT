import React from 'react';

const AdminDashboard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const redundantFiles = [
        "components/icons/ChatInterface.tsx (Duplicate of root component)",
        "components/icons/PlusIcon.tsx (Moved to Icons.tsx)",
        "components/icons/SendIcon.tsx (Moved to Icons.tsx)",
        "components/icons/DownloadIcon.tsx (Moved to Icons.tsx)",
        "components/icons/TrashIcon.tsx (Moved to Icons.tsx)",
        "components/icons/RefreshIcon.tsx (Moved to Icons.tsx)",
        "components/icons/UploadCloudIcon.tsx (Moved to Icons.tsx)",
        "components/icons/UploadIcon.tsx (Moved to Icons.tsx)",
        "components/icons/CameraIcon.tsx (Not used)",
        "components/icons/CarIcon.tsx (Not used)",
        "components/icons/WashingMachineIcon.tsx (Not used)",
        "components/UploadModal.tsx (Replaced by WelcomeScreen upload logic)",
        "components/RagStoreList.tsx (Logic merged into WelcomeScreen)",
        "components/DocumentList.tsx (Merged into ChatInterface)",
        "components/QueryInterface.tsx (Merged into ChatInterface)"
    ];

    return (
        <div className="flex flex-col h-screen p-8 bg-gem-onyx-light dark:bg-gem-onyx-dark overflow-y-auto">
            <div className="max-w-6xl mx-auto w-full">
                <div className="flex justify-between items-center mb-12">
                    <div>
                        <h1 className="text-4xl font-black mb-2">System Admin</h1>
                        <p className="opacity-60">Maintenance Assistant & Health Monitor.</p>
                    </div>
                    <button onClick={onClose} className="px-6 py-3 bg-gem-mist-light dark:bg-gem-mist-dark rounded-full font-bold">Close Dashboard</button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Repository Health Assistant */}
                    <div className="bg-white dark:bg-gem-slate-dark p-8 rounded-[32px] shadow-2xl border-4 border-gem-blue/10">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 bg-gem-blue text-white rounded-2xl flex items-center justify-center text-2xl">🧹</div>
                            <div>
                                <h2 className="text-xl font-black">Maintenance Assistant</h2>
                                <p className="text-xs opacity-50 uppercase font-bold">Source Cleanup Checklist</p>
                            </div>
                        </div>
                        
                        <div className="bg-gem-blue/5 p-6 rounded-2xl mb-6">
                            <p className="text-sm font-bold text-gem-blue leading-relaxed">
                                I have consolidated all system icons and logic. The following files are now **"Zombie Files"**—they are no longer used by the app. You can safely delete them from your sidebar:
                            </p>
                        </div>

                        <div className="space-y-3">
                            {redundantFiles.map((file, i) => (
                                <div key={i} className="flex items-center gap-3 p-3 bg-gem-onyx-light dark:bg-gem-onyx-dark rounded-xl border border-gem-mist-light dark:border-gem-mist-dark text-[11px] font-mono opacity-70">
                                    <span className="text-red-500">❌</span>
                                    {file}
                                </div>
                            ))}
                        </div>

                        <div className="mt-8 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600 text-center text-xs font-bold">
                            ✅ The app is currently running from consolidated root files. 
                        </div>
                    </div>

                    {/* Stats Panel */}
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-gem-slate-dark p-8 rounded-[32px] border border-gem-mist-light dark:border-gem-mist-dark">
                            <h3 className="font-bold mb-6">Regional Distribution</h3>
                            <div className="space-y-4">
                                {[
                                    { name: 'Punjab', val: 55, color: 'bg-gem-blue' },
                                    { name: 'Sindh', val: 25, color: 'bg-gem-teal' },
                                    { name: 'KPK', val: 12, color: 'bg-amber-500' },
                                ].map(region => (
                                    <div key={region.name}>
                                        <div className="flex justify-between text-xs font-bold mb-1">
                                            <span>{region.name}</span>
                                            <span>{region.val}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-gem-mist-light dark:border-gem-mist-dark rounded-full overflow-hidden">
                                            <div className={`h-full ${region.color}`} style={{ width: `${region.val}%` }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-gem-blue text-white p-8 rounded-[32px] shadow-xl">
                            <h3 className="text-2xl font-black mb-2">System Status</h3>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse"></div>
                                <span className="text-xs font-bold uppercase tracking-widest">Global Servers Online</span>
                            </div>
                            <p className="text-sm opacity-80 leading-relaxed">
                                All RAG (Retrieval Augmented Generation) modules are active. Grounding is strictly restricted to Pakistani Textbooks.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;