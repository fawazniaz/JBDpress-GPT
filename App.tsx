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

        // Check if API key is injected via build process (standard for Vercel/GitHub deployments)
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
        
        // Guidance for deployment issues
        if (errMsg.includes("MISSING_KEY_ERROR") || errMsg.includes("INVALID_KEY") || errMsg.includes("400")) {
            setTechnicalDetails(errMsg);
        } else if (errMsg.includes("Requested entity was not found") || errMsg.includes("404")) {
            setIsApiKeySelected(false);
            setTechnicalDetails("Project Conflict: The API key belongs to a project that was not found. Please ensure your project is active and 'Generative Language API' is enabled.");
        } else {
            setTechnicalDetails(errMsg);
        }

        setError(customTitle || "System Process Failed");
        setStatus(AppStatus.Error);
    };

    const handleUploadTextbooks = async () => {
        if (!isApiKeySelected) {
            setApiKeyError("No API Access: Please authorize via AI Studio or set the API_KEY environment variable and REDEPLOY.");
            return;
        }
        if (files.length === 0) return;
        
        setStatus(AppStatus.Uploading);
        
        try {
            const moduleLabel = prompt("Module Display Name (e.g. Biology Unit 1):") || `Repository ${globalTextbooks.length + 1}`;
            setUploadProgress({ current: 0, total: files.length, message: "Initializing AI Library...", fileName: "Connecting to Cloud..." });
            
            const ragStoreName = await geminiService.createRagStore(moduleLabel);
            const bookNames = files.map(f => f.name);
            
            for (let i = 0; i < files.length; i++) {
                setUploadProgress({ current: i + 1, total: files.length, message: "AI Scanning & Indexing Content...", fileName: files[i].name });
                await geminiService.uploadToRagStore(ragStoreName, files[i]);
            }
            
            const newLib: TextbookModule = { 
                name: moduleLabel, 
                storeName: ragStoreName,
                books: bookNames
            };
            setGlobalTextbooks(prev => [...prev, newLib]);
            setFiles([]);
            setStatus(AppStatus.Welcome);
        } catch (err: any) {
            handleError(err, "Library Indexing Failed");
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
                        onEnterChat={(store) => {
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
                        apiKeyError={apiKeyError}
                        files={files}
                        setFiles={setFiles}
                        isApiKeySelected={isApiKeySelected}
                        onSelectKey={async () => { 
                            if (window.aistudio?.openSelectKey) {
                                await window.aistudio.openSelectKey(); 
                                setIsApiKeySelected(true); 
                            } else {
                                alert("Manual Setup: On Vercel, set 'API_KEY' in Environment Variables and then trigger a Redeploy.");
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
                    documentName={activeModule?.name || 'Textbook Tutor'}
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
                            handleError(e, "AI Search Interrupted");
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
                        <div className="text-7xl mb-6 grayscale drop-shadow-lg">⚠️</div>
                        <h1 className="text-3xl font-black text-red-500 mb-4">{error}</h1>
                        <div className="max-w-xl w-full p-10 bg-white dark:bg-gem-slate-dark rounded-[40px] border border-red-100 dark:border-red-900/20 shadow-2xl mb-8 overflow-hidden">
                            <div className="space-y-4 text-left">
                                <p className="text-sm font-bold text-red-600 dark:text-red-400">
                                    {technicalDetails || "Please check your network connection or API quota."}
                                </p>
                                
                                <div className="p-5 bg-gem-onyx-light dark:bg-gem-onyx-dark rounded-3xl border border-gem-mist-light dark:border-gem-mist-dark text-xs space-y-2 opacity-80">
                                    <p className="font-black text-gem-blue uppercase tracking-widest text-[10px]">Troubleshooting Guide:</p>
                                    <ul className="list-disc pl-5 space-y-1">
                                        <li>Verify <strong>API_KEY</strong> in Vercel Environment Variables.</li>
                                        <li>Ensure <strong>Generative Language API</strong> is enabled in Google Cloud.</li>
                                        <li><strong>CRITICAL:</strong> If you just added the key, go to the Vercel dashboard and click <strong>"Redeploy"</strong>. Changes to env vars are not applied until the app is rebuilt.</li>
                                    </ul>
                                </div>
                            </div>
                            <div className="mt-8 pt-6 border-t border-gem-mist-light dark:border-gem-mist-dark text-[11px] opacity-60 font-black uppercase tracking-widest flex justify-between items-center">
                                <span>Deployment Diagnostic</span>
                                <span className="text-gem-blue">{new Date().toLocaleTimeString()}</span>
                            </div>
                        </div>
                        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
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