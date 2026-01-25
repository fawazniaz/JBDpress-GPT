/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppStatus, ChatMessage, User, TextbookModule } from './types';
import * as geminiService from './services/geminiService';
import Spinner from './components/Spinner';
import WelcomeScreen from './components/WelcomeScreen';
import ProgressBar from './components/ProgressBar';
import ChatInterface from './components/ChatInterface';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';

declare global {
    interface AIStudio {
        openSelectKey: () => Promise<void>;
        hasSelectedApiKey: () => Promise<boolean>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}

const App: React.FC = () => {
    const [status, setStatus] = useState<AppStatus>(AppStatus.Initializing);
    const [user, setUser] = useState<User | null>(null);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [isApiKeySelected, setIsApiKeySelected] = useState(false);
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [technicalDetails, setTechnicalDetails] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number, message?: string, fileName?: string } | null>(null);
    const [activeRagStoreName, setActiveRagStoreName] = useState<string | null>(null);
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [isQueryLoading, setIsQueryLoading] = useState(false);
    const [isLibraryLoading, setIsLibraryLoading] = useState(false);
    const [exampleQuestions, setExampleQuestions] = useState<string[]>([]);
    const [activeModule, setActiveModule] = useState<TextbookModule | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [globalTextbooks, setGlobalTextbooks] = useState<TextbookModule[]>([]);

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.documentElement.classList.add('dark');
            setIsDarkMode(true);
        }

        if (process.env.API_KEY && process.env.API_KEY !== '' && process.env.API_KEY !== 'undefined') {
            setIsApiKeySelected(true);
        }

        const savedUser = localStorage.getItem('jbd_user');
        if (savedUser) {
            try {
                setUser(JSON.parse(savedUser));
                setStatus(AppStatus.Welcome);
            } catch (e) {
                setStatus(AppStatus.Login);
            }
        } else {
            setTimeout(() => setStatus(AppStatus.Login), 1000);
        }
    }, []);

    useEffect(() => {
        if ((status === AppStatus.Welcome || status === AppStatus.Chatting) && isApiKeySelected && globalTextbooks.length === 0) {
            fetchLibrary();
        }
    }, [status, isApiKeySelected]);

    const fetchLibrary = async () => {
        if (isLibraryLoading) return;
        setIsLibraryLoading(true);
        try {
            const modules = await geminiService.listAllModules();
            setGlobalTextbooks(modules);
        } catch (err: any) {
            console.error("Cloud Sync Failed:", err);
            setApiKeyError(`Sync Failed: ${err.message || 'Connection error'}`);
        } finally {
            setIsLibraryLoading(false);
        }
    };

    const toggleDarkMode = () => {
        setIsDarkMode(prev => {
            const newVal = !prev;
            newVal ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', newVal ? 'dark' : 'light');
            return newVal;
        });
    };

    const checkApiKey = useCallback(async () => {
        if (window.aistudio?.hasSelectedApiKey) {
            try {
                const hasKey = await window.aistudio.hasSelectedApiKey();
                if (hasKey) setIsApiKeySelected(true);
            } catch (e) {}
        }
    }, []);

    useEffect(() => {
        checkApiKey();
        window.addEventListener('focus', checkApiKey);
        return () => window.removeEventListener('focus', checkApiKey);
    }, [checkApiKey]);

    const handleError = (err: any, customTitle?: string) => {
        console.error("Application Error:", err);
        const errMsg = err.message || "An unexpected error occurred.";
        
        if (errMsg.includes("NETWORK_CONNECTION_ERROR")) {
            setTechnicalDetails("Tip: 50MB files are very large for the browser. If this continues, split your PDF into 3 parts (approx 17MB each) and upload them one by one.");
        } else if (errMsg.includes("INDEXING_TIMEOUT")) {
            setTechnicalDetails("Indexing Delayed: The AI is still reading your heavy book in the background. Please refresh in 5 minutes.");
        } else {
            setTechnicalDetails(errMsg);
        }

        setError(customTitle || "System Error");
        setStatus(AppStatus.Error);
    };

    const handleUploadTextbooks = async () => {
        if (!isApiKeySelected) {
            setApiKeyError("API Access Required: Configure Key and Redeploy.");
            return;
        }
        if (files.length === 0) return;
        
        const largeFile = files.find(f => f.size > 25 * 1024 * 1024);
        if (largeFile) {
            if (!confirm(`Warning: ${largeFile.name} is over 25MB. Large files may time out during indexing. Proceed?`)) return;
        }

        setStatus(AppStatus.Uploading);
        
        try {
            const moduleLabel = prompt("Module Name (e.g. Grade 1 Computer):") || `Repo ${globalTextbooks.length + 1}`;
            setUploadProgress({ current: 0, total: files.length, message: "Opening Cloud Connection...", fileName: "Starting..." });
            
            const ragStoreName = await geminiService.createRagStore(moduleLabel);
            const bookNames = files.map(f => f.name);
            
            for (let i = 0; i < files.length; i++) {
                const sizeStr = (files[i].size / (1024 * 1024)).toFixed(1);
                setUploadProgress({ 
                    current: i + 1, 
                    total: files.length, 
                    message: `AI Indexing (${sizeStr} MB)...`, 
                    fileName: files[i].name 
                });
                await geminiService.uploadToRagStore(ragStoreName, files[i]);
            }
            
            await fetchLibrary();
            setFiles([]);
            setStatus(AppStatus.Welcome);
        } catch (err: any) {
            handleError(err, "Library Process Failed");
        } finally {
            setUploadProgress(null);
        }
    };

    const renderContent = () => {
        switch(status) {
            case AppStatus.Initializing:
                return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
            case AppStatus.Login:
                return <Login onLogin={(u) => { setUser(u); localStorage.setItem('jbd_user', JSON.stringify(u)); setStatus(AppStatus.Welcome); }} />;
            case AppStatus.Welcome:
                return (
                    <WelcomeScreen 
                        user={user!}
                        onUpload={handleUploadTextbooks}
                        onEnterChat={(store, name) => {
                            const mod = globalTextbooks.find(t => t.storeName === store);
                            if (mod) {
                                setActiveModule(mod);
                                setActiveRagStoreName(mod.storeName);
                                setChatHistory([]);
                                setStatus(AppStatus.Chatting);
                                geminiService.generateExampleQuestions(mod.storeName).then(setExampleQuestions).catch(() => {});
                            }
                        }}
                        onOpenDashboard={() => setStatus(AppStatus.AdminDashboard)}
                        textbooks={globalTextbooks}
                        isLibraryLoading={isLibraryLoading}
                        onRefreshLibrary={fetchLibrary}
                        apiKeyError={apiKeyError}
                        files={files}
                        setFiles={setFiles}
                        isApiKeySelected={isApiKeySelected}
                        onSelectKey={async () => { 
                            if (window.aistudio?.openSelectKey) {
                                await window.aistudio.openSelectKey(); 
                                setIsApiKeySelected(true); 
                            } else {
                                alert("Manual Key Setup: Configure 'API_KEY' on Vercel and Redeploy.");
                            }
                        }}
                        toggleDarkMode={toggleDarkMode}
                        isDarkMode={isDarkMode}
                        onLogout={() => { localStorage.removeItem('jbd_user'); setUser(null); setStatus(AppStatus.Login); }}
                    />
                );
            case AppStatus.AdminDashboard:
                return <AdminDashboard onClose={() => setStatus(AppStatus.Welcome)} />;
            case AppStatus.Uploading:
                return <ProgressBar progress={uploadProgress?.current || 0} total={uploadProgress?.total || 1} message={uploadProgress?.message || "Processing..."} fileName={uploadProgress?.fileName} />;
            case AppStatus.Chatting:
                return <ChatInterface 
                    user={user!}
                    documentName={activeModule?.name || 'Tutor'}
                    booksInStore={activeModule?.books || []}
                    history={chatHistory}
                    isQueryLoading={isQueryLoading}
                    onSendMessage={async (msg, m, f, b) => {
                        const userMsg: ChatMessage = { role: 'user', parts: [{ text: msg }] };
                        setChatHistory(prev => [...prev, userMsg]);
                        setIsQueryLoading(true);
                        try {
                            const res = await geminiService.fileSearch(activeRagStoreName!, msg, m, f, b);
                            setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: res.text }] }]);
                        } catch (e: any) { 
                            handleError(e, "AI Connection Failed");
                        } finally { 
                            setIsQueryLoading(false); 
                        }
                    }}
                    addChatMessage={(role, text) => setChatHistory(prev => [...prev, { role, parts: [{ text }] }])}
                    onBack={() => setStatus(AppStatus.Welcome)}
                    exampleQuestions={exampleQuestions}
                />;
            case AppStatus.Error:
                 return (
                    <div className="flex flex-col h-screen items-center justify-center p-8 text-center bg-gem-onyx-light dark:bg-gem-onyx-dark transition-colors">
                        <div className="text-7xl mb-6">⚠️</div>
                        <h1 className="text-3xl font-black text-red-500 mb-4">{error}</h1>
                        <div className="max-w-xl w-full p-10 bg-white dark:bg-gem-slate-dark rounded-[40px] border border-red-100 dark:border-red-900/20 shadow-2xl mb-8">
                            <div className="text-left space-y-4">
                                <p className="text-sm font-bold text-red-600 dark:text-red-400">
                                    {technicalDetails}
                                </p>
                                <div className="p-5 bg-gem-onyx-light dark:bg-gem-onyx-dark rounded-3xl border border-gem-mist-light dark:border-gem-mist-dark text-xs opacity-80">
                                    <p className="font-black uppercase tracking-widest text-gem-blue mb-2 text-[10px]">Large Book Guide:</p>
                                    <ul className="list-disc pl-5 space-y-1">
                                        <li>Books over 25MB can struggle on slow Wi-Fi.</li>
                                        <li><strong>Recommendation:</strong> Use a PDF splitter tool to break the 50MB book into two 25MB parts.</li>
                                        <li>AI indexing for a 50MB book can take up to 10 minutes.</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-4">
                            <button 
                                onClick={() => { setStatus(AppStatus.Welcome); setError(null); setTechnicalDetails(null); }} 
                                className="bg-gem-blue text-white px-10 py-4 rounded-2xl font-black shadow-xl hover:scale-105 active:scale-95 transition-all"
                            >
                                Back to Library
                            </button>
                            <button 
                                onClick={async () => { if(window.aistudio?.openSelectKey) await window.aistudio.openSelectKey(); setIsApiKeySelected(true); setStatus(AppStatus.Welcome); }} 
                                className="bg-gem-teal text-white px-10 py-4 rounded-2xl font-black shadow-xl hover:scale-105 active:scale-95 transition-all"
                            >
                                Select New Key
                            </button>
                        </div>
                    </div>
                 );
            default: return null;
        }
    }

    return <main className="h-screen overflow-hidden bg-gem-onyx-light dark:bg-gem-onyx-dark">{renderContent()}</main>;
};

export default App;