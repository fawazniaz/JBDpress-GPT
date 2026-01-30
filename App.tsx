
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppStatus, ChatMessage, User, TextbookModule, CloudFile } from './types';
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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const App: React.FC = () => {
    const [status, setStatus] = useState<AppStatus>(AppStatus.Initializing);
    const [user, setUser] = useState<User | null>(null);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [isApiKeySelected, setIsApiKeySelected] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
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
    const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([]);

    const loadingRef = useRef(false);

    const checkApiKey = useCallback(async () => {
        if (window.aistudio?.hasSelectedApiKey) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            const exists = hasKey || (!!process.env.API_KEY && process.env.API_KEY !== '');
            setIsApiKeySelected(exists);
            return exists;
        } else if (process.env.API_KEY && process.env.API_KEY !== '') {
            setIsApiKeySelected(true);
            return true;
        }
        return false;
    }, []);

    const fetchLibrary = useCallback(async (force: boolean = false) => {
        if (loadingRef.current && !force) return;
        loadingRef.current = true;
        setIsLibraryLoading(true);
        setSyncError(null);
        
        try {
            const hasKey = await checkApiKey();
            if (!hasKey) {
                setSyncError("Access Key Required. Please authorize Gemini to continue.");
                return;
            }

            const modules = await geminiService.listAllModules();
            setGlobalTextbooks(modules);
            
            try {
                const cloud = await geminiService.listAllCloudFiles();
                setCloudFiles(cloud);
            } catch (e) {}
        } catch (err: any) {
            console.error("Library sync failed:", err);
            setSyncError(err.message || "Failed to sync course library.");
        } finally {
            setIsLibraryLoading(false);
            loadingRef.current = false;
        }
    }, [checkApiKey]);

    useEffect(() => {
        const init = async () => {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'dark') {
                document.documentElement.classList.add('dark');
                setIsDarkMode(true);
            }
            
            await checkApiKey();

            const savedUser = localStorage.getItem('jbd_user');
            if (savedUser) {
                try {
                    setUser(JSON.parse(savedUser));
                    setStatus(AppStatus.Welcome);
                } catch (e) { setStatus(AppStatus.Login); }
            } else {
                setStatus(AppStatus.Login);
            }
        };
        init();
    }, [checkApiKey]);

    useEffect(() => {
        if (status === AppStatus.Welcome && isApiKeySelected) {
            fetchLibrary();
        }
    }, [status, isApiKeySelected, fetchLibrary]);

    const handleUploadTextbooks = async () => {
        if (!isApiKeySelected && !process.env.API_KEY) {
            alert("Please authorize Gemini access first.");
            return;
        }
        if (files.length === 0) return;
        
        const moduleLabel = prompt("Enter Module Name (e.g., Biology Unit 1):");
        if (!moduleLabel) return;

        setStatus(AppStatus.Uploading);
        try {
            setUploadProgress({ current: 0, total: files.length, message: "Contacting cloud..." });
            
            const ragStoreName = await geminiService.createRagStore(moduleLabel);
            
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setUploadProgress({ 
                    current: i, 
                    total: files.length, 
                    message: `Preparing ${file.name}...`, 
                    fileName: file.name 
                });
                
                await geminiService.uploadToRagStore(ragStoreName, file, (msg) => {
                    setUploadProgress(prev => prev ? { ...prev, message: msg } : null);
                });
            }
            
            setFiles([]);
            setUploadProgress({ current: files.length, total: files.length, message: "Refreshing Index...", fileName: "Complete" });
            await delay(2000); 
            await fetchLibrary(true);
            setStatus(AppStatus.Welcome);
        } catch (err: any) { 
            console.error("Upload failed:", err);
            setError("Upload Failed");
            setTechnicalDetails(err.message || "An error occurred during the cloud handshake.");
            setStatus(AppStatus.Error);
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
            alert(`Delete failed: ${err.message}`);
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

    const renderContent = () => {
        switch(status) {
            case AppStatus.Initializing: return <div className="flex h-screen items-center justify-center"><Spinner /></div>;
            case AppStatus.Login: return <Login onLogin={(u) => { setUser(u); localStorage.setItem('jbd_user', JSON.stringify(u)); setStatus(AppStatus.Welcome); }} />;
            case AppStatus.Welcome:
                return <WelcomeScreen 
                    user={user!}
                    onUpload={handleUploadTextbooks}
                    onDeleteModule={handleDeleteModule}
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
                    isLibraryLoading={isLibraryLoading}
                    onRefreshLibrary={() => fetchLibrary(true)}
                    apiKeyError={syncError}
                    files={files}
                    setFiles={setFiles}
                    isApiKeySelected={isApiKeySelected}
                    onSelectKey={async () => { 
                        if (window.aistudio?.openSelectKey) { 
                            await window.aistudio.openSelectKey(); 
                            setIsApiKeySelected(true);
                            fetchLibrary(true);
                        } 
                    }}
                    toggleDarkMode={toggleDarkMode}
                    isDarkMode={isDarkMode}
                    onLogout={() => { localStorage.removeItem('jbd_user'); setUser(null); setStatus(AppStatus.Login); }}
                />;
            case AppStatus.AdminDashboard:
                return <AdminDashboard 
                    textbooks={globalTextbooks} 
                    cloudFiles={cloudFiles}
                    onDeleteModule={handleDeleteModule} 
                    onDeleteRawFile={async (f) => { 
                        await geminiService.deleteRawFile(f); 
                        fetchLibrary(true); 
                    }}
                    onPurgeAll={() => {}} 
                    onClose={() => setStatus(AppStatus.Welcome)} 
                    onDeepSync={() => fetchLibrary(true)}
                    isSyncing={isLibraryLoading}
                />;
            case AppStatus.Uploading: return <ProgressBar progress={uploadProgress?.current || 0} total={uploadProgress?.total || 1} message={uploadProgress?.message || "Starting..."} fileName={uploadProgress?.fileName} />;
            case AppStatus.Chatting:
                return <ChatInterface 
                    user={user!}
                    documentName={activeModule?.name || 'Tutor'}
                    booksInStore={activeModule?.books || []}
                    history={chatHistory}
                    isQueryLoading={isQueryLoading}
                    onSendMessage={async (msg, m, f, b) => {
                        setChatHistory(prev => [...prev, { role: 'user', parts: [{ text: msg }] }]);
                        setIsQueryLoading(true);
                        try {
                            const res = await geminiService.fileSearch(activeRagStoreName!, msg, m, f, b);
                            setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: res.text }] }]);
                        } catch (e: any) { 
                            setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: `Error: ${e.message || "Failed to query the cloud."}` }] }]);
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
                    <div className="flex flex-col h-screen items-center justify-center p-8 bg-gem-onyx-light dark:bg-gem-onyx-dark text-center">
                        <div className="text-7xl mb-6">⚠️</div>
                        <h1 className="text-3xl font-black mb-4 text-red-500 uppercase tracking-tighter">{error || "Connection Error"}</h1>
                        <div className="max-w-xl p-8 bg-white dark:bg-gem-slate-dark rounded-[30px] shadow-2xl border border-gem-mist-light dark:border-gem-mist-dark">
                            <p className="text-sm opacity-70 mb-8 leading-relaxed font-bold">{technicalDetails}</p>
                            <button onClick={() => { setStatus(AppStatus.Welcome); setError(null); fetchLibrary(true); }} className="bg-gem-blue text-white px-8 py-4 rounded-2xl font-black">Retry Connection</button>
                        </div>
                    </div>
                );
            default: return null;
        }
    }

    return <main className="h-screen overflow-hidden bg-gem-onyx-light dark:bg-gem-onyx-dark">{renderContent()}</main>;
};

export default App;
