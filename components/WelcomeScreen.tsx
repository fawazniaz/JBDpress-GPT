import React from 'react';
import { User, TextbookModule } from '../types';
import { UploadCloudIcon, TrashIcon, RefreshIcon } from './Icons';
import Spinner from './Spinner';

interface WelcomeScreenProps {
    user: User;
    onUpload: () => Promise<void>;
    onEnterChat: (storeName: string, name: string) => void;
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
    user, onUpload, onEnterChat, onOpenDashboard, textbooks, isLibraryLoading, onRefreshLibrary, apiKeyError, files, setFiles, isApiKeySelected, onSelectKey, toggleDarkMode, isDarkMode, onLogout 
}) => {
    return (
        <div className="flex flex-col h-screen">
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
                        <p className="text-[10px] opacity-50">{user.role.toUpperCase()} • {user.schoolName}</p>
                    </div>
                    <button onClick={onLogout} className="text-xs font-bold text-red-500 hover:underline">Log Out</button>
                </div>
            </header>

            <div className="flex-grow overflow-y-auto p-6 lg:p-12">
                <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12">
                    <div className="space-y-8">
                        <div className="flex justify-between items-end">
                            <div>
                                <h2 className="text-3xl font-black mb-2 flex items-center gap-3">
                                    Course Library
                                    <button onClick={onRefreshLibrary} disabled={isLibraryLoading} className={`p-2 rounded-full hover:bg-gem-blue/5 transition-all ${isLibraryLoading ? 'animate-spin' : ''}`}>
                                        <RefreshIcon />
                                    </button>
                                </h2>
                                <p className="opacity-60">Access your digital textbooks and study materials.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            {textbooks.length === 0 && !isLibraryLoading ? (
                                <div className="p-12 border-2 border-dashed border-gem-mist-light dark:border-gem-mist-dark rounded-3xl text-center opacity-40">
                                    <p>No textbooks found.</p>
                                </div>
                            ) : (
                                textbooks.map((lib, idx) => (
                                    <button 
                                        key={idx}
                                        onClick={() => onEnterChat(lib.storeName, lib.name)}
                                        className="group p-6 bg-white dark:bg-gem-slate-dark border border-gem-mist-light dark:border-gem-mist-dark rounded-3xl text-left hover:border-gem-blue transition-all hover:shadow-xl"
                                    >
                                        <div className="flex justify-between items-start">
                                            <div className="w-12 h-12 bg-gem-blue/5 rounded-xl flex items-center justify-center text-2xl mb-4">📖</div>
                                            <span className="text-[10px] font-black bg-gem-blue/10 text-gem-blue px-2 py-1 rounded">ACTIVE</span>
                                        </div>
                                        <h3 className="font-bold text-lg leading-tight mb-2 truncate">{lib.name}</h3>
                                        <div className="text-xs font-bold text-gem-blue">Start Session →</div>
                                    </button>
                                ))
                            )}
                        </div>

                        {user.role === 'admin' && (
                            <button onClick={onOpenDashboard} className="w-full p-4 bg-gem-teal text-white font-bold rounded-2xl flex items-center justify-center space-x-2">
                                📊 <span>Admin Settings & Health Check</span>
                            </button>
                        )}
                    </div>

                    <div className="bg-gem-mist-light/20 dark:bg-gem-mist-dark/20 p-8 rounded-3xl border border-gem-mist-light dark:border-gem-mist-dark">
                        {user.role === 'admin' ? (
                            <div className="space-y-6">
                                <h3 className="text-xl font-black">Admin: Upload Module</h3>
                                {!isApiKeySelected ? (
                                    <button onClick={onSelectKey} className="w-full p-4 bg-gem-blue text-white font-bold rounded-xl shadow-md">Authorize API Access</button>
                                ) : (
                                    <div className="p-3 bg-emerald-500/10 text-emerald-500 text-xs font-black text-center rounded-xl border border-emerald-500/30">SYSTEM READY</div>
                                )}
                                
                                <div className="border-2 border-dashed border-gem-mist-light dark:border-gem-mist-dark rounded-2xl p-8 text-center bg-white/50 dark:bg-black/20">
                                    <input type="file" multiple id="file-up" className="hidden" onChange={e => setFiles(prev => [...prev, ...Array.from(e.target.files!)])}/>
                                    <label htmlFor="file-up" className="cursor-pointer flex flex-col items-center">
                                        <UploadCloudIcon />
                                        <span className="mt-4 font-bold">Upload Course PDFs</span>
                                    </label>
                                </div>

                                {files.length > 0 && (
                                    <div className="space-y-3">
                                        {files.map((f, i) => (
                                            <div key={i} className="flex justify-between items-center p-3 bg-white dark:bg-gem-slate-dark rounded-xl text-sm">
                                                <span className="truncate">{f.name}</span>
                                                <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500"><TrashIcon /></button>
                                            </div>
                                        ))}
                                        <button onClick={onUpload} className="w-full py-4 bg-gem-blue text-white font-black rounded-xl shadow-xl">Publish to Students</button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 p-8">
                                <div className="text-6xl">✨</div>
                                <h3 className="text-xl font-bold">Learning Hub</h3>
                                <p className="text-sm opacity-60">Use the library on the left to start a focused study session with your textbooks.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WelcomeScreen;