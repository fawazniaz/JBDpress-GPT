
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useCallback } from 'react';
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

    const fetchLibrary = useCallback(async (force: boolean = false) => {
        if (isLibraryLoading && !force) return;
        setIsLibraryLoading(true);
        setApiKeyError(null);
        
        try {
            const modules = await geminiService.listAllModules();
            const uniqueModulesMap = new Map();
            modules.forEach(m => {
                if (m.storeName && !uniqueModulesMap.has(m.storeName)) {
                    uniqueModulesMap.set(m.storeName, m);
                }
            });
            const uniqueList = Array.from(uniqueModulesMap.values());
            setGlobalTextbooks(uniqueList);
            if (uniqueList.length > 0) setIsLibraryLoading(false);
        } catch (err: any) {
            console.error("Library Sync Failure:", err);
            setApiKeyError(`Sync status: Local library active.`);
        } finally {
            setTimeout(() => setIsLibraryLoading(false), 1500);
        }
    }, [isLibraryLoading]);

    useEffect(() => {
        if (status === AppStatus.Welcome && isApiKeySelected) {
            fetchLibrary();
        }
    }, [status, isApiKeySelected, fetchLibrary]);

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
        let errMsg = err.message || "An unexpected error occurred.";
        
        if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("429") || errMsg.includes("storage limit")) {
            customTitle = "Storage Limit Reached";
            errMsg = "You have used your 1GB free storage limit for textbooks. \n\nTo upload new files, please go to 'Admin Dashboard' and delete some older course modules.";
        }

        setError(customTitle || "Operation Blocked");
        setTechnicalDetails(errMsg);
        setStatus(AppStatus.Error);
    };

    const handleUploadTextbooks = async () => {
        if (!isApiKeySelected) {
            setApiKeyError("API Key required.");
            return;
        }
        if (files.length === 0) return;
        setStatus(AppStatus.Uploading);
        try {
            const moduleLabel = prompt("Enter Name for this Course Folder:") || `Course ${globalTextbooks.length + 1}`;
            setUploadProgress({ current: 0, total: files.length, message: "Requesting Cloud Storage...", fileName: "Connecting..." });
            
            const ragStoreName = await geminiService.createRagStore(moduleLabel);
            
            for (let i = 0; i < files.length; i++) {
                setUploadProgress({ 
                    current: i + 1, 
                    total: files.length, 
                    message: `Uploading File ${i+1}/${files.length}...`, 
                    fileName: files[i].name 
                });
                await geminiService.uploadToRagStore(ragStoreName, files[i]);
            }
            
            setFiles([]);
            await fetchLibrary(true);
            setStatus(AppStatus.Welcome);
        } catch (err: any) {
            handleError(err, "Upload Failed");
        } finally {
            setUploadProgress(null);
        }
    };

    const handleDeleteModule = async (storeName: string) => {
        setIsLibraryLoading(true);
        try {
            await geminiService.deleteRagStore(storeName);
            await fetchLibrary(true);
        } catch (err: any) {
            handleError(err, "Delete Failed");
        } finally {
            setIsLibraryLoading(false);
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
                        onDeleteModule={handleDeleteModule}
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
                        onRefreshLibrary={() => fetchLibrary(true)}
                        apiKeyError={apiKeyError}
                        files={files}
                        setFiles={setFiles}
                        isApiKeySelected={isApiKeySelected}
                        onSelectKey={async () => { 
                            if (window.aistudio?.openSelectKey) {
                                await window.aistudio.openSelectKey(); 
                                setIsApiKeySelected(true); 
                            }
                        }}
                        toggleDarkMode={toggleDarkMode}
                        isDarkMode={isDarkMode}
                        onLogout={() => { localStorage.removeItem('jbd_user'); setUser(null); setStatus(AppStatus.Login); }}
                    />
                );
            case AppStatus.AdminDashboard:
                return <AdminDashboard 
                    textbooks={globalTextbooks} 
                    onDeleteModule={handleDeleteModule} 
                    onClose={() => setStatus(AppStatus.Welcome)} 
                />;
            case AppStatus.Uploading:
                return <ProgressBar progress={uploadProgress?.current || 0} total={uploadProgress?.total || 1} message={uploadProgress?.message || "Uploading..."} fileName={uploadProgress?.fileName} />;
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
                            handleError(e, "Query Interrupted");
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
                        <h1 className="text-3xl font-black mb-4 text-red-500">{error}</h1>
                        <div className="max-w-xl p-8 bg-white dark:bg-gem-slate-dark rounded-[30px] shadow-2xl mb-8">
                            <p className="font-bold text-gem-blue mb-4">Notification:</p>
                            <p className="text-sm opacity-70 mb-6 leading-relaxed whitespace-pre-wrap">{technicalDetails}</p>
                            <button 
                                onClick={() => { setStatus(AppStatus.Welcome); setError(null); }} 
                                className="bg-gem-blue text-white px-10 py-3 rounded-xl font-black shadow-lg hover:scale-105 active:scale-95 transition-all"
                            >
                                Back to Start
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
