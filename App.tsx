
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

        // AUTO-DETECT API KEY: In a real deployment (Vercel/Cloud Run), 
        // if the API_KEY is set in environment variables, we are good to go!
        if (process.env.API_KEY && process.env.API_KEY !== '') {
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
        // Only check AIStudio helper if it exists (usually only in AI Studio preview)
        if (window.aistudio?.hasSelectedApiKey) {
            try {
                const hasKey = await window.aistudio.hasSelectedApiKey();
                if (hasKey) setIsApiKeySelected(true);
            } catch (e) {
                // If checking fails, don't override the env variable detection
            }
        }
    }, []);

    useEffect(() => {
        checkApiKey();
        window.addEventListener('focus', checkApiKey);
        return () => window.removeEventListener('focus', checkApiKey);
    }, [checkApiKey]);

    const handleUploadTextbooks = async () => {
        if (!isApiKeySelected && !process.env.API_KEY) {
            setApiKeyError("No API Key found. Please make sure the API_KEY environment variable is set in your deployment.");
            return;
        }
        if (files.length === 0) return;
        
        setStatus(AppStatus.Uploading);
        
        try {
            const moduleLabel = prompt("Enter a name for this textbook module (e.g. Science Grade 10):") || `Library Module ${globalTextbooks.length + 1}`;
            
            // Step 1: Create the "Drawer" (RAG Store)
            setUploadProgress({ current: 0, total: files.length, message: "Preparing Secure Library...", fileName: "Initializing..." });
            const ragStoreName = await geminiService.createRagStore(moduleLabel);
            const bookNames = files.map(f => f.name);
            
            // Step 2: Put the books in the drawer
            for (let i = 0; i < files.length; i++) {
                setUploadProgress({ current: i + 1, total: files.length, message: "AI is reading and memorizing...", fileName: files[i].name });
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
            console.error("Critical Indexing Error:", err);
            // ENHANCED ERROR: Help the user see the real issue
            const displayError = err.message || "Unknown error";
            setError(`Indexing failed: ${displayError}. This usually happens if the API key is missing or permissions are not set up on the server.`);
            setStatus(AppStatus.Error);
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
                                geminiService.generateExampleQuestions(mod.storeName).then(setExampleQuestions);
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
                                alert("This feature is only available in AI Studio preview. On a real website, the key is set automatically by the owner.");
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
                            setError(`Query failed: ${e.message}`); 
                            setStatus(AppStatus.Error); 
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
                    <div className="flex flex-col h-screen items-center justify-center p-8 text-center bg-white dark:bg-gem-onyx-dark transition-colors">
                        <div className="text-6xl mb-4">⚠️</div>
                        <h1 className="text-2xl font-black text-red-500 mb-4">A System Error Occurred</h1>
                        <div className="max-w-md p-6 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-900/20 mb-8">
                            <p className="text-sm font-medium opacity-80">{error}</p>
                        </div>
                        <button 
                            onClick={() => { setStatus(AppStatus.Welcome); setError(null); }} 
                            className="bg-gem-blue text-white px-8 py-3 rounded-full font-bold shadow-lg active:scale-95 transition-all"
                        >
                            Return to Library
                        </button>
                    </div>
                 );
            default: return null;
        }
    }

    return <main className="h-screen overflow-hidden bg-gem-onyx-light dark:bg-gem-onyx-dark">{renderContent()}</main>;
};

export default App;
