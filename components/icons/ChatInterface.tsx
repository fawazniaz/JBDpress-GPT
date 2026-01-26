
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChatMessage, PedagogicalMethod, User } from '../types';
import Spinner from './Spinner';
import SendIcon from './icons/SendIcon';
import DownloadIcon from './icons/DownloadIcon';
import * as geminiService from '../services/geminiService';

interface ChatInterfaceProps {
    user: User;
    documentName: string;
    booksInStore: string[];
    history: ChatMessage[];
    isQueryLoading: boolean;
    onSendMessage: (message: string, method?: PedagogicalMethod, fastMode?: boolean, bookFocus?: string) => void;
    addChatMessage: (role: 'user' | 'model', text: string) => void;
    onBack: () => void;
    exampleQuestions: string[];
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ user, documentName, booksInStore, history, isQueryLoading, onSendMessage, addChatMessage, onBack, exampleQuestions }) => {
    const [query, setQuery] = useState('');
    const [method, setMethod] = useState<PedagogicalMethod>('standard');
    const [selectedBook, setSelectedBook] = useState<string>('All Books');
    const [fastMode, setFastMode] = useState(false);
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    
    const [userTranscript, setUserTranscript] = useState('');
    const [aiTranscript, setAiTranscript] = useState('');
    const [isAiThinking, setIsAiThinking] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);
    
    const audioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const sessionPromiseRef = useRef<any>(null);
    const isStoppingRef = useRef(false);

    const currentUserTranscriptRef = useRef('');
    const currentAiTranscriptRef = useRef('');

    const methods: { id: PedagogicalMethod, label: string, desc: string, icon: string }[] = [
        { id: 'standard', label: 'Standard', desc: 'Direct textbook answers', icon: '📖' },
        { id: 'blooms', label: "Bloom's", desc: "Cognitive analysis levels", icon: '🧠' },
        { id: 'montessori', label: 'Montessori', desc: 'Discovery-led learning', icon: '🌱' },
        { id: 'pomodoro', label: 'Pomodoro', desc: 'Focused study sprints', icon: '🍅' },
        { id: 'kindergarten', label: 'Early Years', desc: 'Simple analogies', icon: '🧸' },
        { id: 'lesson-plan', label: 'Lesson Plan', desc: 'Teacher resources', icon: '📋' },
    ];

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history, isQueryLoading, userTranscript, aiTranscript]);

    const stopVoice = useCallback(() => {
        if (isStoppingRef.current) return;
        isStoppingRef.current = true;

        commitVoiceHistory();

        setIsVoiceActive(false);
        setIsMuted(false);
        setIsAiThinking(false);

        sessionPromiseRef.current = null;

        sourcesRef.current.forEach(s => {
            try { s.stop(); } catch (e) {}
        });
        sourcesRef.current.clear();

        const closeContext = async (ctxRef: React.MutableRefObject<AudioContext | null>) => {
            const ctx = ctxRef.current;
            // CRITICAL FIX: Check ctx.state before attempting to close
            if (ctx && ctx.state !== 'closed') {
                try {
                    await ctx.close();
                    console.log("AudioContext closed successfully.");
                } catch (e) {
                    console.warn("AudioContext closure warning:", e);
                }
            }
            ctxRef.current = null;
        };

        Promise.all([
            closeContext(audioContextRef),
            closeContext(outputAudioContextRef)
        ]).finally(() => {
            isStoppingRef.current = false;
        });
    }, []);

    const commitVoiceHistory = () => {
        if (currentUserTranscriptRef.current.trim()) {
            addChatMessage('user', `(Voice): ${currentUserTranscriptRef.current.trim()}`);
            currentUserTranscriptRef.current = '';
        }
        if (currentAiTranscriptRef.current.trim()) {
            addChatMessage('model', currentAiTranscriptRef.current.trim());
            currentAiTranscriptRef.current = '';
        }
        setUserTranscript('');
        setAiTranscript('');
    };

    const startVoice = async () => {
        if (isVoiceActive || isStoppingRef.current) return;
        
        setIsVoiceActive(true);
        setIsMuted(false);
        setIsAiThinking(false);
        setUserTranscript('');
        setAiTranscript('');
        currentUserTranscriptRef.current = '';
        currentAiTranscriptRef.current = '';
        nextStartTimeRef.current = 0;
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            audioContextRef.current = inCtx;
            outputAudioContextRef.current = outCtx;

            const sessionPromise = geminiService.connectLive({
                onopen: () => {
                    const source = inCtx.createMediaStreamSource(stream);
                    const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
                    scriptProcessor.onaudioprocess = (e) => {
                        if (audioContextRef.current && !isMuted && sessionPromiseRef.current) {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) int16[i] = inputData[i] * 32768;
                            const base64 = geminiService.encodeBase64(new Uint8Array(int16.buffer));
                            
                            sessionPromiseRef.current?.then((session: any) => {
                                if (session && typeof session.sendRealtimeInput === 'function') {
                                    session.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
                                }
                            });
                        }
                    };
                    source.connect(scriptProcessor);
                    scriptProcessor.connect(inCtx.destination);
                },
                onmessage: async (message: any) => {
                    if (!outputAudioContextRef.current) return;
                    
                    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (audioData && outputAudioContextRef.current) {
                        setIsAiThinking(false);
                        const outCtx = outputAudioContextRef.current;
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
                        const buffer = await geminiService.decodeAudioData(geminiService.decodeBase64(audioData), outCtx, 24000, 1);
                        const source = outCtx.createBufferSource();
                        source.buffer = buffer;
                        source.connect(outCtx.destination);
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += buffer.duration;
                        sourcesRef.current.add(source);
                        source.onended = () => sourcesRef.current.delete(source);
                    }

                    if (message.serverContent?.inputTranscription) {
                        const txt = message.serverContent.inputTranscription.text;
                        setUserTranscript(prev => prev + txt);
                        currentUserTranscriptRef.current += txt;
                        setIsAiThinking(true);
                    }
                    if (message.serverContent?.outputTranscription) {
                        const txt = message.serverContent.outputTranscription.text;
                        setAiTranscript(prev => prev + txt);
                        currentAiTranscriptRef.current += txt;
                        setIsAiThinking(false);
                    }

                    if (message.serverContent?.turnComplete) {
                        commitVoiceHistory();
                        setIsAiThinking(false);
                    }

                    if (message.serverContent?.interrupted) {
                        sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
                        sourcesRef.current.clear();
                        nextStartTimeRef.current = 0;
                        setIsAiThinking(false);
                    }
                },
                onclose: () => stopVoice(),
                onerror: (e: any) => { console.error("Live API Error", e); stopVoice(); }
            }, method);

            sessionPromiseRef.current = sessionPromise;
        } catch (err) {
            console.error("Mic access denied or session failed", err);
            stopVoice();
        }
    };

    const handlePrint = (content: string) => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        
        const html = `
            <html>
                <head>
                    <title>Assessment Sheet - ${user.schoolName}</title>
                    <style>
                        body { font-family: sans-serif; padding: 40px; }
                        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
                        .school-name { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
                        .info { display: flex; justify-content: space-between; font-size: 14px; margin-top: 10px; }
                        .content { line-height: 1.6; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                        @media print { .no-print { display: none; } }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div class="school-name">${user.schoolName}</div>
                        <div>Digital Assessment & Learning System</div>
                        <div class="info">
                            <span>Subject: ____________________</span>
                            <span>Date: ${new Date().toLocaleDateString()}</span>
                            <span>Student Name: ____________________</span>
                        </div>
                    </div>
                    <div class="content">${content.replace(/\n/g, '<br/>')}</div>
                    <script>window.onload = () => { window.print(); }</script>
                </body>
            </html>
        `;
        printWindow.document.write(html);
        printWindow.document.close();
    };

    const handleDownload = (content: string) => {
        const element = document.createElement("a");
        const file = new Blob([content], {type: 'text/plain'});
        element.href = URL.createObjectURL(file);
        element.download = `JBDPRESS_Assessment_${Date.now()}.txt`;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) {
            onSendMessage(query, method, fastMode, selectedBook === 'All Books' ? undefined : selectedBook);
            setQuery('');
        }
    };

    const renderMarkdown = (text: string) => {
        return { __html: text.replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') };
    };

    return (
        <div className="flex flex-col h-full bg-gem-onyx-light dark:bg-gem-onyx-dark transition-colors duration-300">
            <header className="p-4 border-b border-gem-mist-light dark:border-gem-mist-dark bg-white/80 dark:bg-gem-slate-dark/80 backdrop-blur-md z-10 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center space-x-4 overflow-hidden w-full sm:w-auto">
                    <button onClick={onBack} className="p-2 hover:bg-gem-mist-light dark:hover:bg-gem-mist-dark rounded-full transition-colors">←</button>
                    <div className="truncate">
                        <h1 className="text-sm font-black truncate">{documentName}</h1>
                        <p className="text-[10px] opacity-40 uppercase tracking-tighter">{user.schoolName} • Precise Grounding</p>
                    </div>
                </div>

                <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
                    <div className="flex items-center space-x-2 mr-2">
                        <span className="text-[10px] font-bold opacity-40 uppercase whitespace-nowrap">Focus:</span>
                        <select 
                            value={selectedBook} 
                            onChange={(e) => setSelectedBook(e.target.value)}
                            className="bg-gem-onyx-light dark:bg-gem-onyx-dark border border-gem-mist-light dark:border-gem-mist-dark rounded-full px-3 py-1 text-[10px] font-bold focus:outline-none focus:ring-1 focus:ring-gem-blue transition-all"
                        >
                            <option value="All Books">All Books</option>
                            {booksInStore.map(book => (
                                <option key={book} value={book}>{book}</option>
                            ))}
                        </select>
                    </div>

                     <button 
                        onClick={() => setFastMode(!fastMode)}
                        className={`px-3 py-1 text-[10px] font-bold rounded-full border transition-all ${
                            fastMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-transparent border-gem-mist-light dark:border-gem-mist-dark'
                        }`}
                    >
                        ⚡ FAST {fastMode ? 'ON' : 'OFF'}
                    </button>
                    <div className="h-4 w-[1px] bg-gem-mist-light dark:bg-gem-mist-dark shrink-0"></div>
                    <div className="flex space-x-1 shrink-0">
                        {methods.map(m => (
                            <button 
                                key={m.id}
                                onClick={() => setMethod(m.id)}
                                className={`px-3 py-1 text-[10px] font-bold rounded-full transition-all border whitespace-nowrap ${
                                    method === m.id 
                                    ? 'bg-gem-blue text-white border-gem-blue' 
                                    : 'bg-transparent border-gem-mist-light dark:border-gem-mist-dark opacity-60 hover:opacity-100'
                                }`}
                                title={m.desc}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="flex-grow overflow-y-auto p-4 lg:p-8">
                <div className="max-w-4xl mx-auto space-y-8">
                    {history.length === 0 && !userTranscript && (
                        <div className="text-center py-20 space-y-6">
                            <div className="text-6xl grayscale opacity-20">📚</div>
                            <h2 className="text-2xl font-black opacity-40">Zero-Hallucination Mode</h2>
                            <p className="text-xs opacity-50 px-12 max-w-sm mx-auto italic">
                                Restricted to textbooks. Reply languages: English, Urdu, Pashto, or Sindhi.
                            </p>
                        </div>
                    )}
                    
                    {history.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm text-sm leading-relaxed relative group ${
                                msg.role === 'user' 
                                ? 'bg-gem-blue text-white' 
                                : 'bg-white dark:bg-gem-slate-dark border border-gem-mist-light dark:border-gem-mist-dark'
                            }`}>
                                <div dangerouslySetInnerHTML={renderMarkdown(msg.parts[0].text)} />
                                {msg.role === 'model' && (
                                    <div className="absolute -right-12 top-0 flex flex-col space-y-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={() => handlePrint(msg.parts[0].text)}
                                            className="p-2 bg-gem-mist-light dark:bg-gem-mist-dark rounded-full hover:bg-gem-blue hover:text-white transition-colors"
                                            title="Print as PDF Sheet"
                                        >
                                            🖨️
                                        </button>
                                        <button 
                                            onClick={() => handleDownload(msg.parts[0].text)}
                                            className="p-2 bg-gem-mist-light dark:bg-gem-mist-dark rounded-full hover:bg-gem-teal hover:text-white transition-colors"
                                            title="Download as text file"
                                        >
                                            <DownloadIcon />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    
                    {(userTranscript || aiTranscript) && (
                        <div className="space-y-4 pt-4 border-t border-gem-mist-light dark:border-gem-mist-dark animate-pulse">
                            {userTranscript && (
                                <div className="flex justify-end">
                                    <div className="bg-gem-blue/10 p-3 rounded-xl text-xs border border-gem-blue/20">
                                        <span className="font-bold opacity-40 mr-2 uppercase text-[8px]">Live Voice:</span>
                                        {userTranscript}
                                    </div>
                                </div>
                            )}
                            {aiTranscript && (
                                <div className="flex justify-start">
                                    <div className="bg-gem-mist-light dark:bg-gem-mist-dark p-3 rounded-xl text-xs border border-gem-mist-light dark:border-gem-mist-dark">
                                        <span className="font-bold opacity-40 mr-2 uppercase text-[8px]">AI Response:</span>
                                        {aiTranscript}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {isQueryLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white dark:bg-gem-slate-dark border border-gem-mist-light dark:border-gem-mist-dark p-4 rounded-2xl flex items-center space-x-3">
                                <Spinner />
                                <span className="text-xs italic opacity-50">Searching {selectedBook === 'All Books' ? 'textbooks' : selectedBook}...</span>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>
            </div>

            {isVoiceActive && (
                <div className="fixed inset-0 bg-gem-blue/95 dark:bg-gem-onyx-dark/98 z-50 flex flex-col items-center justify-center p-8 transition-all animate-in fade-in duration-300">
                    <div className="relative mb-8">
                        <div className={`w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-2xl transition-all ${isMuted ? 'opacity-40 grayscale scale-90' : 'animate-pulse'}`}>
                            <span className="text-4xl">{isMuted ? '🔇' : (isAiThinking ? '⏳' : '🎙️')}</span>
                        </div>
                        {!isMuted && !isAiThinking && <div className="absolute inset-0 border-4 border-white rounded-full animate-ping opacity-20"></div>}
                    </div>
                    
                    <h3 className="text-2xl font-black text-white mb-2 text-center">
                        {isMuted ? 'Input Muted' : (isAiThinking ? 'AI Thinking...' : 'Microphone Active')}
                    </h3>
                    
                    <div className="w-full max-w-lg bg-black/20 p-6 rounded-3xl text-white text-center mb-8 border border-white/10 backdrop-blur-md">
                        <p className="text-[10px] font-bold opacity-40 uppercase mb-3 tracking-widest">Voice Interaction Preview</p>
                        <div className="min-h-[60px] flex flex-col justify-center">
                            <p className="text-lg font-bold leading-tight">
                                {userTranscript || "Speak clearly..."}
                            </p>
                            {aiTranscript && <p className="mt-4 text-emerald-300 text-sm font-medium italic border-t border-white/10 pt-4">{aiTranscript}</p>}
                        </div>
                    </div>

                    <div className="flex space-x-4">
                        <button 
                            onClick={() => setIsMuted(!isMuted)}
                            className={`px-8 py-4 rounded-full font-black shadow-2xl transition-all transform active:scale-95 ${isMuted ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}
                            title="Toggle your microphone input"
                        >
                            {isMuted ? 'Resume Mic' : 'Mute Mic'}
                        </button>
                        <button 
                            onClick={stopVoice}
                            className="px-8 py-4 bg-white text-gem-onyx-dark font-black rounded-full shadow-2xl hover:bg-gem-mist-light transition-all transform active:scale-95"
                        >
                            Finish Session
                        </button>
                    </div>
                </div>
            )}

            <footer className="p-4 border-t border-gem-mist-light dark:border-gem-mist-dark bg-white/80 dark:bg-gem-slate-dark/80">
                <div className="max-w-4xl mx-auto flex items-center space-x-3 relative">
                    <button 
                        onClick={startVoice}
                        className="p-4 bg-gem-teal text-white rounded-2xl transition-all shadow-lg hover:brightness-110 active:scale-95"
                        title={`Voice Session (${selectedBook})`}
                    >
                        🎙️
                    </button>
                    <div className="flex-grow relative">
                        <form onSubmit={handleSubmit}>
                            <input 
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder={selectedBook === 'All Books' ? "Type your question..." : `Focus on: ${selectedBook}...`}
                                className="w-full py-4 pl-6 pr-14 bg-gem-onyx-light dark:bg-gem-onyx-dark rounded-2xl border border-gem-mist-light dark:border-gem-mist-dark focus:outline-none focus:ring-2 focus:ring-gem-blue transition-all"
                            />
                            <button 
                                type="submit" 
                                disabled={!query.trim() || isQueryLoading}
                                className="absolute right-2 top-2 p-3 bg-gem-blue text-white rounded-xl disabled:opacity-30 transition-all"
                            >
                                <SendIcon />
                            </button>
                        </form>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default ChatInterface;
