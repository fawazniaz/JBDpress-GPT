
import React from 'react';

const AdminDashboard: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    return (
        <div className="flex flex-col h-screen p-8 bg-gem-onyx-light dark:bg-gem-onyx-dark overflow-y-auto">
            <div className="max-w-6xl mx-auto w-full">
                <div className="flex justify-between items-center mb-12">
                    <div>
                        <h1 className="text-4xl font-black mb-2">System Analytics</h1>
                        <p className="opacity-60">Regional usage data for JBDPRESS_GPT across Pakistan.</p>
                    </div>
                    <button onClick={onClose} className="px-6 py-3 bg-gem-mist-light dark:bg-gem-mist-dark rounded-full font-bold">Close Dashboard</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                    <div className="bg-white dark:bg-gem-slate-dark p-6 rounded-3xl shadow-lg border border-gem-mist-light dark:border-gem-mist-dark">
                        <p className="text-xs font-bold opacity-40 mb-2 uppercase">Total Active Students</p>
                        <p className="text-4xl font-black">12,482</p>
                        <p className="text-xs text-emerald-500 font-bold mt-2">+14% this month</p>
                    </div>
                    <div className="bg-white dark:bg-gem-slate-dark p-6 rounded-3xl shadow-lg border border-gem-mist-light dark:border-gem-mist-dark">
                        <p className="text-xs font-bold opacity-40 mb-2 uppercase">Avg. Session Time</p>
                        <p className="text-4xl font-black">42 min</p>
                        <p className="text-xs text-gem-blue font-bold mt-2">Peak: 8 PM - 11 PM</p>
                    </div>
                    <div className="bg-white dark:bg-gem-slate-dark p-6 rounded-3xl shadow-lg border border-gem-mist-light dark:border-gem-mist-dark">
                        <p className="text-xs font-bold opacity-40 mb-2 uppercase">Modules Active</p>
                        <p className="text-4xl font-black">86</p>
                        <p className="text-xs opacity-40 font-bold mt-2">102.4 GB Data</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-white dark:bg-gem-slate-dark p-8 rounded-3xl border border-gem-mist-light dark:border-gem-mist-dark">
                        <h3 className="font-bold mb-6">Regional Distribution (Pakistan)</h3>
                        <div className="space-y-4">
                            {[
                                { name: 'Punjab', val: 55, color: 'bg-gem-blue' },
                                { name: 'Sindh', val: 25, color: 'bg-gem-teal' },
                                { name: 'KPK', val: 12, color: 'bg-amber-500' },
                                { name: 'Balochistan', val: 5, color: 'bg-rose-500' },
                                { name: 'Others', val: 3, color: 'bg-gem-mist-dark' },
                            ].map(region => (
                                <div key={region.name}>
                                    <div className="flex justify-between text-xs font-bold mb-1">
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

                    <div className="bg-white dark:bg-gem-slate-dark p-8 rounded-3xl border border-gem-mist-light dark:border-gem-mist-dark">
                        <h3 className="font-bold mb-6">Usage Timeline</h3>
                        <div className="flex items-end justify-between h-40 space-x-2">
                            {[20, 35, 25, 60, 45, 80, 70, 90, 65, 50, 40, 30].map((v, i) => (
                                <div key={i} className="w-full bg-gem-blue/20 rounded-t-lg relative group">
                                    <div className="absolute bottom-0 left-0 right-0 bg-gem-blue rounded-t-lg transition-all" style={{ height: `${v}%` }}></div>
                                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-black text-white text-[8px] p-1 rounded">Day {i+1}</div>
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-between mt-4 text-[10px] font-bold opacity-40">
                            <span>Morning</span>
                            <span>Afternoon</span>
                            <span>Evening</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
