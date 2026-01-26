
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
    const [cloudFiles, setCloudFiles] = useState<CloudFile[]>([]);

    const loadingRef = useRef(false);

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.documentElement.classList.add('dark');
            setIsDarkMode(true);
        }
        if (process.env.API_KEY && process.env.API_KEY !== '') {
            setIsApiKeySelected(true);
        }
        const savedUser = localStorage.getItem('jbd_user');
        if (savedUser) {
            try {
                setUser(JSON.parse(savedUser));
                setStatus(AppStatus.Welcome);
            } catch (e) { setStatus(AppStatus.Login); }
        } else {
            setTimeout(() => setStatus(AppStatus.Login), 1000);
        }
    }, []);

    const fetchLibrary = useCallback(async (force: boolean = false) => {
        if (loadingRef.current && !force) return;
        loadingRef.current = true;
        setIsLibraryLoading(true);
        try {
            const [modules, rawFiles] = await Promise.all([
                geminiService.listAllModules(),
                geminiService.listAllCloudFiles()
            ]);
            setGlobalTextbooks(modules);
            setCloudFiles(rawFiles);
        } catch (err: any) {
            console.error("Library Sync Failure:", err);
        } finally {
            setIsLibraryLoading(false);
            loadingRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (status === AppStatus.Welcome && isApiKeySelected) fetchLibrary();
    }, [status, isApiKeySelected, fetchLibrary]);

    const toggleDarkMode = () => {
        setIsDarkMode(prev => {
            const newVal = !prev;
            newVal ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', newVal ? 'dark' : 'light');
            return newVal;
        });
    };

    const handleError = (err: any, customTitle?: string) => {
        console.error("Application Error:", err);
        let errMsg = err.message || "An unexpected error occurred.";
        if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("429")) {
            customTitle = "Storage Limit Reached";
            errMsg = "Your 1GB cloud quota is full. Use 'Purge All Cloud Data' in Admin Dashboard to reset.";
        }
        setError(customTitle || "Operation Blocked");
        setTechnicalDetails(errMsg);
        setStatus(AppStatus.Error);
    };

    const handleUploadTextbooks = async () => {
        if (!isApiKeySelected || files.length === 0) return;
        setStatus(AppStatus.Uploading);
        try {
            const moduleLabel = prompt("Module Name:") || "New Course";
            setUploadProgress({ current: 0, total: files.length, message: "Requesting Cloud Storage..." });
            const ragStoreName = await geminiService.createRagStore(moduleLabel);
            for (let i = 0; i < files.length; i++) {
                setUploadProgress({ current: i + 1, total: files.length, message: `Uploading ${files[i].name}...` });
                await geminiService.uploadToRagStore(ragStoreName, files[i]);
            }
            setFiles([]);
            await fetchLibrary(true);
            setStatus(AppStatus.Welcome);
        } catch (err: any) { handleError(err, "Upload Failed"); }
        finally { setUploadProgress(null); }
    };

    const handleDeleteModule = async (storeName: string) => {
        setIsLibraryLoading(true);
        try {
            await geminiService.deleteRagStore(storeName);
            await fetchLibrary(true);
        } catch (err: any) { handleError(err, "Delete Failed"); }
        finally { setIsLibraryLoading(false); }
    };

    const handleDeleteRawFile = async (fileName: string) => {
        setIsLibraryLoading(true);
        try {
            await geminiService.deleteRawFile(fileName);
            await fetchLibrary(true);
        } catch (err: any) { handleError(err, "File Delete Failed"); }
        finally { setIsLibraryLoading(false); }
    };

    const handlePurgeAll = async () => {
        if (!confirm("CRITICAL: This will delete ALL cloud data (stores and files). Continue?")) return;
        setIsLibraryLoading(true);
        try {
            for (const store of globalTextbooks) await geminiService.deleteRagStore(store.storeName);
            for (const file of cloudFiles) await geminiService.deleteRawFile(file.name);
            await fetchLibrary(true);
            alert("Storage Purged Successfully.");
        } catch (err: any) { handleError(err, "Purge Failed"); }
        finally { setIsLibraryLoading(false); }
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
                    apiKeyError={apiKeyError}
                    files={files}
                    setFiles={setFiles}
                    isApiKeySelected={isApiKeySelected}
                    onSelectKey={async () => { if (window.aistudio?.openSelectKey) { await window.aistudio.openSelectKey(); setIsApiKeySelected(true); } }}
                    toggleDarkMode={toggleDarkMode}
                    isDarkMode={isDarkMode}
                    onLogout={() => { localStorage.removeItem('jbd_user'); setUser(null); setStatus(AppStatus.Login); }}
                />;
            case AppStatus.AdminDashboard:
                return <AdminDashboard 
                    textbooks={globalTextbooks} 
                    cloudFiles={cloudFiles}
                    onDeleteModule={handleDeleteModule} 
                    onDeleteRawFile={handleDeleteRawFile}
                    onPurgeAll={handlePurgeAll}
                    onClose={() => setStatus(AppStatus.Welcome)} 
                    onDeepSync={() => fetchLibrary(true)}
                    isSyncing={isLibraryLoading}
                />;
            case AppStatus.Uploading: return <ProgressBar progress={uploadProgress?.current || 0} total={uploadProgress?.total || 1} message={uploadProgress?.message || "Uploading..."} />;
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
                        } catch (e: any) { handleError(e, "Query Failed"); }
                        finally { setIsQueryLoading(false); }
                    }}
                    addChatMessage={(role, text) => setChatHistory(prev => [...prev, { role, parts: [{ text }] }])}
                    onBack={() => setStatus(AppStatus.Welcome)}
                    exampleQuestions={exampleQuestions}
                />;
            case AppStatus.Error:
                return (
                    <div className="flex flex-col h-screen items-center justify-center p-8 bg-gem-onyx-light dark:bg-gem-onyx-dark">
                        <div className="text-7xl mb-6">⚠️</div>
                        <h1 className="text-3xl font-black mb-4 text-red-500">{error}</h1>
                        <div className="max-w-xl p-8 bg-white dark:bg-gem-slate-dark rounded-[30px] shadow-2xl border border-gem-mist-light dark:border-gem-mist-dark text-center">
                            <p className="text-sm opacity-70 mb-8 leading-relaxed whitespace-pre-wrap">{technicalDetails}</p>
                            <div className="flex gap-4 justify-center">
                                <button onClick={() => setStatus(AppStatus.AdminDashboard)} className="bg-gem-teal text-white px-8 py-4 rounded-2xl font-black">Admin Dashboard</button>
                                <button onClick={() => setStatus(AppStatus.Welcome)} className="bg-gem-mist-light dark:bg-gem-mist-dark px-8 py-4 rounded-2xl font-black">Back</button>
                            </div>
                        </div>
                    </div>
                );
            default: return null;
        }
    }

    return <main className="h-screen overflow-hidden bg-gem-onyx-light dark:bg-gem-onyx-dark">{renderContent()}</main>;
};

export default App;
