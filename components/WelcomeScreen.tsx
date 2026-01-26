
import React from 'react';
import { User, TextbookModule } from '../types';
import { UploadCloudIcon, TrashIcon, RefreshIcon } from './Icons';
import Spinner from './Spinner';

interface WelcomeScreenProps {
    user: User;
    onUpload: () => Promise<void>;
    onDeleteModule: (storeName: string) => void;
    onEnterChat: (storeName: string) => void;
    onOpenDashboard: () => void;
    textbooks: TextbookModule[];
    isLibraryLoading: boolean;
    onRefreshLibrary: () => void;
    apiKeyError: string | null;
    files: File[];
    setFiles: React.Dispatch<React.SetStateAction<File[]>>;
    isApiKeySelected: boolean;
    onSelectKey: () => Promise<void>;
    toggleDarkMode: () => void;
    isDarkMode: boolean;
    onLogout: () => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ 
    user, onUpload, onDeleteModule, onEnterChat, onOpenDashboard, textbooks, isLibraryLoading, onRefreshLibrary, apiKeyError, files, setFiles, isApiKeySelected, onSelectKey, toggleDarkMode, isDarkMode, onLogout 
}) => {
    return (
        <div className="flex flex-col h-screen overflow-hidden">
            {isLibraryLoading && (
                <div className="bg-gem-blue text-white text-[10px] font-black py-1 px-4 text-center animate-pulse flex items-center justify-center gap-2">
                    <Spinner /> <span>SYNCHRONIZING WITH CLOUD...</span>
                </div>
            )}
            {apiKeyError && !isLibraryLoading && (
                <div className="bg-amber-500 text-white text-[11px] font-black py-2 px-6 text-center shadow-lg animate-bounce flex items-center justify-center gap-3">
                    <span className="text-lg">⚠️</span> 
                    <span>CLOUD QUOTA ALERT: {apiKeyError}</span>
                    <button onClick={onOpenDashboard} className="underline hover:no-underline">OPEN ADMIN DASHBOARD</button>
                </div>
            )}
            
            <header className="flex justify-between items-center p-6 border-b border-gem-mist-light dark:border-gem-mist-dark bg-white/80 dark:bg-gem-slate-dark/80 backdrop-blur-md">
                <div className="flex items-center space-x-3">
                    <span className="text-2xl font-black text-gem-blue">JBD</span>
                    <span className="text-sm bg-gem-blue/10 text-gem-blue px-2 py-1 rounded font-bold uppercase tracking-tighter">GPT</span>
                </div>
                <div className="flex items-center space-x-4">
                    <button onClick={toggleDarkMode} className="p-2 rounded-full hover:bg-gem-mist-light dark:hover:bg-gem-mist-dark transition-colors">
                        {isDarkMode ? '☀️' : '🌙'}
                    </button>
                    <div className="text-right hidden sm:block">
                        <p className="text-xs font-bold">{user.email}</p>
                        <p className="text-[10px] opacity-50 uppercase tracking-tighter">{user.role} • {user.schoolName}</p>
                    </div>
                    <button onClick={onLogout} className="text-xs font-bold text-red-500 hover:underline">Log Out</button>
                </div>
            </header>

            <div className="flex-grow overflow-y-auto p-6 lg:p-12">
                <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12">
                    <div className="space-y-8">
                        <div>
                            <h2 className="text-4xl font-black mb-4 flex items-center gap-3">
                                Course Library
                                <button onClick={onRefreshLibrary} className="p-2 hover:bg-gem-blue/5 rounded-full"><RefreshIcon /></button>
                            </h2>
                            <p className="opacity-60 text-sm">Access your digital textbooks. Cloud storage is shared across all modules.</p>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            {textbooks.length === 0 && !isLibraryLoading ? (
                                <div className="p-16 border-2 border-dashed border-gem-mist-light dark:border-gem-mist-dark rounded-[32px] text-center opacity-30">
                                    <div className="text-4xl mb-4">📂</div>
                                    <p className="font-bold">Repository Empty</p>
                                </div>
                            ) : (
                                textbooks.map((lib, idx) => (
                                    <div 
                                        key={idx}
                                        className="group p-6 bg-white dark:bg-gem-slate-dark border border-gem-mist-light dark:border-gem-mist-dark rounded-[32px] hover:border-gem-blue transition-all hover:shadow-2xl cursor-pointer"
                                        onClick={() => onEnterChat(lib.storeName)}
                                    >
                                        <div className="flex justify-between items-start mb-6">
                                            <div className="w-14 h-14 bg-gem-blue/5 rounded-2xl flex items-center justify-center text-3xl">📘</div>
                                            {user.role === 'admin' && (
                                                <button onClick={(e) => { e.stopPropagation(); if(confirm("Delete this module?")) onDeleteModule(lib.storeName); }} className="p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all">
                                                    <TrashIcon />
                                                </button>
                                            )}
                                        </div>
                                        <h3 className="font-black text-xl mb-1 truncate">{lib.name}</h3>
                                        <p className="text-[10px] font-bold opacity-40 uppercase mb-4">{lib.books.length} Textbooks attached</p>
                                        <div className="text-xs font-black text-gem-blue group-hover:translate-x-2 transition-transform">STUDY NOW →</div>
                                    </div>
                                ))
                            )}
                        </div>

                        {user.role === 'admin' && (
                            <button onClick={onOpenDashboard} className="w-full p-6 bg-gem-teal text-white font-black rounded-3xl flex items-center justify-center gap-3 shadow-xl hover:brightness-110 active:scale-95 transition-all">
                                📊 Admin Settings & Quota Manager
                            </button>
                        )}
                    </div>

                    <div className="bg-white dark:bg-gem-slate-dark p-10 rounded-[40px] border border-gem-mist-light dark:border-gem-mist-dark shadow-2xl">
                        {user.role === 'admin' ? (
                            <div className="space-y-8">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-2xl font-black">Publish Module</h3>
                                    {apiKeyError && <span className="text-[10px] font-bold text-amber-500">QUOTA AT RISK</span>}
                                </div>
                                {!isApiKeySelected && <button onClick={onSelectKey} className="w-full p-4 bg-gem-blue text-white font-bold rounded-2xl">Authorize Gemini Access</button>}
                                
                                <div className="border-2 border-dashed border-gem-mist-light dark:border-gem-mist-dark rounded-3xl p-12 text-center hover:border-gem-blue transition-colors bg-gem-onyx-light dark:bg-black/10">
                                    <input type="file" multiple id="file-up" className="hidden" onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files!)])} disabled={!!apiKeyError}/>
                                    <label htmlFor="file-up" className={`flex flex-col items-center ${apiKeyError ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'}`}>
                                        <UploadCloudIcon />
                                        <span className="mt-4 font-black text-lg">Add Textbook Files</span>
                                        <p className="text-[10px] opacity-50 mt-2 uppercase font-black">1GB Quota • PDF/Docs only</p>
                                    </label>
                                </div>

                                {files.length > 0 && (
                                    <div className="space-y-4">
                                        {files.map((f, i) => (
                                            <div key={i} className="flex justify-between items-center p-4 bg-gem-onyx-light dark:bg-gem-mist-dark/30 rounded-2xl text-xs font-bold">
                                                <span className="truncate">{f.name}</span>
                                                <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500"><TrashIcon /></button>
                                            </div>
                                        ))}
                                        <button onClick={onUpload} className="w-full py-5 bg-gem-blue text-white font-black rounded-2xl shadow-2xl hover:scale-105 active:scale-95 transition-all">START UPLOAD</button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                                <div className="text-8xl mb-8">✨</div>
                                <h3 className="text-2xl font-black mb-4">Student Hub</h3>
                                <p className="opacity-60 text-sm leading-relaxed">Select a course from the library to start a focused, textbook-only AI study session.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WelcomeScreen;
